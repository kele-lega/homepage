"""Store 测试：代码校验、去重、删除、重启恢复、缓存合并规则"""
import os
import tempfile
import unittest

# 导入 app 前把数据目录指到临时位置，避免碰到 /app/data
TMP_ROOT = tempfile.mkdtemp(prefix="fund-store-")
os.environ["FUND_DATA_DIR"] = TMP_ROOT

import app  # noqa: E402
import data_source as ds  # noqa: E402
from test_data_source import ESTIMATE, OFFICIAL, payload  # noqa: E402


class StoreCase(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="fund-case-")
        self.funds = os.path.join(self.dir, "funds.json")
        self.cache = os.path.join(self.dir, "cache.json")
        # 默认让抓取走固定响应，测试不碰网络
        self._orig = ds.fetch_raw
        self._orig_sina = ds.fetch_raw_sina
        self.addCleanup(setattr, ds, "fetch_raw", self._orig)
        self.addCleanup(setattr, ds, "fetch_raw_sina", self._orig_sina)
        ds.fetch_raw = lambda codes, timeout=10: payload(
            [r for r in (OFFICIAL, ESTIMATE) if r["FCODE"] in codes])
        # OFFICIAL 没有估算，固定响应里的新浪兜底也统一失败，保持测试不碰网络
        ds.fetch_raw_sina = lambda code, timeout=10: (_ for _ in ()).throw(OSError("stubbed: no sina in tests"))

    def store(self):
        return app.Store(funds_file=self.funds, cache_file=self.cache)


class TestAddRemove(StoreCase):
    def test_add_and_dedupe(self):
        st = self.store()
        created, entry = st.add("000001")
        self.assertTrue(created)
        self.assertEqual(entry["name"], "华夏成长混合")
        # 重复添加幂等
        created2, _ = st.add("000001")
        self.assertFalse(created2)
        self.assertEqual(st.list_codes(), ["000001"])

    def test_remove(self):
        st = self.store()
        st.add("000001")
        self.assertTrue(st.remove("000001"))
        self.assertFalse(st.remove("000001"))
        self.assertEqual(st.list_codes(), [])

    def test_persist_across_restart(self):
        st = self.store()
        st.add("000001")
        st.add("110011")
        # 重新构造 = 模拟容器重启
        again = self.store()
        self.assertEqual(again.list_codes(), ["000001", "110011"])
        self.assertEqual(again.entries["000001"]["name"], "华夏成长混合")

    def test_load_filters_invalid_codes(self):
        app.write_json(self.funds, {"funds": ["000001", "bad", 42, "12345"]})
        self.assertEqual(self.store().list_codes(), ["000001"])

    def test_load_tolerates_corrupt_files(self):
        with open(self.funds, "w", encoding="utf-8") as fh:
            fh.write("{not json")
        with open(self.cache, "w", encoding="utf-8") as fh:
            fh.write("garbage")
        st = self.store()
        self.assertEqual(st.list_codes(), [])
        self.assertEqual(st.entries, {})


class TestRefreshMerge(StoreCase):
    def test_failure_keeps_last_good(self):
        st = self.store()
        st.add("000001")
        good = dict(st.entries["000001"])
        ds.fetch_raw = lambda codes, timeout=10: b"<html>404</html>"
        err = st.refresh()
        self.assertIsNotNone(err)
        self.assertEqual(st.entries["000001"], good)  # 旧值不被覆盖
        self.assertIsNotNone(st.last_error)

    def test_official_not_overwritten_by_estimate(self):
        st = self.store()
        st.add("110011")
        # 先写入一条同日正式净值
        st.entries["110011"] = dict(st.entries["110011"],
                                    kind="official", nav=4.30, nav_date="2026-08-19")
        st.refresh()  # 固定响应里 110011 是 2026-08-19 的估算
        self.assertEqual(st.entries["110011"]["kind"], "official")
        self.assertEqual(st.entries["110011"]["nav"], 4.30)

    def test_newer_date_overwrites(self):
        st = self.store()
        st.add("000001")
        st.entries["000001"] = dict(st.entries["000001"], nav=1.0, nav_date="2026-08-01")
        st.refresh()
        self.assertEqual(st.entries["000001"]["nav_date"], "2026-08-18")
        self.assertEqual(st.entries["000001"]["nav"], 1.4090)

    def test_older_date_ignored(self):
        st = self.store()
        st.add("000001")
        st.entries["000001"] = dict(st.entries["000001"], nav=9.99, nav_date="2026-09-01")
        st.refresh()
        self.assertEqual(st.entries["000001"]["nav"], 9.99)

    def test_partial_response_records_missing(self):
        st = self.store()
        st.add("000001")
        st.codes.append("161725")  # 固定响应不包含它
        st.refresh()
        self.assertIn("161725", st.last_error)
        self.assertIn("000001", st.entries)  # 成功的那只照常更新

    def test_refresh_with_empty_list(self):
        st = self.store()
        self.assertIsNone(st.refresh())
        self.assertIsNotNone(st.last_refresh)

    def test_snapshot_pending_entry(self):
        st = self.store()
        st.codes.append("161725")
        snap = st.snapshot()
        self.assertEqual(snap["count"], 1)
        self.assertEqual(snap["funds"][0]["kind"], "pending")
        self.assertIsNone(snap["funds"][0]["nav"])

    def test_snapshot_keeps_add_order(self):
        st = self.store()
        st.add("110011")
        st.add("000001")
        self.assertEqual([f["code"] for f in st.snapshot()["funds"]], ["110011", "000001"])


class TestAtomicWrite(unittest.TestCase):
    def test_write_json_atomic(self):
        d = tempfile.mkdtemp(prefix="fund-atomic-")
        path = os.path.join(d, "nested", "out.json")
        app.write_json(path, {"a": 1})
        self.assertEqual(app.read_json(path, None), {"a": 1})
        self.assertFalse(os.path.exists(path + ".tmp"))

    def test_read_json_fallback(self):
        self.assertEqual(app.read_json("/nonexistent/x.json", {"d": 1}), {"d": 1})


if __name__ == "__main__":
    unittest.main()
