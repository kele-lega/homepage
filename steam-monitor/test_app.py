import json
import os
import tempfile
import threading
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen

os.environ.setdefault("STEAM_DATA_DIR", tempfile.mkdtemp(prefix="steam-app-"))
os.environ["STEAM_API_KEY"] = "test-key"

import app  # noqa: E402
import steam_client as steam  # noqa: E402


PLAYER = {
    "steamid": "76561198000000000",
    "personaname": "kele",
    "profileurl": "https://steamcommunity.com/id/kele/",
    "avatarfull": "https://example.com/avatar.jpg",
    "personastate": 1,
    "communityvisibilitystate": 3,
}


def recent_payload():
    return {
        "response": {
            "total_count": 1,
            "games": [{
                "appid": 440,
                "name": "Team Fortress 2",
                "playtime_2weeks": 40,
                "playtime_forever": 2000,
                "img_icon_url": "tf2",
            }],
        }
    }


class SteamAPI(unittest.TestCase):
    def setUp(self):
        app.API_KEY = "test-key"
        self._orig = steam.steam_get
        steam.steam_get = self._fake_get
        self.addCleanup(setattr, steam, "steam_get", self._orig)
        d = tempfile.mkdtemp(prefix="steam-api-case-")
        self.backend = app.StoreManager(data_dir=d)
        self.srv = app.make_server("127.0.0.1", 0, store=self.backend)
        self.port = self.srv.server_address[1]
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()
        self.addCleanup(self.srv.shutdown)

    def _fake_get(self, path, params, timeout=10):
        if "GetPlayerSummaries" in path:
            return {"response": {"players": [PLAYER]}}
        if "GetRecentlyPlayedGames" in path:
            return recent_payload()
        if "GetOwnedGames" in path:
            return {"response": {"game_count": 0, "games": []}}
        raise AssertionError(path)

    def call(self, method, path, body=None, user="kele"):
        url = "http://127.0.0.1:%d%s" % (self.port, path)
        data = json.dumps(body).encode() if body is not None else None
        req = Request(url, data=data, method=method)
        if user:
            req.add_header("X-Authenticated-User", user)
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

    def test_healthz_without_user(self):
        status, body = self.call("GET", "/healthz", user=None)
        self.assertEqual(status, 200)
        self.assertTrue(body["ok"])

    def test_unbound_is_ok(self):
        status, body = self.call("GET", "/api/steam")
        self.assertEqual(status, 200)
        self.assertFalse(body["bound"])
        self.assertEqual(body["games"], [])
        self.assertIsNone(body["profile"])

    def test_missing_user_rejected(self):
        status, body = self.call("GET", "/api/steam", user=None)
        self.assertEqual(status, 401)
        self.assertIn("error", body)

    def test_bind_and_isolate(self):
        status, body = self.call("PUT", "/api/steam", {"url": "76561198000000000"}, user="alice")
        self.assertEqual(status, 200)
        self.assertTrue(body["bound"])
        self.assertEqual(body["profile"]["name"], "kele")
        self.assertEqual(body["games"][0]["name"], "Team Fortress 2")

        _, bob = self.call("GET", "/api/steam", user="bob")
        self.assertFalse(bob["bound"])
        _, alice = self.call("GET", "/api/steam", user="alice")
        self.assertTrue(alice["bound"])

    def test_invalid_url(self):
        status, body = self.call("PUT", "/api/steam", {"url": "https://example.com/not-steam"})
        self.assertEqual(status, 400)
        self.assertIn("error", body)

    def test_unbind(self):
        self.call("PUT", "/api/steam", {"url": "76561198000000000"})
        status, body = self.call("DELETE", "/api/steam")
        self.assertEqual(status, 200)
        self.assertFalse(body["bound"])

    def test_prefix_path(self):
        status, body = self.call("GET", "/steam-monitor/api/steam")
        self.assertEqual(status, 200)
        self.assertFalse(body["bound"])

    def test_img_rejects_bad_host(self):
        status, body = self.call("GET", "/img?url=https://example.com/x.png", user=None)
        self.assertEqual(status, 400)
        self.assertIn("error", body)


if __name__ == "__main__":
    unittest.main()
