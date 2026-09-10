"""iCal 多用户隔离和日历设置 API 测试。"""
import http.client
import importlib.util
import json
import os
import tempfile
import threading
import time
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
        self.closed = False

    def read(self, limit=-1):
        return self.body if limit < 0 else self.body[:limit]

    def close(self):
        self.closed = True


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
        ical.FETCH_LOCKS.clear()
        ical.FORCE_ATTEMPTED_AT.clear()

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
            return Response((
                "BEGIN:VCALENDAR\n"
                + request.full_url
                + "\nEND:VCALENDAR\n"
            ).encode())

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

    def test_preserves_recurrence_rules_for_homepage(self):
        body = (
            b"BEGIN:VCALENDAR\r\n"
            b"BEGIN:VEVENT\r\n"
            b"DTSTART;VALUE=DATE:20260910\r\n"
            b"RRULE:FREQ=MONTHLY;BYMONTHDAY=10\r\n"
            b"SUMMARY:monthly\r\n"
            b"END:VEVENT\r\n"
            b"END:VCALENDAR\r\n"
        )
        with patch.object(ical, "USER_CONFIG", self.config), patch.object(
            ical, "urlopen", return_value=Response(body)
        ):
            data = ical.fetch_ical("alice")

        self.assertIn(b"RRULE:FREQ=MONTHLY;BYMONTHDAY=10", data)
        self.assertEqual(data, body)

    def test_filter_ical_window_keeps_only_next_month(self):
        body = (
            b"BEGIN:VCALENDAR\r\n"
            b"VERSION:2.0\r\n"
            b"BEGIN:VEVENT\r\nUID:old\r\nDTSTART;VALUE=DATE:20260909\r\nDTEND;VALUE=DATE:20260910\r\nSUMMARY:old\r\nEND:VEVENT\r\n"
            b"BEGIN:VEVENT\r\nUID:today\r\nDTSTART;VALUE=DATE:20260910\r\nDTEND;VALUE=DATE:20260911\r\nSUMMARY:today\r\nEND:VEVENT\r\n"
            b"BEGIN:VEVENT\r\nUID:future\r\nDTSTART;VALUE=DATE:20261010\r\nDTEND;VALUE=DATE:20261011\r\nSUMMARY:future\r\nEND:VEVENT\r\n"
            b"BEGIN:VEVENT\r\nUID:far\r\nDTSTART;VALUE=DATE:20261110\r\nDTEND;VALUE=DATE:20261111\r\nSUMMARY:far\r\nEND:VEVENT\r\n"
            b"BEGIN:VEVENT\r\nUID:monthly\r\nDTSTART;VALUE=DATE:20260820\r\nRRULE:FREQ=MONTHLY;BYMONTHDAY=20\r\nSUMMARY:monthly\r\nEND:VEVENT\r\n"
            b"END:VCALENDAR\r\n"
        )
        filtered = ical.filter_ical_window(body, days=30, today=ical.date(2026, 9, 10))
        self.assertIn(b"SUMMARY:today", filtered)
        self.assertIn(b"SUMMARY:future", filtered)
        self.assertNotIn(b"SUMMARY:old", filtered)
        self.assertNotIn(b"SUMMARY:far", filtered)
        self.assertIn(b"SUMMARY:monthly", filtered)
        self.assertIn(b"UNTIL=20261010", filtered)

        calls = []

        def fake_urlopen(request, timeout=10):
            calls.append(request.full_url)
            return Response((
                "BEGIN:VCALENDAR\n"
                f"VERSION:{len(calls)}\n"
                "END:VCALENDAR\n"
            ).encode())

        ical.CACHE["bob"] = (b"bob-cache", 1)
        with patch.object(ical, "USER_CONFIG", self.config), patch.object(ical, "urlopen", fake_urlopen):
            first = ical.fetch_ical("alice")
            cached = ical.fetch_ical("alice")
            refreshed = ical.fetch_ical("alice", force=True)

        self.assertEqual(first, cached)
        self.assertNotEqual(first, refreshed)
        self.assertEqual(len(calls), 2)
        self.assertEqual(ical.CACHE["alice"][0], refreshed)
        self.assertEqual(ical.CACHE["bob"], (b"bob-cache", 1))

    def test_concurrent_cache_miss_fetches_upstream_once(self):
        calls = []
        barrier = threading.Barrier(3)
        results = []

        def fake_urlopen(request, timeout=10):
            calls.append(request.full_url)
            time.sleep(0.05)
            return Response(b"BEGIN:VCALENDAR\nEND:VCALENDAR\n")

        def worker():
            barrier.wait()
            results.append(ical.fetch_ical("alice"))

        with patch.object(ical, "USER_CONFIG", self.config), patch.object(ical, "urlopen", fake_urlopen):
            threads = [threading.Thread(target=worker) for _ in range(2)]
            for thread in threads:
                thread.start()
            barrier.wait()
            for thread in threads:
                thread.join(timeout=2)

        self.assertEqual(len(results), 2)
        self.assertEqual(len(calls), 1)

    def test_force_refresh_has_short_cooldown(self):
        calls = []

        def fake_urlopen(request, timeout=10):
            calls.append(request.full_url)
            return Response((
                "BEGIN:VCALENDAR\n"
                f"VERSION:{len(calls)}\n"
                "END:VCALENDAR\n"
            ).encode())

        with patch.object(ical, "USER_CONFIG", self.config), patch.object(ical, "urlopen", fake_urlopen):
            first = ical.fetch_ical("alice", force=True)
            second = ical.fetch_ical("alice", force=True)
            ical.update_user_url("alice", "https://calendar.example/new-alice.ics", self.config)
            third = ical.fetch_ical("alice", force=True)

        self.assertEqual(first, second)
        self.assertNotEqual(second, third)
        self.assertEqual(len(calls), 2)

    def test_failed_force_refresh_is_throttled(self):
        calls = []

        def fake_urlopen(request, timeout=10):
            calls.append(request.full_url)
            raise OSError("upstream unavailable")

        with patch.object(ical, "USER_CONFIG", self.config), patch.object(ical, "urlopen", fake_urlopen):
            with self.assertRaisesRegex(OSError, "upstream unavailable"):
                ical.fetch_ical("alice", force=True)
            with self.assertRaisesRegex(ValueError, "刚刚刷新过"):
                ical.fetch_ical("alice", force=True)

        self.assertEqual(len(calls), 1)

    def test_upstream_response_size_is_limited(self):
        oversized = b"BEGIN:VCALENDAR\n" + b"x" * 64 + b"\nEND:VCALENDAR\n"
        with patch.object(ical, "USER_CONFIG", self.config), patch.object(
            ical, "MAX_ICAL_BYTES", 32
        ), patch.object(ical, "urlopen", return_value=Response(oversized)):
            with self.assertRaisesRegex(ical.InvalidCalendarData, "过大"):
                ical.fetch_ical("alice")
        self.assertNotIn("alice", ical.CACHE)

    def test_url_update_cannot_restore_in_flight_old_cache(self):
        fetch_started = threading.Event()
        release_fetch = threading.Event()

        def fake_urlopen(request, timeout=10):
            fetch_started.set()
            release_fetch.wait(timeout=2)
            return Response(b"BEGIN:VCALENDAR\nOLD\nEND:VCALENDAR\n")

        with patch.object(ical, "USER_CONFIG", self.config), patch.object(ical, "urlopen", fake_urlopen):
            fetch_thread = threading.Thread(target=ical.fetch_ical, args=("alice",))
            update_thread = threading.Thread(
                target=ical.update_user_url,
                args=("alice", "https://calendar.example/new-alice.ics", self.config),
            )
            fetch_thread.start()
            self.assertTrue(fetch_started.wait(timeout=1))
            update_thread.start()
            try:
                time.sleep(0.05)
                self.assertTrue(update_thread.is_alive())
            finally:
                release_fetch.set()
            fetch_thread.join(timeout=2)
            update_thread.join(timeout=2)

        self.assertFalse(fetch_thread.is_alive())
        self.assertFalse(update_thread.is_alive())
        self.assertNotIn("alice", ical.CACHE)
        self.assertEqual(
            ical.load_user_urls(self.config)["alice"],
            "https://calendar.example/new-alice.ics",
        )

    def test_invalid_upstream_response_is_not_cached(self):
        with patch.object(ical, "USER_CONFIG", self.config), patch.object(
            ical, "urlopen", return_value=Response(b"<html>not a calendar</html>")
        ):
            with self.assertRaisesRegex(ical.InvalidCalendarData, "有效的 iCalendar"):
                ical.fetch_ical("alice")
        self.assertNotIn("alice", ical.CACHE)

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

    def test_refresh_api_forces_current_user_fetch(self):
        calls = []

        def fake_urlopen(request, timeout=10):
            calls.append(request.full_url)
            return Response(b"BEGIN:VCALENDAR\nEND:VCALENDAR\n")

        ical.CACHE.update({"alice": (b"old-a", 1), "bob": (b"old-b", 1)})
        with patch.object(ical, "USER_CONFIG", self.config), patch.object(ical, "urlopen", fake_urlopen):
            self.setUpServer()
            try:
                status, body = self.request("POST", "/api/calendar/refresh", user="alice")
            finally:
                self.tearDownServer()

        self.assertEqual(status, 200)
        self.assertEqual(body, {"ok": True, "refreshed": True, "bytes": 30})
        self.assertEqual(calls, ["https://calendar.example/alice.ics"])
        self.assertEqual(ical.CACHE["alice"][0], b"BEGIN:VCALENDAR\nEND:VCALENDAR\n")
        self.assertEqual(ical.CACHE["bob"], (b"old-b", 1))

    def test_refresh_api_requires_authenticated_configured_user(self):
        with patch.object(ical, "USER_CONFIG", self.config):
            self.setUpServer()
            try:
                status, _ = self.request("POST", "/api/calendar/refresh")
                self.assertEqual(status, 401)
                status, body = self.request("POST", "/api/calendar/refresh", user="charlie")
                self.assertEqual(status, 403)
                self.assertIn("尚未配置", body["error"])
            finally:
                self.tearDownServer()

    def test_refresh_api_reports_invalid_or_failed_upstream(self):
        for failure, expected_error in (
            (Response(b"<html>no calendar</html>"), "有效的 iCalendar"),
            (OSError("upstream unavailable"), "upstream unavailable"),
        ):
            with self.subTest(failure=failure):
                ical.CACHE.clear()
                ical.FORCE_ATTEMPTED_AT.clear()
                if isinstance(failure, Exception):
                    opener = patch.object(ical, "urlopen", side_effect=failure)
                else:
                    opener = patch.object(ical, "urlopen", return_value=failure)
                with patch.object(ical, "USER_CONFIG", self.config), opener:
                    self.setUpServer()
                    try:
                        status, body = self.request("POST", "/api/calendar/refresh", user="alice")
                    finally:
                        self.tearDownServer()
                self.assertEqual(status, 502)
                self.assertIn(expected_error, body["error"])
                self.assertNotIn("alice", ical.CACHE)

    def test_update_clears_only_current_user_cache(self):
        ical.CACHE.update({"alice": (b"old-a", 1), "bob": (b"old-b", 1)})
        with patch.object(ical, "USER_CONFIG", self.config):
            ical.update_user_url("alice", "https://calendar.example/new.ics", self.config)
        self.assertNotIn("alice", ical.CACHE)
        self.assertIn("bob", ical.CACHE)


if __name__ == "__main__":
    unittest.main()
