"""iCal 多用户隔离和日历设置 API 测试。"""
import http.client
import importlib.util
import json
import os
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from unittest.mock import patch

MODULE_PATH = os.path.join(os.path.dirname(__file__), "ical-proxy.py")
spec = importlib.util.spec_from_file_location("ical_proxy", MODULE_PATH)
ical = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ical)


class Response:
    def __init__(self, body):
        self.body = body

    def read(self):
        return self.body


class IcalProxyCase(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="ical-users-")
        self.config = os.path.join(self.dir, "users.json")
        with open(self.config, "w", encoding="utf-8") as fh:
            json.dump({
                "alice": "https://calendar.example/alice.ics",
                "bob": "https://calendar.example/bob.ics",
            }, fh)
        ical.CACHE.clear()

    def test_loads_only_safe_user_and_http_urls(self):
        with open(self.config, "w", encoding="utf-8") as fh:
            json.dump({
                "alice": "https://calendar.example/a.ics",
                "../bad": "https://calendar.example/bad.ics",
                "bob": "file:///etc/passwd",
                "private": "http://127.0.0.1/secret",
            }, fh)
        self.assertEqual(ical.load_user_urls(self.config), {
            "alice": "https://calendar.example/a.ics",
        })

    def test_users_use_independent_urls_and_cache(self):
        calls = []

        def fake_urlopen(request, timeout=10):
            calls.append(request.full_url)
            return Response(("BEGIN:VCALENDAR\n" + request.full_url).encode())

        with patch.object(ical, "USER_CONFIG", self.config), patch.object(ical, "urlopen", fake_urlopen):
            alice = ical.fetch_ical("alice")
            bob = ical.fetch_ical("bob")
            self.assertEqual(alice, ical.fetch_ical("alice"))

        self.assertIn(b"alice.ics", alice)
        self.assertIn(b"bob.ics", bob)
        self.assertEqual(calls, [
            "https://calendar.example/alice.ics",
            "https://calendar.example/bob.ics",
        ])

    def test_unconfigured_non_admin_is_rejected(self):
        with patch.object(ical, "USER_CONFIG", self.config):
            with self.assertRaisesRegex(ValueError, "尚未配置"):
                ical.fetch_ical("charlie")

    def request(self, method, path, user=None, body=None):
        conn = http.client.HTTPConnection(self.server.server_address[0], self.server.server_address[1])
        headers = {"Content-Type": "application/json"}
        if user is not None:
            headers["X-Authenticated-User"] = user
        payload = None if body is None else json.dumps(body)
        conn.request(method, path, payload, headers)
        response = conn.getresponse()
        raw = response.read()
        conn.close()
        return response.status, json.loads(raw.decode("utf-8"))

    def setUpServer(self):
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), ical.Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDownServer(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)

    def test_calendar_api_isolated_by_authenticated_user(self):
        with patch.object(ical, "USER_CONFIG", self.config):
            self.setUpServer()
            try:
                status, body = self.request("GET", "/api/calendar", user="alice")
                self.assertEqual(status, 200)
                self.assertTrue(body["configured"])
                self.assertIn("alice.ics", body["url"])

                status, body = self.request(
                    "PUT", "/api/calendar", user="alice", body={"url": "https://calendar.example/new-alice.ics"}
                )
                self.assertEqual(status, 200)
                self.assertEqual(body["url"], "https://calendar.example/new-alice.ics")

                status, body = self.request("GET", "/api/calendar", user="bob")
                self.assertEqual(status, 200)
                self.assertIn("bob.ics", body["url"])

                status, body = self.request("DELETE", "/api/calendar", user="alice")
                self.assertEqual(status, 200)
                self.assertFalse(body["configured"])
                self.assertEqual(ical.load_user_urls(self.config)["bob"], "https://calendar.example/bob.ics")
            finally:
                self.tearDownServer()

    def test_calendar_api_requires_authenticated_user(self):
        with patch.object(ical, "USER_CONFIG", self.config):
            self.setUpServer()
            try:
                status, _ = self.request("GET", "/api/calendar")
                self.assertEqual(status, 401)
                status, _ = self.request("PUT", "/api/calendar", body={"url": "https://calendar.example/new.ics"})
                self.assertEqual(status, 401)
            finally:
                self.tearDownServer()

    def test_calendar_api_rejects_invalid_url_without_writing(self):
        with patch.object(ical, "USER_CONFIG", self.config):
            self.setUpServer()
            try:
                status, _ = self.request("PUT", "/api/calendar", user="alice", body={"url": "http://127.0.0.1/a"})
                self.assertEqual(status, 400)
                self.assertIn("alice.ics", ical.load_user_urls(self.config)["alice"])
            finally:
                self.tearDownServer()

    def test_update_clears_only_current_user_cache(self):
        ical.CACHE.update({"alice": (b"old-a", 1), "bob": (b"old-b", 1)})
        with patch.object(ical, "USER_CONFIG", self.config):
            ical.update_user_url("alice", "https://calendar.example/new.ics", self.config)
        self.assertNotIn("alice", ical.CACHE)
        self.assertIn("bob", ical.CACHE)


if __name__ == "__main__":
    unittest.main()
