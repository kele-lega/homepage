import unittest

import steam_client as steam


PLAYER = {
    "steamid": "76561198000000000",
    "personaname": "kele",
    "profileurl": "https://steamcommunity.com/id/kele/",
    "avatarfull": "https://example.com/avatar.jpg",
    "personastate": 1,
    "communityvisibilitystate": 3,
    "gameid": "730",
    "gameextrainfo": "Counter-Strike 2",
}

RECENT = {
    "response": {
        "total_count": 1,
        "games": [{
            "appid": 730,
            "name": "Counter-Strike 2",
            "playtime_2weeks": 125,
            "playtime_forever": 5400,
            "img_icon_url": "abc123",
        }],
    }
}


class ParseInputTests(unittest.TestCase):
    def test_profile_url(self):
        self.assertEqual(
            steam.parse_profile_input("https://steamcommunity.com/profiles/76561198000000000"),
            ("steamid", "76561198000000000"),
        )

    def test_vanity_url(self):
        self.assertEqual(
            steam.parse_profile_input("https://steamcommunity.com/id/kelelega/"),
            ("vanity", "kelelega"),
        )

    def test_raw_steamid(self):
        self.assertEqual(steam.parse_profile_input("76561198000000000"), ("steamid", "76561198000000000"))

    def test_rejects_empty(self):
        with self.assertRaises(steam.SteamAPIError):
            steam.parse_profile_input("  ")


class SnapshotTests(unittest.TestCase):
    def setUp(self):
        self.calls = []
        self.replies = {}
        self._orig = steam.steam_get
        steam.steam_get = self._fake_get
        self.addCleanup(setattr, steam, "steam_get", self._orig)

    def _fake_get(self, path, params, timeout=10):
        self.calls.append(path)
        if "GetPlayerSummaries" in path:
            return {"response": {"players": [PLAYER]}}
        if "GetRecentlyPlayedGames" in path:
            return self.replies.get("recent", RECENT)
        if "GetOwnedGames" in path:
            return self.replies.get("owned", {"response": {"game_count": 0, "games": []}})
        if "ResolveVanityURL" in path:
            return {"response": {"success": 1, "steamid": "76561198000000000"}}
        raise AssertionError(path)

    def test_snapshot_fields(self):
        data = steam.fetch_snapshot("key", "76561198000000000")
        self.assertEqual(data["profile"]["name"], "kele")
        self.assertEqual(data["profile"]["playing"]["name"], "Counter-Strike 2")
        self.assertEqual(data["games"][0]["playtime_2weeks"], 125)
        self.assertIn("730/abc123.jpg", data["games"][0]["icon"])
        self.assertIn("/apps/730/header.jpg", data["games"][0]["header"])
        self.assertFalse(data["private"])

    def test_hidden_games(self):
        self.replies["recent"] = {"response": {}}
        self.replies["owned"] = {"response": {}}
        data = steam.fetch_snapshot("key", "76561198000000000")
        self.assertTrue(data["private"])

    def test_no_recent_play_is_not_private(self):
        self.replies["recent"] = {"response": {"total_count": 0, "games": []}}
        data = steam.fetch_snapshot("key", "76561198000000000")
        self.assertFalse(data["private"])
        self.assertEqual(data["games"], [])

    def test_owned_last_played_fills_recent_list(self):
        self.replies["recent"] = {"response": {"total_count": 1, "games": [{
            "appid": 250900,
            "name": "The Binding of Isaac: Rebirth",
            "playtime_2weeks": 1230,
            "playtime_forever": 8040,
            "img_icon_url": "isaac",
        }]}}
        self.replies["owned"] = {"response": {"game_count": 2, "games": [
            {
                "appid": 250900,
                "name": "The Binding of Isaac: Rebirth",
                "playtime_forever": 8040,
                "rtime_last_played": 1_700_000_000,
                "img_icon_url": "isaac",
            },
            {
                "appid": 431960,
                "name": "Wallpaper Engine",
                "playtime_forever": 6593,
                "rtime_last_played": int(__import__("time").time()),
                "img_icon_url": "wp",
            },
        ]}}
        data = steam.fetch_snapshot("key", "76561198000000000")
        names = [game["name"] for game in data["games"]]
        self.assertEqual(names, ["The Binding of Isaac: Rebirth", "Wallpaper Engine"])
        self.assertEqual(data["games"][0]["playtime_2weeks"], 1230)
        self.assertEqual(data["games"][1]["playtime_2weeks"], 0)
        self.assertGreater(data["games"][1]["last_played"], 0)

    def test_old_owned_games_are_excluded(self):
        self.replies["recent"] = {"response": {"total_count": 0, "games": []}}
        self.replies["owned"] = {"response": {"game_count": 1, "games": [{
            "appid": 730,
            "name": "Counter-Strike 2",
            "playtime_forever": 100,
            "rtime_last_played": 1,
            "img_icon_url": "cs",
        }]}}
        data = steam.fetch_snapshot("key", "76561198000000000")
        self.assertEqual(data["games"], [])
        self.assertFalse(data["private"])

    def test_resolve_vanity(self):
        steamid = steam.resolve_steamid("key", "https://steamcommunity.com/id/kelelega")
        self.assertEqual(steamid, "76561198000000000")


if __name__ == "__main__":
    unittest.main()


class ImageProxyTests(unittest.TestCase):
    def test_rejects_non_steam_host(self):
        with self.assertRaises(steam.SteamAPIError):
            steam.fetch_image("https://example.com/avatar.jpg")

    def test_rejects_http(self):
        with self.assertRaises(steam.SteamAPIError):
            steam.fetch_image("http://avatars.steamstatic.com/a.jpg")
