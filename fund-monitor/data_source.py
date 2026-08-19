"""
基金行情数据源

- 主数据源：天天基金 FundValuationLast，一次请求批量拿多只基金的名称、
  正式净值、涨跌幅、盘中估算净值/估算涨幅，与 real-time-fund 项目使用的上游一致
- 备用数据源：主数据源没有估算净值（GSZ 为空）时，逐只基金退回新浪
  getEstimateNetworthPic 接口再取一次估算——real-time-fund 里同一只基金
  遇不到天天基金估值时也是退回这个接口（dataSource 2/3），效果与官网一致
- 与 real-time-fund（同项目下的独立基金详情站）对齐到同一上游，而不是抓它的页面
- 注意几个已失效/不用的旧接口，不要换回去：
  1. fundgz.1234567.com.cn/js/{code}.js —— 返回 HTTP 200 但 body 是 HTML 404 页
  2. fundmobapi.eastmoney.com/FundMNewApi/FundMNFInfo —— real-time-fund 未使用此接口获取估值
  判断成功必须校验响应内容（success/data 字段），不能只看状态码
- 无效基金代码时：
  - 天天基金接口返回 `{"data": null, "success": true}`——是 null 不是空数组
  - 新浪接口返回 `{"worth": "", "networth": null}`——同样不是空数组
  两处解析都要单独处理，不能只判断"空列表"
- 新浪接口不支持批量（多个代码逗号拼接会返回空结果），只能逐只请求，
  且只在主数据源缺估算时才触发，避免每轮刷新都打一遍新浪
- 本模块只做「取数 + 解析」，不碰缓存与持久化，方便用固定响应做单元测试
"""
import json
import re
from datetime import datetime, timezone, timedelta
from urllib.request import urlopen, Request

CST = timezone(timedelta(hours=8))
CODE_RE = re.compile(r"^\d{6}$")

API = "https://fundcomapi.tiantianfunds.com/mm/newCore/FundValuationLast"
QUERY = "?FCODES={codes}&FIELDS=FCODE,SHORTNAME,GSZZL,GZTIME,GSZ,NAV,PDATE,NAVCHGRT"
UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)
SOURCE_NAME = "tiantianfunds-fundvaluationlast"

SINA_API = "https://stock.finance.sina.com.cn/fundInfo/api/openapi.php/FdFundService.getEstimateNetworthPic"
SINA_SOURCE_NAME = "sina-getestimatenetworthpic"
TIMEOUT = 10


def valid_code(code) -> bool:
    """基金代码必须是 6 位数字"""
    return isinstance(code, str) and bool(CODE_RE.match(code))


def to_float(value):
    """把接口里的字符串数字转 float；None/空/占位符/非数字一律返回 None"""
    if value is None:
        return None
    text = str(value).strip()
    if text in ("", "---", "--", "-", "null", "None"):
        return None
    try:
        return float(text)
    except ValueError:
        return None


def fetch_raw(codes, timeout: int = TIMEOUT) -> bytes:
    """网络层：批量拉原始响应。单独拆出来，测试时用固定响应替换本函数"""
    url = API + QUERY.format(codes=",".join(codes))
    req = Request(url, headers={
        "User-Agent": UA,
        "Accept": "application/json, text/plain, */*",
    })
    return urlopen(req, timeout=timeout).read()


def parse_payload(raw: bytes) -> dict:
    """
    解析层：raw -> {code: entry}

    只返回字段校验通过的条目。响应不是 JSON、success 为假、data 为 null/空
    （无效代码就是这种情况——实测该接口返回 data: null，不是空数组）都抛
    ValueError，由调用方保留旧缓存。
    """
    try:
        data = json.loads(raw.decode("utf-8", "replace"))
    except (json.JSONDecodeError, AttributeError) as exc:
        raise ValueError("响应不是合法 JSON（数据源可能返回了 HTML 错误页）") from exc

    if not isinstance(data, dict) or not data.get("success"):
        raise ValueError("数据源返回 success=false：%s" % (
            data.get("firstError") if isinstance(data, dict) else "结构异常"))

    rows = data.get("data")
    if not rows:
        raise ValueError("数据源没有返回任何基金数据（代码可能不存在）")

    out = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        entry = parse_row(row)
        if entry:
            out[entry["code"]] = entry
    if not out:
        raise ValueError("所有返回条目都未通过字段校验")
    return out


def _date_part(value):
    """GZTIME 可能是 '2026-08-19 15:00' 或 '2026-08-19'，只取日期部分"""
    if not value:
        return None
    text = str(value).strip()
    return text.split(" ")[0] if text else None


