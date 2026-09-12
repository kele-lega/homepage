import base64
import hashlib
import hmac
import http.client
import http.cookies
import json
import os
import secrets
import tempfile
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
            spec.AUTH_USERS_FILE = os.path.join(tempfile.mkdtemp(prefix="auth-users-"), "users.json")
            spec.ADMIN_USER = "kele"
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
            spec.AUTH_USERS_FILE = os.path.join(tempfile.mkdtemp(prefix="auth-users-"), "users.json")
            spec.ADMIN_USER = "kele"
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
                self.assertEqual(body, {"authenticated": True, "user": "kele", "admin": True})
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

    def request(self, spec, server, method, path, body=None, token=None):
        conn = http.client.HTTPConnection("127.0.0.1", server.server_port)
        headers = {"Content-Type": "application/json"}
        if token:
            headers["Cookie"] = "session=" + token
        payload = None if body is None else json.dumps(body)
        conn.request(method, path, payload, headers)
        response = conn.getresponse()
        raw = response.read()
        conn.close()
        parsed = json.loads(raw.decode("utf-8")) if raw else {}
        return response.status, parsed, response

    def test_me_marks_only_kele_as_admin(self):
        spec = __import__("auth", fromlist=["Handler"])
        kele_hash = bcrypt.hashpw(b"kele-pass", bcrypt.gensalt()).decode()
        wzj_hash = bcrypt.hashpw(b"wzj-pass", bcrypt.gensalt()).decode()
        with mock.patch.object(spec, "USERS", {"kele": kele_hash, "wzj": wzj_hash}), mock.patch.object(
            spec, "SESSION_SECRET", "test-secret"
        ), mock.patch.object(spec, "ADMIN_USER", "kele"):
            server = ThreadingHTTPServer(("127.0.0.1", 0), spec.Handler)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                status, body, _ = self.request(spec, server, "GET", "/auth/me", token=spec.make_session("kele"))
                self.assertEqual(status, 200)
                self.assertEqual(body, {"authenticated": True, "user": "kele", "admin": True})
                status, body, _ = self.request(spec, server, "GET", "/auth/me", token=spec.make_session("wzj"))
                self.assertEqual(status, 200)
                self.assertEqual(body, {"authenticated": True, "user": "wzj", "admin": False})
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=2)

    def test_only_admin_can_manage_users(self):
        spec = __import__("auth", fromlist=["Handler"])
        directory = tempfile.mkdtemp(prefix="auth-users-")
        users_file = os.path.join(directory, "users.json")
        kele_hash = bcrypt.hashpw(b"kele-pass", bcrypt.gensalt()).decode()
        wzj_hash = bcrypt.hashpw(b"wzj-pass", bcrypt.gensalt()).decode()
        with mock.patch.object(spec, "USERS", {"kele": kele_hash, "wzj": wzj_hash}), mock.patch.object(
            spec, "SESSION_SECRET", "test-secret"
        ), mock.patch.object(spec, "ADMIN_USER", "kele"), mock.patch.object(spec, "AUTH_USERS_FILE", users_file):
            server = ThreadingHTTPServer(("127.0.0.1", 0), spec.Handler)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                status, _, _ = self.request(spec, server, "GET", "/auth/users")
                self.assertEqual(status, 401)
                status, body, _ = self.request(spec, server, "GET", "/auth/users", token=spec.make_session("wzj"))
                self.assertEqual(status, 403)
                self.assertIn("管理员", body["error"])

                status, body, _ = self.request(spec, server, "GET", "/auth/users", token=spec.make_session("kele"))
                self.assertEqual(status, 200)
                self.assertEqual([item["user"] for item in body["users"]], ["kele", "wzj"])
                self.assertTrue(body["users"][0]["admin"])
                self.assertFalse(body["users"][1]["admin"])

                status, body, _ = self.request(
                    spec, server, "POST", "/auth/users",
                    body={"username": "hannah", "password": "secret-pass"},
                    token=spec.make_session("wzj"),
                )
                self.assertEqual(status, 403)

                status, body, _ = self.request(
                    spec, server, "POST", "/auth/users",
                    body={"username": "hannah", "password": "secret-pass"},
                    token=spec.make_session("kele"),
                )
                self.assertEqual(status, 200)
                self.assertEqual(body["user"]["user"], "hannah")
                self.assertFalse(body["user"]["admin"])
                self.assertIn("hannah", spec.USERS)
                with open(users_file, encoding="utf-8") as fh:
                    saved = json.load(fh)
                self.assertIn("kele", saved)
                self.assertIn("hannah", saved)

                status, body, _ = self.request(
                    spec, server, "POST", "/auth/login",
                    body={"username": "hannah", "password": "secret-pass"},
                )
                self.assertEqual(status, 200)
                self.assertFalse(body["admin"])

                status, _, _ = self.request(
                    spec, server, "DELETE", "/auth/users",
                    body={"username": "kele"},
                    token=spec.make_session("kele"),
                )
                self.assertEqual(status, 400)
                self.assertIn("kele", spec.USERS)

                status, body, _ = self.request(
                    spec, server, "DELETE", "/auth/users",
                    body={"username": "wzj"},
                    token=spec.make_session("kele"),
                )
                self.assertEqual(status, 200)
                self.assertNotIn("wzj", spec.USERS)
                self.assertIn("hannah", spec.USERS)
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=2)

    def test_password_change_requires_current_except_admin_reset(self):
        spec = __import__("auth", fromlist=["Handler"])
        directory = tempfile.mkdtemp(prefix="auth-users-")
        users_file = os.path.join(directory, "users.json")
        kele_hash = bcrypt.hashpw(b"kele-pass", bcrypt.gensalt()).decode()
        wzj_hash = bcrypt.hashpw(b"wzj-pass", bcrypt.gensalt()).decode()
        with mock.patch.object(spec, "USERS", {"kele": kele_hash, "wzj": wzj_hash}), mock.patch.object(
            spec, "SESSION_SECRET", "test-secret"
        ), mock.patch.object(spec, "ADMIN_USER", "kele"), mock.patch.object(spec, "AUTH_USERS_FILE", users_file):
            server = ThreadingHTTPServer(("127.0.0.1", 0), spec.Handler)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                status, body, _ = self.request(
                    spec, server, "POST", "/auth/password",
                    body={"new_password": "new-secret"},
                    token=spec.make_session("wzj"),
                )
                self.assertEqual(status, 400)
                self.assertIn("原密码", body["error"])

                status, body, _ = self.request(
                    spec, server, "POST", "/auth/password",
                    body={"current_password": "wrong-pass", "new_password": "new-secret"},
                    token=spec.make_session("wzj"),
                )
                self.assertEqual(status, 400)
                self.assertIn("原密码", body["error"])

                status, body, _ = self.request(
                    spec, server, "POST", "/auth/password",
                    body={"username": "kele", "new_password": "hijacked-pass"},
                    token=spec.make_session("wzj"),
                )
                self.assertEqual(status, 403)

                status, body, _ = self.request(
                    spec, server, "POST", "/auth/password",
                    body={"current_password": "wzj-pass", "new_password": "new-secret"},
                    token=spec.make_session("wzj"),
                )
                self.assertEqual(status, 200)
                status, body, _ = self.request(
                    spec, server, "POST", "/auth/login",
                    body={"username": "wzj", "password": "new-secret"},
                )
                self.assertEqual(status, 200)
                self.assertFalse(body["admin"])

                status, body, _ = self.request(
                    spec, server, "POST", "/auth/password",
                    body={"username": "wzj", "new_password": "admin-reset"},
                    token=spec.make_session("kele"),
                )
                self.assertEqual(status, 200)
                status, body, _ = self.request(
                    spec, server, "POST", "/auth/login",
                    body={"username": "wzj", "password": "admin-reset"},
                )
                self.assertEqual(status, 200)
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=2)


if __name__ == "__main__":
    unittest.main()
