import base64
import hashlib
import hmac
import http.cookies
import json
import os
import re
import secrets
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

import bcrypt

USER = os.environ.get("AUTH_USER", "")
PASSWORD_HASH = os.environ.get("AUTH_HASH", "")
AUTH_USERS = os.environ.get("AUTH_USERS", "")
AUTH_USERS_FILE = os.environ.get("AUTH_USERS_FILE", "/app/data/users.json")
ADMIN_USER = os.environ.get("AUTH_ADMIN_USER", "kele")
SESSION_SECRET = os.environ.get("SESSION_SECRET", "")
SESSION_TTL = int(os.environ.get("SESSION_TTL", "86400"))
USER_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
MAX_USERS = 50
USERS_LOCK = threading.RLock()


def valid_username(value):
    return isinstance(value, str) and bool(USER_RE.fullmatch(value))


def is_admin(user):
    return user == ADMIN_USER


def load_env_users():
    """Parse one `username bcrypt-hash` record per line without logging secrets."""
    users = {}
    for line in AUTH_USERS.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        username, separator, password_hash = line.partition(" ")
        password_hash = password_hash.strip()
        if separator and valid_username(username) and password_hash:
            users[username] = password_hash
    if not users and USER and PASSWORD_HASH:
        users[USER] = PASSWORD_HASH
    return users


def read_user_file(path=None):
    path = AUTH_USERS_FILE if path is None else path
    try:
        with open(path, "r", encoding="utf-8") as fh:
            raw = json.load(fh)
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return {}
    if not isinstance(raw, dict):
        return {}
    return {
        user: password_hash.strip()
        for user, password_hash in raw.items()
        if valid_username(user)
        and isinstance(password_hash, str)
        and password_hash.strip()
    }


def write_user_file(users, path=None):
    path = AUTH_USERS_FILE if path is None else path
    directory = os.path.dirname(path) or "."
    os.makedirs(directory, exist_ok=True)
    extras = {
        user: password_hash
        for user, password_hash in users.items()
        if valid_username(user) and password_hash
    }
    fd, temporary = tempfile.mkstemp(prefix="users.", suffix=".tmp", dir=directory, text=True)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(extras, fh, ensure_ascii=False, indent=2)
            fh.write("\n")
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def load_users():
    env_users = load_env_users()
    file_users = read_user_file()
    if not os.path.exists(AUTH_USERS_FILE):
        extras = {user: password_hash for user, password_hash in env_users.items() if user != ADMIN_USER}
        directory = os.path.dirname(AUTH_USERS_FILE) or "."
        if extras and os.path.isdir(directory):
            try:
                write_user_file(extras)
                file_users = extras
            except OSError:
                file_users = extras
        elif extras:
            file_users = extras
    users = dict(env_users)
    users.update(file_users)
    if not users and env_users:
        users.update(env_users)
    return users


USERS = load_users()


def current_users():
    with USERS_LOCK:
        return dict(USERS)


def replace_users(users):
    with USERS_LOCK:
        USERS.clear()
        USERS.update(users)


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
        if int(expiry) < int(time.time()) or user not in current_users():
            return None
        return user
    except (ValueError, TypeError):
        return None


def hash_password(password):
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def valid_password(password):
    return isinstance(password, str) and 8 <= len(password) <= 128


def verify_password(password, password_hash):
    if not isinstance(password, str) or not password_hash:
        return False
    try:
        return bcrypt.checkpw(password.encode(), password_hash.encode())
    except (ValueError, TypeError):
        return False


def persist_users(users):
    write_user_file(users)
    replace_users(users)


def public_user(user):
    return {"user": user, "admin": is_admin(user)}


def json_response(handler, status, body, headers=None):
    raw = json.dumps(body, ensure_ascii=False).encode()
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(raw)))
    for key, value in (headers or {}).items():
        handler.send_header(key, value)
    handler.end_headers()
    handler.wfile.write(raw)


