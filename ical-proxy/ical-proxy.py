"""
iCal 中转代理
- 解决 Google Calendar 直接拉 iCal 返回 404 HTML 的问题：
  Homepage 用 Node fetch 默认 UA，Google 把这当成 bot，返回 HTML 错误页
- 本服务带 Mozilla UA 去拉，保证拿到 text/calendar
- 过滤掉 RRULE 行：iCal 重复事件会被 agenda 视图展开成多行
  （例: 每30 天循环 → 9/9、10/9、11/8 全列出），实际我们只想看下一次
- 路径: /basic.ics 返回处理后的 iCal 文本
- 缓存: 2 分钟
- UPSTREAM 通过环境变量 ICAL_UPSTREAM 注入，不在源码里硬编码 token
"""
import os
import re
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.request import urlopen, Request

UPSTREAM = os.environ.get(
    "ICAL_UPSTREAM",
    "https://calendar.google.com/calendar/ical/REPLACE_ME/public/basic.ics",
)
CACHE: tuple = ("", 0.0)
CACHE_TTL = 120
RRULE_RE = re.compile(rb"^RRULE:.*\r?\n", re.MULTILINE)


def fetch_ical() -> bytes:
    global CACHE
    now = time.time()
    if CACHE[1] and now - CACHE[1] < CACHE_TTL:
        return CACHE[0]
    req = Request(UPSTREAM, headers={
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                      "(KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        "Accept": "text/calendar,*/*",
    })
    data = urlopen(req, timeout=10).read()
    # 去掉 RRULE 行（折叠重复事件为单次）
    data = RRULE_RE.sub(b"", data)
    CACHE = (data, now)
    return data


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass  # 静默

    def do_GET(self):
        if self.path == "/health":
            self._respond(200, b'{"ok":true}', "application/json")
            return
        if self.path.endswith("/basic.ics"):
            data = fetch_ical()
            self._respond(200, data, "text/calendar; charset=utf-8")
            return
        self._respond(404, b'{"error":"not found"}', "application/json")

    def _respond(self, code: int, body: bytes, ctype: str):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    srv = ThreadingHTTPServer(("0.0.0.0", 8089), Handler)
    print("ical-proxy listening on :8089", flush=True)
    srv.serve_forever()