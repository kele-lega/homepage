"""Steam Web API 客户端。只用标准库，测试可替换 fetch_json。"""
import json
import re
import time
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode, urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener, urlopen

STEAM_API = "https://api.steampowered.com"
ICON_URL = "https://media.steampowered.com/steamcommunity/public/images/apps/%s/%s.jpg"
CAPSULE_URL = "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/%s/capsule_231x87.jpg"
HEADER_URL = "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/%s/header.jpg"

STEAMID_RE = re.compile(r"^\d{17}$")
PROFILE_RE = re.compile(r"steamcommunity\.com/profiles/(\d{17})", re.I)
VANITY_RE = re.compile(r"steamcommunity\.com/id/([A-Za-z0-9_-]+)/?", re.I)
VANITY_NAME_RE = re.compile(r"^[A-Za-z0-9_-]{2,64}$")
USER_AGENT = "homepage-steam-monitor/1.0"
TWO_WEEKS_SECONDS = 14 * 24 * 60 * 60

ALLOWED_IMAGE_HOSTS = frozenset({
    "avatars.steamstatic.com",
    "avatars.akamai.steamstatic.com",
    "media.steampowered.com",
    "cdn.akamai.steamstatic.com",
    "shared.akamai.steamstatic.com",
    "cdn.cloudflare.steamstatic.com",
    "steamcdn-a.akamaihd.net",
})
MAX_IMAGE_BYTES = 2 * 1024 * 1024


class AllowedImageRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        parsed = urlparse(newurl)
        host = (parsed.hostname or "").lower()
        if parsed.scheme != "https" or host not in ALLOWED_IMAGE_HOSTS:
            return None
        return HTTPRedirectHandler.redirect_request(self, req, fp, code, msg, headers, newurl)


def fetch_image(url, timeout=10):
    parsed = urlparse(url or "")
    host = (parsed.hostname or "").lower()
    if parsed.scheme != "https" or host not in ALLOWED_IMAGE_HOSTS:
        raise SteamAPIError("不支持的图片地址")
    request = Request(url, headers={"User-Agent": USER_AGENT})
    opener = build_opener(AllowedImageRedirect)
    try:
        with opener.open(request, timeout=timeout) as response:
            content_type = response.headers.get("Content-Type") or ""
            raw = response.read(MAX_IMAGE_BYTES + 1)
    except HTTPError as exc:
        raise SteamAPIError("图片 HTTP %s" % exc.code) from exc
    except URLError as exc:
        raise SteamAPIError("无法加载图片") from exc
    if len(raw) > MAX_IMAGE_BYTES:
        raise SteamAPIError("图片过大")
    kind = content_type.split(";")[0].strip().lower()
    if not kind.startswith("image/"):
        if raw.startswith(b"\x89PNG"):
            kind = "image/png"
        elif raw.startswith(b"\xff\xd8"):
            kind = "image/jpeg"
        else:
            raise SteamAPIError("不是图片")
    return kind, raw



class SteamAPIError(ValueError):
    """可展示给用户的 Steam 接口错误。"""


def parse_profile_input(raw):
    text = (raw or "").strip()
    if not text:
        raise SteamAPIError("请填写 Steam 主页链接或 17 位 SteamID")
    match = PROFILE_RE.search(text)
    if match:
        return "steamid", match.group(1)
    match = VANITY_RE.search(text)
    if match:
        return "vanity", match.group(1)
    if STEAMID_RE.match(text):
        return "steamid", text
    if VANITY_NAME_RE.match(text):
        return "vanity", text
    raise SteamAPIError("无法识别，请粘贴 steamcommunity.com 个人主页链接")


def fetch_json(url, timeout=10):
    request = Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urlopen(request, timeout=timeout) as response:
            raw = response.read(512 * 1024)
    except HTTPError as exc:
        raise SteamAPIError("Steam 接口 HTTP %s" % exc.code) from exc
    except URLError as exc:
        raise SteamAPIError("无法连接 Steam 接口") from exc
    try:
        data = json.loads(raw.decode("utf-8", "replace"))
    except json.JSONDecodeError as exc:
        raise SteamAPIError("Steam 接口返回了无法解析的数据") from exc
    if not isinstance(data, dict):
        raise SteamAPIError("Steam 接口返回格式异常")
    return data


def steam_get(path, params, timeout=10):
    url = "%s/%s?%s" % (STEAM_API, path, urlencode(params, quote_via=quote))
    return fetch_json(url, timeout=timeout)


def resolve_vanity(api_key, vanity, timeout=10):
    data = steam_get("ISteamUser/ResolveVanityURL/v1/", {
        "key": api_key,
        "vanityurl": vanity,
    }, timeout=timeout)
    response = data.get("response") if isinstance(data.get("response"), dict) else {}
    if response.get("success") == 1 and STEAMID_RE.match(str(response.get("steamid") or "")):
        return str(response["steamid"])
    raise SteamAPIError("找不到这个 Steam 主页，请确认链接可公开访问")


