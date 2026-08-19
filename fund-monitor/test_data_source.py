"""data_source 解析层测试：全部用固定响应，不依赖实时网络"""
import json
import unittest

import data_source as ds


def payload(rows):
    return json.dumps({"data": rows, "success": True, "errorCode": 0}).encode()


def sina_payload(networth, worth="1.0000", worth_date="20260818"):
    return json.dumps({"result": {"status": {"code": 0}, "data": {
        "worth": worth, "worth_date": worth_date, "networth": networth,
    }}}).encode()


OFFICIAL = {
    "FCODE": "000001", "SHORTNAME": "华夏成长混合", "PDATE": "2026-08-18",
    "NAV": "1.4090", "NAVCHGRT": "0.43",
    "GSZ": None, "GSZZL": None, "GZTIME": None,
}
ESTIMATE = {
    "FCODE": "110011", "SHORTNAME": "易方达优质精选混合(QDII)", "PDATE": "2026-08-18",
    "NAV": "4.2362", "NAVCHGRT": "1.78",
    "GSZ": "4.2500", "GSZZL": "0.33", "GZTIME": "2026-08-19 15:00",
}


class TestValidation(unittest.TestCase):
    def test_valid_code(self):
        self.assertTrue(ds.valid_code("000001"))
        for bad in ("00001", "0000012", "abcdef", "", None, "00 001", 123456):
            self.assertFalse(ds.valid_code(bad), bad)

    def test_to_float(self):
        self.assertEqual(ds.to_float("1.409"), 1.409)
        self.assertEqual(ds.to_float("-0.5"), -0.5)
        for bad in (None, "", "---", "--", "null", "abc"):
            self.assertIsNone(ds.to_float(bad), bad)


class TestParseRow(unittest.TestCase):
    def test_official_when_no_estimate(self):
        entry = ds.parse_row(OFFICIAL)
        self.assertEqual(entry["kind"], "official")
        self.assertEqual(entry["nav"], 1.4090)
        self.assertEqual(entry["change_pct"], 0.43)
        self.assertEqual(entry["nav_date"], "2026-08-18")
        self.assertEqual(entry["name"], "华夏成长混合")

    def test_estimate_when_newer(self):
        entry = ds.parse_row(ESTIMATE)
        self.assertEqual(entry["kind"], "estimate")
        self.assertEqual(entry["nav"], 4.2500)
        self.assertEqual(entry["change_pct"], 0.33)
        self.assertEqual(entry["nav_date"], "2026-08-19")
        # 正式净值仍然保留，方便前端对照
        self.assertEqual(entry["official_nav"], 4.2362)

    def test_official_wins_when_same_day(self):
        """正式净值发布后（PDATE 追平 GZTIME），不能再用估算"""
        row = dict(ESTIMATE, PDATE="2026-08-19", NAV="4.2600", NAVCHGRT="0.56")
        entry = ds.parse_row(row)
        self.assertEqual(entry["kind"], "official")
        self.assertEqual(entry["nav"], 4.2600)

    def test_stale_estimate_ignored(self):
        row = dict(ESTIMATE, GZTIME="2026-08-15 15:00")
        self.assertEqual(ds.parse_row(row)["kind"], "official")

    def test_reject_bad_fields(self):
        self.assertIsNone(ds.parse_row({"FCODE": "1", "SHORTNAME": "x", "NAV": "1"}))
        self.assertIsNone(ds.parse_row(dict(OFFICIAL, SHORTNAME="")))
        # 净值非数字 -> 不产出条目
        self.assertIsNone(ds.parse_row(dict(OFFICIAL, NAV="abc")))
        # 缺净值日期 -> 不产出条目
        self.assertIsNone(ds.parse_row(dict(OFFICIAL, PDATE=None)))

    def test_missing_change_pct_still_official(self):
        entry = ds.parse_row(dict(OFFICIAL, NAVCHGRT=None))
        self.assertEqual(entry["kind"], "official")
        self.assertIsNone(entry["change_pct"])


class TestParsePayload(unittest.TestCase):
    def test_parse_multiple(self):
        out = ds.parse_payload(payload([OFFICIAL, ESTIMATE]))
        self.assertEqual(set(out), {"000001", "110011"})

    def test_html_error_page_raises(self):
        """fundgz 那类 HTTP 200 + HTML body 必须当失败处理"""
        with self.assertRaises(ValueError):
            ds.parse_payload(b"<!doctype html><html>404</html>")

    def test_empty_datas_raises(self):
        with self.assertRaises(ValueError):
            ds.parse_payload(payload(None))
        with self.assertRaises(ValueError):
            ds.parse_payload(payload([]))

    def test_success_false_raises(self):
        raw = json.dumps({"data": [OFFICIAL], "success": False, "firstError": "boom"}).encode()
        with self.assertRaises(ValueError):
            ds.parse_payload(raw)

    def test_invalid_code_returns_null_data(self):
        """实测：无效代码时接口返回 data: null（不是空数组），必须单独覆盖这个形状"""
        raw = json.dumps({"data": None, "success": True, "errorCode": 0}).encode()
        with self.assertRaises(ValueError):
            ds.parse_payload(raw)

    def test_all_rows_invalid_raises(self):
        with self.assertRaises(ValueError):
            ds.parse_payload(payload([{"FCODE": "bad", "SHORTNAME": ""}]))


