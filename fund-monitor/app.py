"""
基金净值监控服务

- JSON 文件持久化基金代码列表（funds.json）和最近一次成功结果（cache.json）
- 后台线程按固定间隔抓取，页面关不关都在跑；抓取失败保留上次成功值并记录错误
- 只提供净值与涨跌，不涉及金额、份额、盈亏
- 只在 Compose 内网监听；浏览器经 Caddy 的 /fund-monitor/* 同源访问

环境变量：
  FUND_DATA_DIR    数据目录，默认 /app/data
  FUND_REFRESH_SEC 抓取间隔秒，默认 60
  FUND_HOST        监听地址，默认 0.0.0.0
  FUND_PORT        监听端口，默认 8090
  FUND_ALLOW_ORIGIN 额外允许的 CORS 源（本地开发直连时用），默认空
"""
import json
import os
import threading
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from data_source import CST, fetch_funds, valid_code

DATA_DIR = os.environ.get("FUND_DATA_DIR", "/app/data")
FUNDS_FILE = os.path.join(DATA_DIR, "funds.json")
CACHE_FILE = os.path.join(DATA_DIR, "cache.json")
REFRESH_SEC = max(int(os.environ.get("FUND_REFRESH_SEC", "60")), 10)
HOST = os.environ.get("FUND_HOST", "0.0.0.0")
PORT = int(os.environ.get("FUND_PORT", "8090"))
# 逗号分隔的允许来源。本地 homepage 端口可能是 3000/3001，都放开；
# 生产走 Caddy 同源反代，这个变量留空，不发任何 CORS 头
ALLOW_ORIGINS = [o.strip() for o in os.environ.get("FUND_ALLOW_ORIGIN", "").split(",") if o.strip()]

MAX_BODY = 4096  # 请求体上限，防止超大 body


def now_iso() -> str:
    return datetime.now(CST).isoformat(timespec="seconds")


def read_json(path, fallback):
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return fallback


def write_json(path, payload):
    """先写临时文件再原子替换，避免容器重启或并发读到半写入的 JSON"""
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2)
        fh.flush()
        os.fsync(fh.fileno())
    os.replace(tmp, path)


class Store:
    """基金列表 + 最近成功缓存。所有读写都在锁内，HTTP 线程与抓取线程共用"""

    def __init__(self, funds_file=FUNDS_FILE, cache_file=CACHE_FILE):
        self.funds_file = funds_file
        self.cache_file = cache_file
        self.lock = threading.RLock()
        self.last_refresh = None
        self.last_error = None
        self.load()

    def load(self):
        """启动时先恢复本地配置与缓存，保证抓取前接口就能返回上次数据"""
        cfg = read_json(self.funds_file, {})
        codes = cfg.get("funds") if isinstance(cfg, dict) else None
        self.codes = [c for c in codes if valid_code(c)] if isinstance(codes, list) else []

        cached = read_json(self.cache_file, {})
        entries = cached.get("entries") if isinstance(cached, dict) else None
        self.entries = entries if isinstance(entries, dict) else {}
        if isinstance(cached, dict):
            self.last_refresh = cached.get("last_refresh")
            self.last_error = cached.get("last_error")

    def save_funds(self):
        write_json(self.funds_file, {"funds": self.codes, "updated_at": now_iso()})

    def save_cache(self):
        write_json(self.cache_file, {
            "entries": self.entries,
            "last_refresh": self.last_refresh,
            "last_error": self.last_error,
        })

    def list_codes(self):
        with self.lock:
            return list(self.codes)

    def add(self, code):
        """返回 (是否新增, 条目)。重复添加幂等，不产生重复行"""
        with self.lock:
            created = code not in self.codes
            if created:
                self.codes.append(code)
                self.save_funds()
        if created:
            self.refresh_one(code)
        with self.lock:
            return created, self.entries.get(code)

    def remove(self, code):
        with self.lock:
            if code not in self.codes:
                return False
            self.codes.remove(code)
            self.entries.pop(code, None)
            self.save_funds()
            self.save_cache()
            return True

    def _merge(self, code, fresh):
        """
        单条合并规则：新数据不能倒退。
        - 净值日期更新 -> 覆盖
        - 同一天：正式净值优先于估算（正式发布后不再被估算覆盖）
        - 日期更旧（源回滚/异常）-> 保留旧值
        """
        old = self.entries.get(code)
        if not old:
            return fresh
        old_date = old.get("nav_date") or ""
        new_date = fresh.get("nav_date") or ""
        if new_date > old_date:
            return fresh
        if new_date < old_date:
            return old
        if old.get("kind") == "official" and fresh.get("kind") == "estimate":
            return old
        return fresh

    def refresh(self, codes=None):
        """
        抓取一轮。返回错误信息或 None。
        抓取/解析失败不动缓存，只记录错误状态，避免展示 0 值或空白。
        """
        targets = self.list_codes() if codes is None else [c for c in codes if valid_code(c)]
        if not targets:
            with self.lock:
                self.last_refresh = now_iso()
                self.last_error = None
                self.save_cache()
            return None
        try:
            fresh = fetch_funds(targets)
        except ValueError as exc:
            with self.lock:
                self.last_error = str(exc)
                self.save_cache()
            return str(exc)

        with self.lock:
            for code, entry in fresh.items():
                if code in self.codes:
                    self.entries[code] = self._merge(code, entry)
            missing = [c for c in targets if c not in fresh]
            self.last_refresh = now_iso()
            # 部分代码没返回：其余成功数据照常写入，只把缺失记进错误状态
            self.last_error = ("以下代码未返回数据：" + ", ".join(missing)) if missing else None
            self.save_cache()
        return self.last_error

    def refresh_one(self, code):
        return self.refresh([code])

    def snapshot(self):
        """给 API 用的视图：按用户添加顺序输出，未抓到的条目标 pending"""
        with self.lock:
            items = []
            for code in self.codes:
                entry = self.entries.get(code)
                if entry:
                    items.append(dict(entry))
                else:
                    items.append({"code": code, "name": None, "nav": None,
                                  "change_pct": None, "nav_date": None,
                                  "kind": "pending", "source": None,
                                  "fetched_at": None})
            return {
                "funds": items,
                "count": len(items),
                "last_refresh": self.last_refresh,
                "last_error": self.last_error,
                "refresh_sec": REFRESH_SEC,
            }


