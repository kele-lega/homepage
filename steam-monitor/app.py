"""
Steam 游戏时长监控服务

- 每用户绑定一个 Steam 主页 / SteamID，JSON 文件持久化
- 后台线程刷新头像、昵称、正在玩、近两周游戏及时长
- 未绑定返回 200 + bound=false，不报错
- 只在 Compose 内网监听；浏览器经 Caddy 的 /steam-monitor/* 同源访问

环境变量：
  STEAM_DATA_DIR      数据目录，默认 /app/data
  STEAM_REFRESH_SEC   抓取间隔秒，默认 300
  STEAM_HOST          监听地址，默认 0.0.0.0
  STEAM_PORT          监听端口，默认 8091
  STEAM_API_KEY       Steam Web API Key
  STEAM_ALLOW_ORIGIN  额外允许的 CORS 源（本地开发直连时用）
  STEAM_DEFAULT_USER  无认证头时的回落用户（仅本地 override）
"""
import json
import os
import re
import threading
from datetime import datetime, timezone, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

import steam_client as steam

CST = timezone(timedelta(hours=8))
DATA_DIR = os.environ.get("STEAM_DATA_DIR", "/app/data")
USERS_DIR = os.path.join(DATA_DIR, "users")
REFRESH_SEC = max(int(os.environ.get("STEAM_REFRESH_SEC", "300")), 30)
HOST = os.environ.get("STEAM_HOST", "0.0.0.0")
PORT = int(os.environ.get("STEAM_PORT", "8091"))
API_KEY = (os.environ.get("STEAM_API_KEY") or "").strip()
DEFAULT_USER = os.environ.get("STEAM_DEFAULT_USER", "")
ALLOW_ORIGINS = [o.strip() for o in os.environ.get("STEAM_ALLOW_ORIGIN", "").split(",") if o.strip()]
MAX_BODY = 4096
USER_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$")


def now_iso():
    return datetime.now(CST).isoformat(timespec="seconds")


def valid_user(user):
    return bool(user and USER_RE.match(user))


def read_json(path, fallback):
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return fallback


def write_json(path, payload):
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2)
        fh.flush()
        os.fsync(fh.fileno())
    os.replace(tmp, path)