def parse_row(row: dict):
    """
    单只基金：正式净值 vs 盘中估算的取舍。

    规则：估算净值只有在「估值日期比正式净值日期新」时才用；否则用正式净值。
    这样正式净值发布后（PDATE 追上 GZTIME），不会被当天的旧估算覆盖。
    """
    code = str(row.get("FCODE") or "").strip()
    name = str(row.get("SHORTNAME") or "").strip()
    if not valid_code(code) or not name:
        return None

    official_nav = to_float(row.get("NAV"))
    official_chg = to_float(row.get("NAVCHGRT"))
    official_date = _date_part(row.get("PDATE"))

    est_nav = to_float(row.get("GSZ"))
    est_chg = to_float(row.get("GSZZL"))
    est_date = _date_part(row.get("GZTIME"))

    use_estimate = (
        est_nav is not None
        and est_chg is not None
        and est_date is not None
        and (official_date is None or est_date > official_date)
    )

    if use_estimate:
        nav, change, nav_date, kind = est_nav, est_chg, est_date, "estimate"
    elif official_nav is not None and official_date:
        nav, change, nav_date, kind = official_nav, official_chg, official_date, "official"
    else:
        return None  # 净值缺失或非数字：不产出条目，保留旧缓存

    return {
        "code": code,
        "name": name,
        "nav": nav,
        "change_pct": change,
        "nav_date": nav_date,
        "kind": kind,
        "official_nav": official_nav,
        "official_date": official_date,
        "source": SOURCE_NAME,
        "fetched_at": datetime.now(CST).isoformat(timespec="seconds"),
    }


def fetch_raw_sina(code: str, timeout: int = TIMEOUT) -> bytes:
    """网络层：新浪估算接口，单独拆出来，测试时用固定响应替换本函数。不支持批量，只能逐只请求"""
    req = Request(SINA_API + "?symbol=" + code, headers={
        "User-Agent": UA,
        "Accept": "application/json, text/plain, */*",
    })
    return urlopen(req, timeout=timeout).read()


def parse_sina(raw: bytes, code: str):
    """
    解析新浪估算接口的响应 -> {"nav": 估算净值, "change_pct": 估算涨幅(%), "nav_date": 估值日期}

    只解析盘中估算，不含正式净值——正式净值仍以天天基金为准。响应结构异常、
    JSON 非法、或 networth 为空/null（无效代码时就是这种情况：worth 为空字符串、
    networth 为 null）都抛 ValueError，由调用方吞掉并保留主数据源的结果。
    """
    try:
        data = json.loads(raw.decode("utf-8", "replace"))
    except (json.JSONDecodeError, AttributeError) as exc:
        raise ValueError("新浪估算接口响应不是合法 JSON") from exc

    try:
        payload = data["result"]["data"]
    except (KeyError, TypeError) as exc:
        raise ValueError("新浪估算接口响应结构异常") from exc

    networth = payload.get("networth") if isinstance(payload, dict) else None
    if not isinstance(networth, list) or not networth:
        raise ValueError("新浪估算接口没有该基金的估算数据（代码可能不存在或未覆盖）")

    last = networth[-1]
    if not isinstance(last, dict):
        raise ValueError("新浪估算接口数据点结构异常")

    # dataSource 2 口径：pre_nav / growthrate（与 real-time-fund 默认的新浪口径一致）
    est_nav = to_float(last.get("pre_nav"))
    growthrate = to_float(last.get("growthrate"))
    est_date = str(last.get("pre_date") or "").strip() or None
    if est_nav is None or growthrate is None or est_date is None:
        raise ValueError("新浪估算接口数据点字段不全")

    return {"nav": est_nav, "change_pct": growthrate * 100, "nav_date": est_date}


def _sina_fallback_entry(code: str, entry: dict, timeout: int = TIMEOUT):
    """
    主数据源没有可用估算时，退回新浪单只基金估算接口再试一次。

    只在新浪给出的估值日期比正式净值日期更新时才采用（与 parse_row 的取舍规则
    一致），且失败（网络异常/未覆盖/字段不全）一律吞掉，返回 None 保留主数据源
    已解析出的条目，不影响 fetch_funds 的整体结果。
    """
    try:
        sina = parse_sina(fetch_raw_sina(code, timeout=timeout), code)
    except Exception:
        return None

    official_date = entry.get("official_date")
    if official_date and sina["nav_date"] <= official_date:
        return None

    merged = dict(entry)
    merged.update({
        "nav": sina["nav"],
        "change_pct": sina["change_pct"],
        "nav_date": sina["nav_date"],
        "kind": "estimate",
        "source": SINA_SOURCE_NAME,
        "fetched_at": datetime.now(CST).isoformat(timespec="seconds"),
    })
    return merged


def fetch_funds(codes, timeout: int = TIMEOUT) -> dict:
    """
    业务入口：批量抓取并解析。网络或解析异常都以 ValueError 形式抛出。

    主数据源（天天基金）批量成功后，对其中没有拿到估算（kind 仍是 official）的
    代码，逐只退回新浪估算接口再试一次——对齐 real-time-fund 遇到天天基金缺估值
    时的行为，避免出现"官网有估算、这边没有"的差异。
    """
    codes = [c for c in codes if valid_code(c)]
    if not codes:
        return {}
    try:
        raw = fetch_raw(codes, timeout=timeout)
    except ValueError:
        raise
    except Exception as exc:  # 超时 / DNS / 连接重置 / HTTP 错误
        raise ValueError("请求数据源失败：%s" % exc) from exc
    out = parse_payload(raw)

    for code, entry in list(out.items()):
        if entry.get("kind") == "estimate":
            continue
        fallback = _sina_fallback_entry(code, entry, timeout=timeout)
        if fallback:
            out[code] = fallback
    return out
