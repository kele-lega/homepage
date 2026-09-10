import base64
import hashlib
import hmac
import http.cookies
import json
import os
import re
import secrets
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

import bcrypt

USER = os.environ.get("AUTH_USER", "")
PASSWORD_HASH = os.environ.get("AUTH_HASH", "")
AUTH_USERS = os.environ.get("AUTH_USERS", "")
SESSION_SECRET = os.environ.get("SESSION_SECRET", "")
SESSION_TTL = int(os.environ.get("SESSION_TTL", "86400"))


def load_users():
    """Parse one `username bcrypt-hash` record per line without logging secrets."""
    users = {}
    for line in AUTH_USERS.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        username, separator, password_hash = line.partition(" ")
        password_hash = password_hash.strip()
        if separator and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,63}", username) and password_hash:
            users[username] = password_hash
    if not users and USER and PASSWORD_HASH:
        users[USER] = PASSWORD_HASH
    return users


USERS = load_users()


def sign(value):
    digest = hmac.new(SESSION_SECRET.encode(), value.encode(), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(digest).decode().rstrip("=")


def make_session(user):
    payload = f"{user}|{int(time.time()) + SESSION_TTL}|{secrets.token_urlsafe(12)}"
    return payload + "." + sign(payload)


def valid_session(token):
    try:
        payload, signature = token.rsplit(".", 1)
        user, expiry, _nonce = payload.split("|", 2)
        if not hmac.compare_digest(signature, sign(payload)):
            return None
        if int(expiry) < int(time.time()) or user not in USERS:
            return None
        return user
    except (ValueError, TypeError):
        return None


def json_response(handler, status, body, headers=None):
    raw = json.dumps(body, ensure_ascii=False).encode()
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(raw)))
    for key, value in (headers or {}).items():
        handler.send_header(key, value)
    handler.end_headers()
    handler.wfile.write(raw)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass

    def do_GET(self):
        if self.path == "/health":
            json_response(self, 200, {"ok": True})
            return
        if urlsplit(self.path).path == "/auth/me":
            user = self.current_user()
            if user:
                json_response(self, 200, {"authenticated": True, "user": user}, {"Cache-Control": "no-store"})
            else:
                json_response(self, 401, {"authenticated": False, "error": "unauthorized"}, {"Cache-Control": "no-store"})
            return
        if urlsplit(self.path).path != "/auth/check":
            json_response(self, 404, {"error": "not found"})
            return
        user = self.current_user()
        if user:
            json_response(self, 200, {"authenticated": True, "user": user}, {"X-Authenticated-User": user})
        else:
            json_response(self, 302, {"authenticated": False}, {"Location": "/login-v2/"})

    def do_POST(self):
        if self.path == "/auth/logout":
            # Sessions are stateless; this removes the browser cookie but cannot revoke a copied token before its TTL.
            cookie = "session=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Lax"
            json_response(self, 200, {"ok": True}, {"Set-Cookie": cookie, "Cache-Control": "no-store"})
            return
        if self.path != "/auth/login":
            json_response(self, 404, {"error": "not found"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > 4096:
                raise ValueError("invalid content length")
            data = json.loads(self.rfile.read(length))
            if not isinstance(data, dict):
                raise ValueError("invalid request body")
            username = str(data.get("username", "")).strip()
            password = str(data.get("password", ""))
        except (ValueError, json.JSONDecodeError, UnicodeDecodeError):
            json_response(self, 400, {"error": "invalid request"})
            return
        password_hash = USERS.get(username)
        if not password_hash:
            json_response(self, 401, {"error": "invalid credentials"})
            return
        try:
            accepted = bcrypt.checkpw(password.encode(), password_hash.encode())
        except ValueError:
            accepted = False
        if not accepted:
            json_response(self, 401, {"error": "invalid credentials"})
            return
        cookie = f"session={make_session(username)}; Path=/; Max-Age={SESSION_TTL}; HttpOnly; Secure; SameSite=Lax"
        json_response(self, 200, {"ok": True, "user": username}, {"Set-Cookie": cookie})

    def current_user(self):
        cookies = http.cookies.SimpleCookie(self.headers.get("Cookie", ""))
        morsel = cookies.get("session")
        return valid_session(morsel.value) if morsel else None


if __name__ == "__main__":
    if not SESSION_SECRET:
        raise SystemExit("SESSION_SECRET is required")
    ThreadingHTTPServer(("0.0.0.0", 8080), Handler).serve_forever()