class Store:
    def __init__(self, user, directory):
        self.user = user
        self.directory = directory
        self.profile_file = os.path.join(directory, "profile.json")
        self.cache_file = os.path.join(directory, "cache.json")
        self.lock = threading.RLock()
        self.steamid = ""
        self.input = ""
        self.profile = None
        self.games = []
        self.last_refresh = None
        self.last_error = None
        self.load()

    def load(self):
        cfg = read_json(self.profile_file, {})
        if isinstance(cfg, dict):
            self.steamid = str(cfg.get("steamid") or "")
            self.input = str(cfg.get("input") or "")
            if self.steamid and not steam.STEAMID_RE.match(self.steamid):
                self.steamid = ""
        cached = read_json(self.cache_file, {})
        if isinstance(cached, dict):
            profile = cached.get("profile")
            games = cached.get("games")
            self.profile = profile if isinstance(profile, dict) else None
            self.games = games if isinstance(games, list) else []
            self.last_refresh = cached.get("last_refresh")
            self.last_error = cached.get("last_error")

    def save_profile(self):
        write_json(self.profile_file, {
            "steamid": self.steamid,
            "input": self.input,
            "updated_at": now_iso(),
        })

    def save_cache(self):
        write_json(self.cache_file, {
            "profile": self.profile,
            "games": self.games,
            "last_refresh": self.last_refresh,
            "last_error": self.last_error,
        })

    def snapshot(self):
        with self.lock:
            bound = bool(self.steamid)
            return {
                "bound": bound,
                "configured": bound,
                "has_api_key": bool(API_KEY),
                "input": self.input,
                "profile": self.profile,
                "games": list(self.games),
                "last_refresh": self.last_refresh,
                "last_error": self.last_error,
            }

    def bind(self, raw_input):
        steamid = steam.resolve_steamid(API_KEY, raw_input)
        with self.lock:
            self.steamid = steamid
            self.input = raw_input.strip()
            self.last_error = None
            self.save_profile()
        self.refresh()
        return self.snapshot()

    def unbind(self):
        with self.lock:
            self.steamid = ""
            self.input = ""
            self.profile = None
            self.games = []
            self.last_refresh = None
            self.last_error = None
            for path in (self.profile_file, self.cache_file):
                try:
                    os.remove(path)
                except FileNotFoundError:
                    pass
            self.save_profile()
            # 未绑定不保留空配置文件，避免刷新线程空转
            try:
                os.remove(self.profile_file)
            except FileNotFoundError:
                pass
        return self.snapshot()

    def refresh(self):
        with self.lock:
            steamid = self.steamid
        if not steamid:
            return None
        if not API_KEY:
            with self.lock:
                self.last_error = "管理员尚未配置 Steam API Key"
                self.save_cache()
            return self.last_error
        try:
            data = steam.fetch_snapshot(API_KEY, steamid)
        except steam.SteamAPIError as exc:
            with self.lock:
                self.last_error = str(exc)
                self.save_cache()
            return self.last_error
        except Exception as exc:
            with self.lock:
                self.last_error = "刷新 Steam 数据失败"
                self.save_cache()
            print("[steam-monitor] 刷新异常：%s" % exc, flush=True)
            return self.last_error
        with self.lock:
            self.profile = data.get("profile")
            self.games = data.get("games") or []
            self.last_refresh = now_iso()
            if data.get("private") and not self.games:
                self.last_error = "游戏详情未公开。请在 Steam 隐私设置中将「游戏详情」设为公开。"
            else:
                self.last_error = None
            self.save_cache()
        return self.last_error


class StoreManager:
    def __init__(self, data_dir=DATA_DIR):
        self.data_dir = data_dir
        self.users_dir = os.path.join(data_dir, "users")
        self.lock = threading.RLock()
        self.stores = {}
        os.makedirs(self.users_dir, exist_ok=True)
        self._load_existing()

    def _load_existing(self):
        try:
            names = os.listdir(self.users_dir)
        except OSError:
            return
        for name in names:
            if valid_user(name):
                self.for_user(name)

    def for_user(self, user):
        if not valid_user(user):
            raise ValueError("未识别的登录用户")
        with self.lock:
            store = self.stores.get(user)
            if store is None:
                directory = os.path.join(self.users_dir, user)
                os.makedirs(directory, exist_ok=True)
                store = Store(user, directory)
                self.stores[user] = store
            return store

    def all_stores(self):
        with self.lock:
            names = set(self.stores)
        try:
            for name in os.listdir(self.users_dir):
                if valid_user(name):
                    names.add(name)
        except OSError:
            pass
        return [self.for_user(name) for name in sorted(names)]


STORE = StoreManager()
STOP = threading.Event()


def refresher(store=None, interval=REFRESH_SEC, stop=None):
    backend = store or STORE
    stop = stop or STOP
    while not stop.is_set():
        try:
            stores = backend.all_stores() if isinstance(backend, StoreManager) else [backend]
            for user_store in stores:
                if not user_store.steamid:
                    continue
                err = user_store.refresh()
                if err:
                    print("[steam-monitor] %s 刷新异常：%s" % (user_store.user, err), flush=True)
                else:
                    print("[steam-monitor] %s 刷新完成 %s，%d 款游戏"
                          % (user_store.user, user_store.last_refresh, len(user_store.games)), flush=True)
        except Exception as exc:
            print("[steam-monitor] 刷新线程异常：%s" % exc, flush=True)
        stop.wait(interval)


