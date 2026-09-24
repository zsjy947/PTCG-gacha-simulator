# -*- coding: utf-8 -*-
"""matcher 离线单元测试。"""
import unittest

from pricetool.matcher import (
    SET_ALIASES,
    build_set_map,
    entry_price,
    match_cards,
    norm_kyo_number,
    normalize_code,
    pick_best_cards,
)


class TestNormKyoNumber(unittest.TestCase):
    def test_variants(self):
        self.assertEqual(norm_kyo_number({"collectorNo": "048/129"}), "048")   # 普通弹
        self.assertEqual(norm_kyo_number({"collectorNo": "CSV2C-002/128"}), "002")  # 带弹码前缀
        self.assertEqual(norm_kyo_number({"collectorNo": "20 03/07"}), "2003") # 宝石包卡组号
        self.assertEqual(norm_kyo_number({"collectorNo": "144/151", "number": "23 05"}), "144")
        self.assertEqual(norm_kyo_number({"collectorNo": "B/RGB"}), "B")       # RGB 特殊卡
        self.assertEqual(norm_kyo_number({"number": "2"}), "002")              # 回退 number
        self.assertEqual(norm_kyo_number({"number": "CSV2C-086"}), "086")      # number 也带前缀


def _kyo(code, name="x", sid=None):
    return {"code": code, "name": name, "id": sid or code, "size": "100",
            "productLineCode": "PKCN"}


LOCAL = [
    {"id": "CSV5C", "code": "CSV5C", "name": "暗黑水晶", "count": 164},
    {"id": "30thC", "code": "30thC", "name": "30周年庆典", "count": 176},
    {"id": "151C-LV", "code": "151C", "name": "收集啦151 旅", "count": 186},
    {"id": "CBB4C", "code": "CBB4C", "name": "宝石包 VOL.4", "count": 196},
    {"id": "CSV3C", "code": "CSV3C", "name": "无畏太晶", "count": 165},
    {"id": "CSV1C", "code": "CSV1C", "name": "永世诞生", "count": 127},
    {"id": "CSXC", "code": "CSXC", "name": "剑盾特典", "count": 50},
]
KYO = [
    _kyo("CSV5C"), _kyo("30TH A"), _kyo("151C"), _kyo("CBB4"),
    _kyo("CSV3C:"), _kyo("SV9.5C"), _kyo("OGV1"),
]


class TestNormalize(unittest.TestCase):
    def test_strip_and_upper(self):
        self.assertEqual(normalize_code("cbb3c:"), "CBB3C")
        self.assertEqual(normalize_code("30thC"), "30THC")
        self.assertEqual(normalize_code("SV9.5C"), "SV95C")


class TestBuildSetMap(unittest.TestCase):
    def setUp(self):
        self.mapping, self.report = build_set_map(LOCAL, KYO)

    def test_exact(self):
        self.assertEqual(self.mapping["CSV5C"]["code"], "CSV5C")

    def test_alias(self):
        self.assertEqual(self.mapping["30thC"]["code"], "30TH A")
        self.assertEqual(self.mapping["151C-LV"]["code"], "151C")
        self.assertEqual(self.mapping["CBB4C"]["code"], "CBB4")

    def test_normalized_matches_code_with_punctuation(self):
        self.assertEqual(self.mapping["CSV3C"]["code"], "CSV3C:")

    def test_missed(self):
        self.assertNotIn("CSXC", self.mapping)
        self.assertIn("CSXC", self.report["missed"])

    def test_kyo_unused(self):
        self.assertIn("SV9.5C", self.report["kyo_unused"])  # 本地叫 CSV9.5C，归一化后差一个 C
        self.assertIn("OGV1", self.report["kyo_unused"])

    def test_alias_table_entries_all_valid(self):
        # 别名表里的本地 id 必须真实存在于仓库的弹索引
        from pricetool import store
        local_ids = {e["id"] for e in store.load_sets_index()}
        for lid in SET_ALIASES:
            self.assertIn(lid, local_ids)


class TestPickBest(unittest.TestCase):
    def test_dedupe_prefers_jihuanshe_price(self):
        entries = [
            {"number": "001", "grade": 0, "type": "SING", "jihuansheMarketPrice": None,
             "marketPrice": 5, "updatedAt": "2026-09-20T10:00:00Z"},
            {"number": "1", "grade": 0, "type": "SING", "jihuansheMarketPrice": 0.5,
             "marketPrice": 0.5, "updatedAt": "2026-09-19T10:00:00Z"},
        ]
        best = pick_best_cards(entries)
        self.assertEqual(set(best), {"001"})
        self.assertEqual(best["001"]["jihuansheMarketPrice"], 0.5)

    def test_filter_by_set_id(self):
        entries = [
            {"number": "001", "set": {"id": "A"}, "jihuansheMarketPrice": 1.0},
            {"number": "002", "set": {"id": "B"}, "jihuansheMarketPrice": 99.0},
        ]
        best = pick_best_cards(entries, kyo_set_id="A")
        self.assertEqual(set(best), {"001"})

    def test_entry_price_zero_is_none(self):
        self.assertIsNone(entry_price({"jihuansheMarketPrice": 0, "marketPrice": 0}))
        self.assertEqual(entry_price({"jihuansheMarketPrice": "3.5"}), 3.5)


class TestMatchCards(unittest.TestCase):
    def test_match_and_missing(self):
        local = [
            {"cardIndex": "1", "nameEn": "Pineco"},
            {"cardIndex": "128", "nameEn": "Tarountula"},
            {"cardIndex": "FIR", "nameEn": "Fire Energy"},
        ]
        entries = [
            {"number": "001", "name": "Pineco", "set": {"id": "A"}, "jihuansheMarketPrice": 0.1},
            {"number": "128", "name": "Totally Different Name", "set": {"id": "A"},
             "jihuansheMarketPrice": 2.0},
        ]
        priced, missing, mismatch = match_cards(local, entries, kyo_set_id="A")
        self.assertEqual(set(priced), {"001", "128"})
        self.assertEqual(missing, ["FIR"])
        self.assertEqual(len(mismatch), 1)  # 128 名称对不上仅告警

    def test_extra_remote_numbers_dropped(self):
        local = [{"cardIndex": "001", "nameEn": "Pineco"}]
        entries = [{"number": "999", "name": "Other Set Card", "set": {"id": "A"},
                    "jihuansheMarketPrice": 9.0},
                   {"number": "001", "name": "Pineco", "set": {"id": "A"},
                    "jihuansheMarketPrice": 0.1}]
        priced, missing, _ = match_cards(local, entries, kyo_set_id="A")
        self.assertEqual(set(priced), {"001"})
        self.assertEqual(missing, [])


if __name__ == "__main__":
    unittest.main()
