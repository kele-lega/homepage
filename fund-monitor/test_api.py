"""HTTP API 测试：起真实服务器，用 urllib 打真实请求"""
import json
import os
import tempfile
import threading
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen

os.environ.setdefault("FUND_DATA_DIR", tempfile.mkdtemp(prefix="fund-api-"))

import app  # noqa: E402
import data_source as ds  # noqa: E402
from test_data_source import ESTIMATE, OFFICIAL, payload  # noqa: E402


class TestAPI(unittest.TestCase):
    def setUp(self):
        self._orig = ds.fetch_raw
        self._orig_sina = ds.fetch_raw_sina
        self.addCleanup(setattr, ds, "fetch_raw", self._orig)
        self.addCleanup(setattr, ds, "fetch_raw_sina", self._orig_sina)
        ds.fetch_raw = lambda codes, timeout=10: payload(
            [r for r in (OFFICIAL, ESTIMATE) if r["FCODE"] in codes])
        ds.fetch_raw_sina = lambda code, timeout=10: (_ for _ in ()).throw(OSError("stubbed: no sina in tests"))

        d = tempfile.mkdtemp(prefix="fund-api-case-")
        self.store = app.Store(funds_file=os.path.join(d, "funds.json"),
                              cache_file=os.path.join(d, "cache.json"))
        self.srv = app.make_server("127.0.0.1", 0, store=self.store)
        self.port = self.srv.server_address[1]
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()
        self.addCleanup(self.srv.shutdown)

    def call(self, method, path, body=None):
        url = "http://127.0.0.1:%d%s" % (self.port, path)
        data = json.dumps(body).encode() if body is not None else None
        req = Request(url, data=data, method=method)
        if data:
            req.add_header("Content-Type", "application/json")
        try:
            with urlopen(req, timeout=5) as resp:
                return resp.status, json.loads(resp.read().decode())
        except HTTPError as exc:
            raw = exc.read().decode()
            try:
                return exc.code, json.loads(raw)
            except json.JSONDecodeError:
                return exc.code, raw

    def raw_post(self, path, raw_body, ctype="application/json"):
        url = "http://127.0.0.1:%d%s" % (self.port, path)
        req = Request(url, data=raw_body, method="POST")
        req.add_header("Content-Type", ctype)
        try:
            with urlopen(req, timeout=5) as resp:
                return resp.status, json.loads(resp.read().decode())
        except HTTPError as exc:
            return exc.code, json.loads(exc.read().decode())

    # ---------- GET ----------
    def test_healthz(self):
        status, body = self.call("GET", "/healthz")
        self.assertEqual(status, 200)
        self.assertTrue(body["ok"])
        self.assertIn("last_refresh", body)

    def test_list_empty(self):
        status, body = self.call("GET", "/api/funds")
        self.assertEqual(status, 200)
        self.assertEqual(body["funds"], [])
        self.assertEqual(body["count"], 0)

    def test_list_returns_array(self):
        self.call("POST", "/api/funds", {"code": "000001"})
        status, body = self.call("GET", "/api/funds")
        self.assertEqual(status, 200)
        self.assertIsInstance(body["funds"], list)
        self.assertEqual(body["funds"][0]["code"], "000001")
        self.assertEqual(body["funds"][0]["name"], "华夏成长混合")
        # 明确不返回金额/份额字段
        for banned in ("amount", "shares", "profit", "holding"):
            self.assertNotIn(banned, body["funds"][0])

    def test_proxy_prefix_path(self):
        """Caddy 若把 /fund-monitor 前缀原样透传，也要能正确路由"""
        status, _ = self.call("GET", "/fund-monitor/healthz")
        self.assertEqual(status, 200)
        status, body = self.call("GET", "/fund-monitor/api/funds")
        self.assertEqual(status, 200)
        self.assertIn("funds", body)

    def test_query_string_ignored(self):
        status, _ = self.call("GET", "/api/funds?t=123")
        self.assertEqual(status, 200)

    def test_unknown_path_404(self):
        self.assertEqual(self.call("GET", "/nope")[0], 404)

    # ---------- POST ----------
    def test_post_creates_201(self):
        status, body = self.call("POST", "/api/funds", {"code": "000001"})
        self.assertEqual(status, 201)
        self.assertTrue(body["created"])
        self.assertEqual(body["fund"]["code"], "000001")

    def test_post_idempotent_200(self):
        self.call("POST", "/api/funds", {"code": "000001"})
        status, body = self.call("POST", "/api/funds", {"code": "000001"})
        self.assertEqual(status, 200)
        self.assertFalse(body["created"])
        self.assertEqual(self.store.list_codes(), ["000001"])

    def test_post_bad_code_400(self):
        for bad in ("12345", "1234567", "abcdef", "", "  "):
            status, _ = self.call("POST", "/api/funds", {"code": bad})
            self.assertEqual(status, 400, bad)
        self.assertEqual(self.store.list_codes(), [])  # 非法代码不落盘

    def test_post_missing_code_400(self):
        self.assertEqual(self.call("POST", "/api/funds", {})[0], 400)

    def test_post_empty_body_400(self):
        self.assertEqual(self.raw_post("/api/funds", b"")[0], 400)

    def test_post_malformed_json_400(self):
        self.assertEqual(self.raw_post("/api/funds", b"{not json")[0], 400)

    def test_post_non_object_json_400(self):
        self.assertEqual(self.raw_post("/api/funds", b'["000001"]')[0], 400)

    def test_post_oversized_body_400(self):
        self.assertEqual(self.raw_post("/api/funds", b'{"code":"' + b"1" * 5000 + b'"}')[0], 400)

    def test_post_wrong_path_404(self):
        self.assertEqual(self.call("POST", "/api/other", {"code": "000001"})[0], 404)

    # ---------- DELETE ----------
    def test_delete_existing(self):
        self.call("POST", "/api/funds", {"code": "000001"})
        status, body = self.call("DELETE", "/api/funds/000001")
        self.assertEqual(status, 200)
        self.assertEqual(body["deleted"], "000001")
        self.assertEqual(self.store.list_codes(), [])

    def test_delete_missing_404(self):
        self.assertEqual(self.call("DELETE", "/api/funds/000001")[0], 404)

    def test_delete_bad_code_400(self):
        self.assertEqual(self.call("DELETE", "/api/funds/abc")[0], 400)

    def test_delete_no_code_404(self):
        self.assertEqual(self.call("DELETE", "/api/funds")[0], 404)

    # ---------- 其它方法 ----------
    def test_put_405_and_server_alive(self):
        self.assertEqual(self.call("PUT", "/api/funds", {"code": "000001"})[0], 405)
        self.assertEqual(self.call("PATCH", "/api/funds", {"code": "000001"})[0], 405)
        # 进程没退出，后续请求照常
        self.assertEqual(self.call("GET", "/healthz")[0], 200)

    def test_error_response_is_json(self):
        status, body = self.call("POST", "/api/funds", {"code": "1"})
        self.assertEqual(status, 400)
        self.assertIn("error", body)

    def test_upstream_failure_still_adds_code(self):
        """数据源挂了也要能加进监控列表，条目先显示 pending"""
        ds.fetch_raw = lambda codes, timeout=10: b"<html>404</html>"
        status, body = self.call("POST", "/api/funds", {"code": "161725"})
        self.assertEqual(status, 201)
        self.assertIsNone(body["fund"])
        _, listing = self.call("GET", "/api/funds")
        self.assertEqual(listing["funds"][0]["kind"], "pending")
        self.assertIsNotNone(listing["last_error"])


if __name__ == "__main__":
    unittest.main()
