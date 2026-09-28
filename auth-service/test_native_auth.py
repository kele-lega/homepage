import http.client
import json
import threading
import unittest
from http.server import ThreadingHTTPServer
from unittest import mock

import bcrypt

import auth


class NativeAuthTests(unittest.TestCase):
    def setUp(self):
        self.password_hash = bcrypt.hashpw(b"existing-password", bcrypt.gensalt(rounds=4)).decode()
        for key, value in {
            "USERS": {"kele": self.password_hash, "wzj": self.password_hash},
            "ADMIN_USER": "kele",
            "SESSION_SECRET": "native-session-test-secret",
            "AUTH_BRIDGE_SECRET": "internal-test-key",
            "HOMEPAGE_SESSION_URL": "http://homepage:3000/api/auth/session",
        }.items():
            patcher = mock.patch.object(auth, key, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), auth.Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.stop_server)

    def stop_server(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)

    def request(self, method, path, body=None, headers=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=5)
        conn.request(method, path, None if body is None else json.dumps(body), headers or {})
        response = conn.getresponse()
        result = response.status, json.loads(response.read()), dict(response.getheaders())
        conn.close()
        return result

    def session(self, user="kele", version=None):
        response = mock.MagicMock()
        response.__enter__.return_value = response
        response.status = 200
        response.read.return_value = json.dumps({"user": {
            "name": user,
            "credentialVersion": version if version is not None else auth.credential_version(self.password_hash),
        }}).encode()
        return mock.patch.object(auth, "urlopen", return_value=response)

    def test_verifier_requires_private_bridge_secret(self):
        body = {"username": "kele", "password": "existing-password"}
        for headers in ({}, {"Authorization": "Bearer wrong"}, {"X-Authenticated-User": "kele"}):
            self.assertEqual(self.request("POST", "/internal/verify", body, headers)[0], 403)
        status, user, headers = self.request("POST", "/internal/verify", body, {"Authorization": "Bearer internal-test-key"})
        self.assertEqual(status, 200)
        self.assertEqual(user["id"], "kele")
        self.assertEqual(user["name"], "kele")
        self.assertEqual(user["credentialVersion"], auth.credential_version(self.password_hash))
        self.assertNotIn("Set-Cookie", headers)
        self.assertNotIn("password", json.dumps(user))

    def test_verifier_rejects_invalid_password_and_malformed_body(self):
        headers = {"Authorization": "Bearer internal-test-key"}
        for username in ("kele", "unknown"):
            self.assertEqual(self.request("POST", "/internal/verify", {"username": username, "password": "wrong"}, headers)[0], 401)
        for body in ([], None, {"username": "../kele", "password": "x"}, {"username": "kele", "password": 5}):
            self.assertEqual(self.request("POST", "/internal/verify", body, headers)[0], 400)

    def test_native_session_preserves_identity_and_ignores_spoofed_header(self):
        with self.session("wzj") as fetch:
            status, body, _ = self.request("GET", "/auth/me", headers={
                "Cookie": "__Secure-next-auth.session-token=native-token",
                "X-Authenticated-User": "kele",
            })
        self.assertEqual(status, 200)
        self.assertEqual(body, {"authenticated": True, "user": "wzj", "admin": False})
        request = fetch.call_args.args[0]
        self.assertEqual(request.full_url, auth.HOMEPAGE_SESSION_URL)
        self.assertNotIn("X-authenticated-user", request.headers)

    def test_deleted_users_and_changed_passwords_revoke_native_access(self):
        for user, version in (("deleted", None), ("kele", "old-password-version")):
            with self.session(user, version):
                self.assertEqual(self.request("GET", "/auth/me", headers={"Cookie": "native=value"})[0], 401)

    def test_native_auth_fails_closed(self):
        for error in (OSError("connection refused"), ValueError("malformed session")):
            with mock.patch.object(auth, "urlopen", side_effect=error):
                self.assertEqual(self.request("GET", "/auth/me", headers={"Cookie": "session=" + auth.make_session("kele")})[0], 401)
        with mock.patch.object(auth, "urlopen") as fetch:
            self.assertEqual(self.request("GET", "/auth/me", headers={"X-Authenticated-User": "kele"})[0], 401)
            fetch.assert_not_called()

    def test_native_mode_disables_legacy_login_and_logout(self):
        for path in ("/auth/login", "/auth/logout"):
            status, _, headers = self.request("POST", path, {"username": "kele", "password": "existing-password"})
            self.assertEqual(status, 410)
            self.assertNotIn("Set-Cookie", headers)

    def test_unauthenticated_page_redirects_and_apis_return_json(self):
        status, _, headers = self.request("GET", "/auth/check", headers={"X-Forwarded-Uri": "/?tab=home"})
        self.assertEqual(status, 302)
        self.assertEqual(headers["Location"], "/auth/signin?callbackUrl=%2F%3Ftab%3Dhome")
        for path in ("/api/services", "/fund-monitor/api/funds", "/calendar/api/calendar", "/steam-monitor/api/steam"):
            self.assertEqual(self.request("GET", "/auth/check", headers={"X-Forwarded-Uri": path})[0], 401)
        self.assertEqual(self.request("GET", "/auth/check", headers={"X-Forwarded-Uri": "//evil.example"})[2]["Location"], "/auth/signin?callbackUrl=%2F")

    def test_admin_gate_rejects_normal_user(self):
        with self.session("wzj"):
            self.assertEqual(self.request("GET", "/auth/check-admin", headers={"Cookie": "native=value"})[0], 403)
        with self.session("kele"):
            status, _, headers = self.request("GET", "/auth/check-admin", headers={"Cookie": "native=value"})
            self.assertEqual(status, 200)
            self.assertEqual(headers["X-Authenticated-User"], "kele")


if __name__ == "__main__":
    unittest.main()