def resolve_steamid(api_key, raw, timeout=10):
    kind, value = parse_profile_input(raw)
    if kind == "steamid":
        return value
    if not api_key:
        raise SteamAPIError("管理员尚未配置 Steam API Key")
    return resolve_vanity(api_key, value, timeout=timeout)


def _game_images(appid, icon_hash):
    appid = str(appid)
    icon = ICON_URL % (appid, icon_hash) if icon_hash else ""
    return {
        "icon": icon,
        "capsule": CAPSULE_URL % appid,
        "header": HEADER_URL % appid,
    }


def _profile_from_player(player):
    visibility = player.get("communityvisibilitystate")
    game_id = str(player.get("gameid") or "").strip()
    game_name = (player.get("gameextrainfo") or "").strip()
    playing = None
    if game_id.isdigit() and game_name:
        playing = {"appid": int(game_id), "name": game_name}
    elif game_id.isdigit():
        playing = {"appid": int(game_id), "name": "游戏中"}
    elif game_name:
        playing = {"appid": None, "name": game_name}
    return {
        "steamid": str(player.get("steamid") or ""),
        "name": player.get("personaname") or "Steam 用户",
        "avatar": player.get("avatarfull") or player.get("avatarmedium") or player.get("avatar") or "",
        "avatar_medium": player.get("avatarmedium") or "",
        "avatar_small": player.get("avatar") or "",
        "profile_url": player.get("profileurl") or "",
        "online": int(player.get("personastate") or 0) > 0,
        "public": visibility == 3,
        "playing": playing,
    }


def _normalize_game(item):
    if not isinstance(item, dict):
        return None
    appid = item.get("appid")
    try:
        appid = int(appid)
    except (TypeError, ValueError):
        return None
    images = _game_images(appid, item.get("img_icon_url") or "")
    return {
        "appid": appid,
        "name": item.get("name") or "未知游戏",
        "playtime_2weeks": int(item.get("playtime_2weeks") or 0),
        "playtime_forever": int(item.get("playtime_forever") or 0),
        "last_played": int(item.get("rtime_last_played") or 0),
        "icon": images["icon"],
        "capsule": images["capsule"],
        "header": images["header"],
    }


def _merge_game(target, incoming):
    if incoming["playtime_2weeks"] > target["playtime_2weeks"]:
        target["playtime_2weeks"] = incoming["playtime_2weeks"]
    if incoming["playtime_forever"] > target["playtime_forever"]:
        target["playtime_forever"] = incoming["playtime_forever"]
    if incoming["last_played"] > target["last_played"]:
        target["last_played"] = incoming["last_played"]
    if incoming["name"] and (not target["name"] or target["name"] == "未知游戏"):
        target["name"] = incoming["name"]
    for key in ("icon", "capsule", "header"):
        if incoming.get(key):
            target[key] = incoming[key]
    return target


def _recent_games(by_id, now=None):
    cutoff = int(now if now is not None else time.time()) - TWO_WEEKS_SECONDS
    games = []
    for game in by_id.values():
        if game["playtime_2weeks"] > 0 or game["last_played"] >= cutoff:
            games.append(game)
    games.sort(key=lambda item: (-item["playtime_2weeks"], -item["last_played"], -item["playtime_forever"], item["name"]))
    return games


def fetch_snapshot(api_key, steamid, timeout=10):
    if not api_key:
        raise SteamAPIError("管理员尚未配置 Steam API Key")
    summary = steam_get("ISteamUser/GetPlayerSummaries/v2/", {
        "key": api_key,
        "steamids": steamid,
    }, timeout=timeout)
    players = ((summary.get("response") or {}).get("players") if isinstance(summary.get("response"), dict) else None)
    if not isinstance(players, list) or not players:
        raise SteamAPIError("找不到这个 Steam 用户")
    profile = _profile_from_player(players[0])

    recent = steam_get("IPlayerService/GetRecentlyPlayedGames/v1/", {
        "key": api_key,
        "steamid": steamid,
        "count": 0,
    }, timeout=timeout)
    recent_response = recent.get("response") if isinstance(recent.get("response"), dict) else {}
    owned = steam_get("IPlayerService/GetOwnedGames/v1/", {
        "key": api_key,
        "steamid": steamid,
        "include_appinfo": 1,
        "include_played_free_games": 1,
    }, timeout=timeout)
    owned_response = owned.get("response") if isinstance(owned.get("response"), dict) else {}

    by_id = {}
    for payload in (owned_response, recent_response):
        raw_games = payload.get("games") if isinstance(payload.get("games"), list) else []
        for item in raw_games:
            game = _normalize_game(item)
            if not game:
                continue
            existing = by_id.get(game["appid"])
            by_id[game["appid"]] = _merge_game(existing, game) if existing else game
    games = _recent_games(by_id)

    hidden_games = (not profile["public"]) or (
        "total_count" not in recent_response
        and "game_count" not in owned_response
        and not games
    )
    return {"profile": profile, "games": games, "private": hidden_games}