def json_body(handler, max_length=4096):
    try:
        length = int(handler.headers.get("Content-Length", "0"))
    except ValueError as exc:
        raise ValueError("invalid content length") from exc
    if length <= 0 or length > max_length:
        raise ValueError("invalid content length")
    try:
        body = json.loads(handler.rfile.read(length).decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError("invalid request") from exc
    if not isinstance(body, dict):
        raise ValueError("invalid request")
    return body


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass

    def do_GET(self):
        path = urlsplit(self.path).path
        if path == "/health":
            json_response(self, 200, {"ok": True})
            return
        if path == "/auth/me":
            user = self.current_user()
            if user:
                json_response(
                    self,
                    200,
                    {"authenticated": True, "user": user, "admin": is_admin(user)},
                    {"Cache-Control": "no-store"},
                )
            else:
                json_response(self, 401, {"authenticated": False, "error": "unauthorized"}, {"Cache-Control": "no-store"})
            return
        if path == "/auth/users":
            self._users_get()
            return
        if path != "/auth/check":
            json_response(self, 404, {"error": "not found"})
            return
        user = self.current_user()
        if user:
            json_response(self, 200, {"authenticated": True, "user": user}, {"X-Authenticated-User": user})
        else:
            json_response(self, 302, {"authenticated": False}, {"Location": "/login-v2/"})

    def do_POST(self):
        path = urlsplit(self.path).path
        if path == "/auth/logout":
            # Sessions are stateless; this removes the browser cookie but cannot revoke a copied token before its TTL.
            cookie = "session=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Lax"
            json_response(self, 200, {"ok": True}, {"Set-Cookie": cookie, "Cache-Control": "no-store"})
            return
        if path == "/auth/users":
            self._users_create()
            return
        if path == "/auth/password":
            self._password_change()
            return
        if path != "/auth/login":
            json_response(self, 404, {"error": "not found"})
            return
        try:
            data = json_body(self)
            username = str(data.get("username", "")).strip()
            password = str(data.get("password", ""))
        except (ValueError, TypeError):
            json_response(self, 400, {"error": "invalid request"})
            return
        password_hash = current_users().get(username)
        if not verify_password(password, password_hash):
            json_response(self, 401, {"error": "invalid credentials"})
            return
        cookie = f"session={make_session(username)}; Path=/; Max-Age={SESSION_TTL}; HttpOnly; Secure; SameSite=Lax"
        json_response(self, 200, {"ok": True, "user": username, "admin": is_admin(username)}, {"Set-Cookie": cookie})

    def do_DELETE(self):
        if urlsplit(self.path).path == "/auth/users":
            self._users_delete()
            return
        json_response(self, 404, {"error": "not found"})

    def current_user(self):
        cookies = http.cookies.SimpleCookie(self.headers.get("Cookie", ""))
        morsel = cookies.get("session")
        return valid_session(morsel.value) if morsel else None

    def require_admin(self):
        user = self.current_user()
        if not user:
            json_response(self, 401, {"error": "unauthorized"}, {"Cache-Control": "no-store"})
            return None
        if not is_admin(user):
            json_response(self, 403, {"error": "仅管理员可以管理账号"}, {"Cache-Control": "no-store"})
            return None
        return user

    def _users_get(self):
        if not self.require_admin():
            return
        users = current_users()
        names = sorted(users, key=lambda name: (not is_admin(name), name))
        json_response(self, 200, {"users": [public_user(name) for name in names]}, {"Cache-Control": "no-store"})

    def _users_create(self):
        if not self.require_admin():
            return
        try:
            data = json_body(self)
            username = str(data.get("username", "")).strip()
            password = str(data.get("password", ""))
        except (ValueError, TypeError):
            json_response(self, 400, {"error": "invalid request"})
            return
        if not valid_username(username):
            json_response(self, 400, {"error": "用户名只能包含字母、数字、点、下划线或短横线"})
            return
        if is_admin(username):
            json_response(self, 400, {"error": "不能创建管理员账号"})
            return
        if not valid_password(password):
            json_response(self, 400, {"error": "密码长度需要 8 到 128 个字符"})
            return
        with USERS_LOCK:
            users = dict(USERS)
            if username in users:
                json_response(self, 409, {"error": "账号已存在"})
                return
            if len(users) >= MAX_USERS:
                json_response(self, 400, {"error": "账号数量已达上限"})
                return
            users[username] = hash_password(password)
            try:
                persist_users(users)
            except OSError:
                json_response(self, 500, {"error": "保存账号失败"})
                return
        json_response(self, 200, {"ok": True, "user": public_user(username)})

    def _users_delete(self):
        if not self.require_admin():
            return
        try:
            data = json_body(self)
            username = str(data.get("username", "")).strip()
        except (ValueError, TypeError):
            json_response(self, 400, {"error": "invalid request"})
            return
        if not valid_username(username):
            json_response(self, 400, {"error": "用户名无效"})
            return
        if is_admin(username):
            json_response(self, 400, {"error": "不能删除管理员账号"})
            return
        with USERS_LOCK:
            users = dict(USERS)
            if username not in users:
                json_response(self, 404, {"error": "账号不存在"})
                return
            users.pop(username, None)
            try:
                persist_users(users)
            except OSError:
                json_response(self, 500, {"error": "删除账号失败"})
                return
        json_response(self, 200, {"ok": True, "user": username})

    def _password_change(self):
        user = self.current_user()
        if not user:
            json_response(self, 401, {"error": "unauthorized"}, {"Cache-Control": "no-store"})
            return
        try:
            data = json_body(self)
            current = str(data.get("current_password", "") or "")
            new_password = str(data.get("new_password", "") or "")
            target = str(data.get("username", "") or "").strip() or user
        except (ValueError, TypeError):
            json_response(self, 400, {"error": "invalid request"})
            return
        if not valid_password(new_password):
            json_response(self, 400, {"error": "新密码长度需要 8 到 128 个字符"})
            return
        changing_self = target == user
        if not changing_self and not is_admin(user):
            json_response(self, 403, {"error": "仅管理员可以修改其他账号密码"}, {"Cache-Control": "no-store"})
            return
        if not valid_username(target):
            json_response(self, 400, {"error": "用户名无效"})
            return
        with USERS_LOCK:
            users = dict(USERS)
            password_hash = users.get(target)
            if not password_hash:
                json_response(self, 404, {"error": "账号不存在"})
                return
            if changing_self:
                if not verify_password(current, password_hash):
                    json_response(self, 400, {"error": "原密码不正确"})
                    return
            users[target] = hash_password(new_password)
            try:
                persist_users(users)
            except OSError:
                json_response(self, 500, {"error": "保存密码失败"})
                return
        json_response(self, 200, {"ok": True, "user": public_user(target)})


if __name__ == "__main__":
    if not SESSION_SECRET:
        raise SystemExit("SESSION_SECRET is required")
    ThreadingHTTPServer(("0.0.0.0", 8080), Handler).serve_forever()