class TestFetchFunds(unittest.TestCase):
    def setUp(self):
        self._orig_fetch_raw = ds.fetch_raw
        self._orig_fetch_raw_sina = ds.fetch_raw_sina
        self.addCleanup(setattr, ds, "fetch_raw", self._orig_fetch_raw)
        self.addCleanup(setattr, ds, "fetch_raw_sina", self._orig_fetch_raw_sina)
        # 默认新浪也不该被调用，避免用例漏配 stub 时误发真实请求
        ds.fetch_raw_sina = lambda code, timeout=10: self.fail("不该调用新浪兜底：%s" % code)

    def test_network_error_becomes_valueerror(self):
        ds.fetch_raw = lambda codes, timeout=10: (_ for _ in ()).throw(OSError("timed out"))
        with self.assertRaises(ValueError):
            ds.fetch_funds(["000001"])

    def test_empty_codes_shortcircuits(self):
        ds.fetch_raw = lambda codes, timeout=10: self.fail("不该发起请求")
        self.assertEqual(ds.fetch_funds([]), {})
        self.assertEqual(ds.fetch_funds(["bad"]), {})

    def test_ok(self):
        ds.fetch_raw = lambda codes, timeout=10: payload([OFFICIAL])
        self.assertIn("000001", ds.fetch_funds(["000001"]))

    def test_estimate_from_primary_skips_sina_fallback(self):
        """主数据源已经有估算：不该再打新浪兜底"""
        ds.fetch_raw = lambda codes, timeout=10: payload([ESTIMATE])
        out = ds.fetch_funds(["110011"])
        self.assertEqual(out["110011"]["source"], ds.SOURCE_NAME)

    def test_sina_fallback_when_primary_has_no_estimate(self):
        """017811/012008 这类：主数据源只有正式净值，退回新浪拿到当天更新的估算"""
        ds.fetch_raw = lambda codes, timeout=10: payload([OFFICIAL])
        ds.fetch_raw_sina = lambda code, timeout=10: sina_payload(
            networth=[{"pre_nav": "1.5000", "growthrate": -0.021, "pre_date": "2026-08-19"}]
        )
        out = ds.fetch_funds(["000001"])
        entry = out["000001"]
        self.assertEqual(entry["kind"], "estimate")
        self.assertEqual(entry["nav"], 1.5000)
        self.assertAlmostEqual(entry["change_pct"], -2.1)
        self.assertEqual(entry["nav_date"], "2026-08-19")
        self.assertEqual(entry["source"], ds.SINA_SOURCE_NAME)
        # 正式净值仍然保留
        self.assertEqual(entry["official_nav"], 1.4090)

    def test_sina_fallback_ignored_when_not_newer_than_official(self):
        """新浪返回的估值日期没比正式净值新：不该覆盖正式净值（与 parse_row 规则一致）"""
        ds.fetch_raw = lambda codes, timeout=10: payload([OFFICIAL])
        ds.fetch_raw_sina = lambda code, timeout=10: sina_payload(
            networth=[{"pre_nav": "1.5000", "growthrate": -0.021, "pre_date": "2026-08-18"}]
        )
        out = ds.fetch_funds(["000001"])
        self.assertEqual(out["000001"]["kind"], "official")

    def test_sina_fallback_invalid_code_signature_ignored(self):
        """实测：新浪无效代码返回 worth 空字符串 + networth: null，要能吞掉不报错"""
        ds.fetch_raw = lambda codes, timeout=10: payload([OFFICIAL])
        ds.fetch_raw_sina = lambda code, timeout=10: sina_payload(networth=None, worth="")
        out = ds.fetch_funds(["000001"])
        self.assertEqual(out["000001"]["kind"], "official")

    def test_sina_fallback_network_error_ignored(self):
        """新浪兜底请求失败：不该影响主数据源已经拿到的结果"""
        ds.fetch_raw = lambda codes, timeout=10: payload([OFFICIAL])
        ds.fetch_raw_sina = lambda code, timeout=10: (_ for _ in ()).throw(OSError("timed out"))
        out = ds.fetch_funds(["000001"])
        self.assertEqual(out["000001"]["kind"], "official")


class TestParseSina(unittest.TestCase):
    def test_parse_last_point(self):
        raw = sina_payload(networth=[
            {"pre_nav": "1.0", "growthrate": 0.01, "pre_date": "2026-08-18"},
            {"pre_nav": "1.1", "growthrate": -0.02, "pre_date": "2026-08-19"},
        ])
        out = ds.parse_sina(raw, "000001")
        self.assertEqual(out["nav"], 1.1)
        self.assertAlmostEqual(out["change_pct"], -2.0)
        self.assertEqual(out["nav_date"], "2026-08-19")

    def test_invalid_code_raises(self):
        with self.assertRaises(ValueError):
            ds.parse_sina(sina_payload(networth=None, worth=""), "999999")

    def test_bad_json_raises(self):
        with self.assertRaises(ValueError):
            ds.parse_sina(b"not json", "000001")

    def test_missing_field_raises(self):
        raw = sina_payload(networth=[{"pre_nav": "1.0", "pre_date": "2026-08-19"}])
        with self.assertRaises(ValueError):
            ds.parse_sina(raw, "000001")


if __name__ == "__main__":
    unittest.main()