class Handler(BaseHTTPRequestHandler):
    server_version = "steam-monitor/1.0"
    store = None

    def log_message(self, fmt, *args):
        pass

    def _store(self):
        backend = self.store or STORE
        if isinstance(backend, StoreManager):
            return backend.for_user(self._user())
        return backend

    def _user(self):
        user = self.headers.get("X-Authenticated-User")
        if not user:
            user = DEFAULT_USER
        if not valid_user(user):
            raise ValueError("未识别的登录用户")
        return user

    def _send(self, code, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        origin = self.headers.get("Origin")
        if ALLOW_ORIGINS and origin in ALLOW_ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Methods", "GET, PUT, DELETE, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _send_image(self, content_type, payload):
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "public, max-age=86400")
        origin = self.headers.get("Origin")
        if ALLOW_ORIGINS and origin in ALLOW_ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(payload)

    def _err(self, code, message):
        self._send(code, {"error": message})

    def _path(self):
        path = self.path.split("?")[0].rstrip("/") or "/"
        for prefix in ("/steam-monitor",):
            if path == prefix:
                return "/"
            if path.startswith(prefix + "/"):
                return path[len(prefix):]
        return path

    def _read_body(self):
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            raise ValueError("Content-Length 非法")
        if length <= 0:
            raise ValueError("请求体为空")
        if length > MAX_BODY:
            raise ValueError("请求体过大")
        raw = self.rfile.read(length)
        try:
            data = json.loads(raw.decode("utf-8", "replace"))
        except json.JSONDecodeError:
            raise ValueError("请求体不是合法 JSON")
        if not isinstance(data, dict):
            raise ValueError("请求体必须是 JSON 对象")
        return data

    def do_OPTIONS(self):
        allowed = ALLOW_ORIGINS and self.headers.get("Origin") in ALLOW_ORIGINS
        self._send(204 if allowed else 405, {})

    def do_GET(self):
        path = self._path()
        if path == "/healthz":
            self._send(200, {
                "ok": True,
                "has_api_key": bool(API_KEY),
                "refresh_sec": REFRESH_SEC,
            })
            return
        if path == "/img":
            raw = (parse_qs(urlparse(self.path).query).get("url") or [""])[0]
            try:
                content_type, payload = steam.fetch_image(raw)
            except steam.SteamAPIError as exc:
                self._err(400, str(exc))
                return
            except Exception:
                self._err(502, "图片加载失败")
                return
            self._send_image(content_type, payload)
            return
        try:
            store = self._store()
        except ValueError as exc:
            self._err(401, str(exc))
            return
        if path == "/api/steam":
            self._send(200, store.snapshot())
            return
        self._err(404, "not found")

    def do_HEAD(self):
        self.do_GET()

    def do_PUT(self):
        if self._path() != "/api/steam":
            self._err(404, "not found")
            return
        try:
            store = self._store()
            data = self._read_body()
        except ValueError as exc:
            if str(exc) == "未识别的登录用户":
                self._err(401, str(exc))
                return
            self._err(400, str(exc))
            return
        raw = str(data.get("url") or data.get("input") or "").strip()
        try:
            snapshot = store.bind(raw)
        except steam.SteamAPIError as exc:
            self._err(400, str(exc))
            return
        self._send(200, snapshot)

    def do_DELETE(self):
        if self._path() != "/api/steam":
            self._err(404, "not found")
            return
        try:
            store = self._store()
        except ValueError as exc:
            self._err(401, str(exc))
            return
        self._send(200, store.unbind())

    def do_POST(self):
        self._err(405, "method not allowed")

    def do_PATCH(self):
        self._err(405, "method not allowed")


def make_server(host=HOST, port=PORT, store=None):
    handler = type("BoundHandler", (Handler,), {"store": store or STORE})
    return ThreadingHTTPServer((host, port), handler)


if __name__ == "__main__":
    threading.Thread(target=refresher, daemon=True).start()
    srv = make_server()
    print("[steam-monitor] listening on %s:%d，间隔 %ds，API Key %s"
          % (HOST, PORT, REFRESH_SEC, "已配置" if API_KEY else "未配置"), flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        STOP.set()