STORE = Store()
STOP = threading.Event()


def refresher(store=None, interval=REFRESH_SEC, stop=None):
    """后台常驻：先立刻抓一轮，之后固定间隔。异常一律不让线程死掉"""
    store = store or STORE
    stop = stop or STOP
    while not stop.is_set():
        try:
            err = store.refresh()
            if err:
                print("[fund-monitor] 抓取异常：%s" % err, flush=True)
            else:
                print("[fund-monitor] 抓取完成 %s，共 %d 只"
                      % (store.last_refresh, len(store.list_codes())), flush=True)
        except Exception as exc:  # 兜底，保证定时循环不中断
            print("[fund-monitor] 刷新线程异常：%s" % exc, flush=True)
        stop.wait(interval)


class Handler(BaseHTTPRequestHandler):
    server_version = "fund-monitor/1.0"
    store = None  # 由 make_server 注入，测试可替换

    def log_message(self, fmt, *args):
        pass  # 静默，避免刷满容器日志

    # ---------- 工具 ----------
    def _store(self):
        return self.store or STORE

    def _send(self, code, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        # 生产走 Caddy 同源，无需 CORS；本地开发直连时只回显白名单里的来源，
        # 不用 *，避免把接口开给任意站点
        origin = self.headers.get("Origin")
        if ALLOW_ORIGINS and origin in ALLOW_ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _err(self, code, message):
        self._send(code, {"error": message})

    def _path(self):
        """去掉查询串，并容忍反代带上 /fund-monitor 前缀的情况"""
        path = self.path.split("?")[0].rstrip("/") or "/"
        for prefix in ("/fund-monitor",):
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

    # ---------- 路由 ----------
    def do_OPTIONS(self):
        allowed = ALLOW_ORIGINS and self.headers.get("Origin") in ALLOW_ORIGINS
        self._send(204 if allowed else 405, {})

    def do_GET(self):
        path = self._path()
        store = self._store()
        if path == "/healthz":
            self._send(200, {
                "ok": True,
                "last_refresh": store.last_refresh,
                "last_error": store.last_error,
                "tracked": len(store.list_codes()),
                "failed": 1 if store.last_error else 0,
                "refresh_sec": REFRESH_SEC,
            })
            return
        if path == "/api/funds":
            self._send(200, store.snapshot())
            return
        self._err(404, "not found")

    def do_HEAD(self):
        self.do_GET()

    def do_POST(self):
        if self._path() != "/api/funds":
            self._err(404, "not found")
            return
        try:
            data = self._read_body()
        except ValueError as exc:
            self._err(400, str(exc))
            return
        code = str(data.get("code") or "").strip()
        if not valid_code(code):
            self._err(400, "基金代码必须是 6 位数字")
            return
        created, entry = self._store().add(code)
        # 幂等：已存在返回 200，新增返回 201
        self._send(201 if created else 200, {"created": created, "fund": entry})

    def do_DELETE(self):
        path = self._path()
        prefix = "/api/funds/"
        if not path.startswith(prefix):
            self._err(404, "not found")
            return
        code = path[len(prefix):]
        if not valid_code(code):
            self._err(400, "基金代码必须是 6 位数字")
            return
        if not self._store().remove(code):
            self._err(404, "该基金不在监控列表中")
            return
        self._send(200, {"deleted": code})

    def do_PUT(self):
        self._err(405, "method not allowed")

    def do_PATCH(self):
        self._err(405, "method not allowed")


def make_server(host=HOST, port=PORT, store=None):
    handler = type("BoundHandler", (Handler,), {"store": store or STORE})
    return ThreadingHTTPServer((host, port), handler)


if __name__ == "__main__":
    threading.Thread(target=refresher, daemon=True).start()
    srv = make_server()
    print("[fund-monitor] listening on %s:%d，间隔 %ds，监控 %d 只"
          % (HOST, PORT, REFRESH_SEC, len(STORE.list_codes())), flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        STOP.set()
