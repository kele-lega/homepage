import base64
import hashlib
import hmac
import http.client
import http.cookies
import json
import os
import secrets
import threading
import time
import unittest
from http.server import ThreadingHTTPServer
from unittest import mock

import bcrypt


class AuthTests(unittest.TestCase):
    def test_multiple_users_and_sessions(self):
        with mock.patch.dict(os.environ, {
            "AUTH_USERS": "kele " + bcrypt.hashpw(b"kele-pass", bcrypt.gensalt()).decode() + "\nwzj " + bcrypt.hashpw(b"wzj-pass", bcrypt.gensalt()).decode(),
            "AUTH_USER": "",
            "AUTH_HASH": "",
            "SESSION_SECRET": "test-secret",
        }, clear=False):
            spec = __import__("auth", fromlist=["load_users"])
            spec.AUTH_USERS = os.environ["AUTH_USERS"]
            spec.USER = ""
            spec.PASSWORD_HASH = ""
            users = spec.load_users()
            self.assertEqual(set(users), {"kele", "wzj"})
            with mock.patch.object(spec, "USERS", users):
                kele_token = spec.make_session("kele")
                wzj_token = spec.make_session("wzj")
                self.assertEqual(spec.valid_session(kele_token), "kele")
                self.assertEqual(spec.valid_session(wzj_token), "wzj")
                self.assertIsNone(spec.valid_session(spec.make_session("unknown")))

    def test_legacy_single_user_fallback(self):
        password_hash = bcrypt.hashpw(b"secret", bcrypt.gensalt()).decode()
        with mock.patch.dict(os.environ, {
            "AUTH_USERS": "",
            "AUTH_USER": "kele",
            "AUTH_HASH": password_hash,
        }, clear=False):
            spec = __import__("auth", fromlist=["load_users"])
            spec.AUTH_USERS = ""
            spec.USER = "kele"
            spec.PASSWORD_HASH = password_hash
            self.assertEqual(spec.load_users(), {"kele": password_hash})

    def test_login_rejects_invalid_body_shapes_and_lengths(self):
        spec = __import__("auth", fromlist=["Handler"])
        with mock.patch.object(spec, "USERS", {}):
            server = ThreadingHTTPServer(("127.0.0.1", 0), spec.Handler)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                for payload in (b"[]", b"null", b'"text"'):
                    with self.subTest(payload=payload):
                        conn = http.client.HTTPConnection("127.0.0.1", server.server_port)
                        conn.request(
                            "POST",
                            "/auth/login",
                            body=payload,
                            headers={"Content-Type": "application/json"},
                        )
                        response = conn.getresponse()
                        self.assertEqual(response.status, 400)
                        response.read()
                        conn.close()

                conn = http.client.HTTPConnection("127.0.0.1", server.server_port)
                conn.request(
                    "POST",
                    "/auth/login",
                    body=b"{}" + b" " * 4096,
                    headers={"Content-Type": "application/json"},
                )
                response = conn.getresponse()
                self.assertEqual(response.status, 400)
                response.read()
                conn.close()
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=2)

    def test_auth_service_me_and_logout(self):
        spec = __import__("auth", fromlist=["Handler"])
        password_hash = bcrypt.hashpw(b"secret", bcrypt.gensalt()).decode()
        with mock.patch.object(spec, "USERS", {"kele": password_hash}), mock.patch.object(spec, "SESSION_SECRET", "test-secret"):
            server = ThreadingHTTPServer(("127.0.0.1", 0), spec.Handler)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                token = spec.make_session("kele")
                conn = http.client.HTTPConnection("127.0.0.1", server.server_port)
                conn.request("GET", "/auth/me", headers={"Cookie": "session=" + token})
                response = conn.getresponse()
                body = json.loads(response.read())
                self.assertEqual(response.status, 200)
                self.assertEqual(body, {"authenticated": True, "user": "kele"})
                self.assertEqual(response.getheader("Cache-Control"), "no-store")
                conn.close()

                conn = http.client.HTTPConnection("127.0.0.1", server.server_port)
                conn.request("GET", "/auth/me")
                response = conn.getresponse()
                body = json.loads(response.read())
                self.assertEqual(response.status, 401)
                self.assertFalse(body["authenticated"])
                self.assertIsNone(response.getheader("Location"))
                conn.close()

                conn = http.client.HTTPConnection("127.0.0.1", server.server_port)
                conn.request("POST", "/auth/logout")
                response = conn.getresponse()
                self.assertEqual(response.status, 200)
                self.assertEqual(json.loads(response.read()), {"ok": True})
                cookie = response.getheader("Set-Cookie")
                self.assertIn("session=", cookie)
                self.assertIn("Path=/", cookie)
                self.assertIn("Max-Age=0", cookie)
                self.assertIn("Expires=Thu, 01 Jan 1970 00:00:00 GMT", cookie)
                self.assertIn("HttpOnly", cookie)
                self.assertIn("Secure", cookie)
                self.assertIn("SameSite=Lax", cookie)
                conn.close()
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=2)


if __name__ == "__main__":
    unittest.main()
