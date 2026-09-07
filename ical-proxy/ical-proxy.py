"""
iCal 中转代理。

- /basic.ics 按认证用户读取并缓存日历。
- /api/calendar 允许认证用户读取、保存或清除自己的日历地址。
- 用户配置通过临时文件和原子替换持久化，不接受请求体中的用户名。
"""
import json
import os
import re
import socket
import tempfile
import threading
import time
import ipaddress
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse
from urllib.request import Request, urlopen

UPSTREAM = os.environ.get(
    "ICAL_UPSTREAM",
    "https://calendar.google.com/calendar/ical/REPLACE_ME/public/basic.ics",
)
USER_CONFIG = os.environ.get("ICAL_USERS_FILE", "/app/data/users.json")
CACHE_TTL = 120
RRULE_RE = re.compile(rb"^RRULE:.*\r?\n", re.MULTILINE)
USER_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$")
CONFIG_LOCK = threading.RLock()
CACHE = {}


def valid_user(user):
    return isinstance(user, str) and bool(USER_RE.fullmatch(user))


def valid_calendar_url(value):
    if not isinstance(value, str):
        return False
    value = value.strip()
    if not value or len(value) > 2048 or any(char in value for char in ("\r", "\n")):
        return False
    parsed = urlparse(value)
    if parsed.scheme not in ("http", "https") or parsed.username or parsed.password:
        return False
    host = (parsed.hostname or "").lower().rstrip(".")
    if not host or host in {"localhost", "localhost.localdomain"}:
        return False
    try:
        addresses = {ipaddress.ip_address(host)}
    except ValueError:
        try:
            addresses = {ipaddress.ip_address(info[4][0]) for info in socket.getaddrinfo(host, None)}
        except socket.gaierror:
            addresses = set()
    if any(address.is_private or address.is_loopback or address.is_link_local or address.is_reserved for address in addresses):
        return False
    if host in {"0.0.0.0", "::", "::1"} or host.startswith("127."):
        return False
    if host.startswith("10.") or host.startswith("192.168.") or host.startswith("169.254."):
        return False
    if host.startswith("172."):
        try:
            if 16 <= int(host.split(".")[1]) <= 31:
                return False
        except (IndexError, ValueError):
            return False
    return True


def read_user_urls(path=USER_CONFIG):
    try:
        with open(path, "r", encoding="utf-8") as fh:
            raw = json.load(fh)
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return {}
    if not isinstance(raw, dict):
        return {}
    return {
        user: url.strip()
        for user, url in raw.items()
        if valid_user(user) and valid_calendar_url(url)
    }


def load_user_urls(path=USER_CONFIG):
    """兼容旧调用方的配置读取入口。"""
    return read_user_urls(path)


def save_user_urls(urls, path=USER_CONFIG):
    directory = os.path.dirname(path) or "."
    os.makedirs(directory, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix="users.", suffix=".tmp", dir=directory, text=True)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(urls, fh, ensure_ascii=False, indent=2)
            fh.write("\n")
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def update_user_url(user, url, path=USER_CONFIG):
    with CONFIG_LOCK:
        urls = read_user_urls(path)
        if url is None:
            urls.pop(user, None)
        else:
            urls[user] = url
        save_user_urls(urls, path)
        CACHE.pop(user, None)
        return urls.get(user)


def fetch_ical(user):
    urls = load_user_urls(USER_CONFIG)
    upstream = urls.get(user)
    if not upstream:
        if user != "admin":
            raise ValueError("该用户尚未配置日历")
        upstream = UPSTREAM
    now = time.time()
    cached = CACHE.get(user)
    if cached and now - cached[1] < CACHE_TTL:
        return cached[0]
    req = Request(
        upstream,
        headers={
            "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/120.0 Safari/537.36",
            "Accept": "text/calendar,*/*",
        },
    )
    data = RRULE_RE.sub(b"", urlopen(req, timeout=10).read())
    CACHE[user] = (data, now)
    return data


def calendar_user(handler):
    user = handler.headers.get("X-Authenticated-User", "")
    if not valid_user(user):
        raise PermissionError("missing authenticated user")
    return user


def json_body(handler):
    try:
        length = int(handler.headers.get("Content-Length", "0"))
    except ValueError as exc:
        raise ValueError("请求体长度无效") from exc
    if length < 0 or length > 4096:
        raise ValueError("请求体过大")
    try:
        body = json.loads(handler.rfile.read(length).decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError("请求体必须是 JSON") from exc
    if not isinstance(body, dict):
        raise ValueError("请求体必须是 JSON 对象")
    return body


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass

    def do_GET(self):
        if self.path == "/health":
            self._json(200, {"ok": True})
            return
        if self.path == "/api/calendar":
            self._calendar_get()
            return
        if self.path.endswith("/basic.ics"):
            self._ical_get()
            return
        self._json(404, {"error": "not found"})

    def do_PUT(self):
        if self.path == "/api/calendar":
            self._calendar_put()
            return
        self._json(404, {"error": "not found"})

    def do_DELETE(self):
        if self.path == "/api/calendar":
            self._calendar_delete()
            return
        self._json(404, {"error": "not found"})

    def _ical_get(self):
        try:
            user = calendar_user(self)
        except PermissionError:
            self._json(401, {"error": "missing authenticated user"})
            return
        try:
            data = fetch_ical(user)
        except ValueError as exc:
            self._json(403, {"error": str(exc)})
            return
        except Exception as exc:
            self._json(502, {"error": str(exc)})
            return
        self._respond(200, data, "text/calendar; charset=utf-8")

    def _calendar_get(self):
        try:
            user = calendar_user(self)
        except PermissionError:
            self._json(401, {"error": "missing authenticated user"})
            return
        configured = read_user_urls(USER_CONFIG).get(user)
        self._json(200, {"configured": bool(configured), "url": configured or ""})

    def _calendar_put(self):
        try:
            user = calendar_user(self)
            body = json_body(self)
            url = body.get("url")
            if not valid_calendar_url(url):
                raise ValueError("日历地址必须是公开的 http 或 https 地址")
            saved = update_user_url(user, url.strip(), USER_CONFIG)
        except PermissionError:
            self._json(401, {"error": "missing authenticated user"})
            return
        except ValueError as exc:
            self._json(400, {"error": str(exc)})
            return
        except OSError as exc:
            self._json(500, {"error": "保存日历地址失败: " + str(exc)})
            return
        self._json(200, {"configured": True, "url": saved})

    def _calendar_delete(self):
        try:
            user = calendar_user(self)
            update_user_url(user, None, USER_CONFIG)
        except PermissionError:
            self._json(401, {"error": "missing authenticated user"})
            return
        except OSError as exc:
            self._json(500, {"error": "清除日历地址失败: " + str(exc)})
            return
        self._json(200, {"configured": False, "url": ""})

    def _json(self, code, payload):
        self._respond(code, json.dumps(payload, ensure_ascii=False).encode("utf-8"), "application/json")

    def _respond(self, code: int, body: bytes, ctype: str):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    srv = ThreadingHTTPServer(("0.0.0.0", 8089), Handler)
    print("ical-proxy listening on :8089", flush=True)
    srv.serve_forever()
