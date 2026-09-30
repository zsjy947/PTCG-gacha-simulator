# -*- coding: utf-8 -*-
"""value 离线单元测试（注入内存索引，不碰磁盘）。

价格夹具模拟 sync 落盘的真实形态：listPrice=Kyo 展示币种、detailPrice=集换社
人民币价（未精修为 None），读取经 kyo.cny_price 统一折算（×5.249）。
"""
import unittest

from pricetool.value import parse_collection, valuate

PRICE_INDEX = {
    "CSV5C__001": {"listPrice": 0.1, "detailPrice": None},        # 未精修 → ¥0.52
    "CSV5C__128": {"listPrice": 0.48, "detailPrice": 2.5},        # 已精修 → ¥2.50
    "30thC__137": {"listPrice": 55.52, "detailPrice": 291.41},
    "CBB1C__010": {"listPrice": 0, "detailPrice": None},          # 0 价视为缺价
}
CARD_INDEX = {
    "CSV5C__001": {"cardName": "榛果球", "rarity": "C"},
    "CSV5C__128": {"cardName": "团珠蛛", "rarity": "AR"},
    "30thC__137": {"cardName": "喷火龙", "rarity": "无标记"},
    "CBB1C__010": {"cardName": "某卡", "rarity": "U"},
    "CSXC__001": {"cardName": "剑盾特典卡", "rarity": "PR"},
}


class TestParseCollection(unittest.TestCase):
    def test_plain_list(self):
        entries = parse_collection([{"setCode": "CSV5C", "cardIndex": "001", "count": 2}])
        self.assertEqual(len(entries), 1)
        self.assertEqual(entries[0]["count"], 2)

    def test_simulator_export_fields(self):
        entries = parse_collection(
            [{"name": "榛果球", "rarity": "C", "setCode": "CSV5C", "cardIndex": "1", "count": 3}])
        self.assertEqual(entries[0]["count"], 3)

    def test_cards_wrapper_and_garbage(self):
        entries = parse_collection({"cards": [
            {"setCode": "CSV5C", "cardIndex": "128"},
            {"no_code": True},
            {"setCode": "X", "cardIndex": "1", "count": "abc"},  # count 非法回退 1
            {"setCode": "X", "cardIndex": "2", "count": 0},      # 数量 0 丢弃
            "not-a-dict",
        ]})
        self.assertEqual([e["cardIndex"] for e in entries], ["128", "1"])

    def test_bad_shape_raises(self):
        with self.assertRaises(ValueError):
            parse_collection({"unexpected": 1})


class TestValuate(unittest.TestCase):
    def test_basic(self):
        r = valuate([
            {"setCode": "CSV5C", "cardIndex": "001", "count": 10},   # 10 × 0.52
            {"setCode": "30thC", "cardIndex": "137", "count": 1},
            {"setCode": "CSXC", "cardIndex": "001", "count": 2},     # 无价格
            {"setCode": "CBB1C", "cardIndex": "010", "count": 1},    # 0 价=缺价
        ], price_index=PRICE_INDEX, card_index=CARD_INDEX)
        self.assertAlmostEqual(r["total"], 291.41 + 5.2, places=2)
        self.assertEqual(r["total_count"], 14)
        self.assertEqual(r["priced_count"], 11)
        self.assertEqual(len(r["missing"]), 2)
        self.assertEqual(r["rows"][0]["name"], "喷火龙")

    def test_merge_duplicate_entries(self):
        r = valuate([
            {"setCode": "CSV5C", "cardIndex": "128", "count": 1},
            {"setCode": "CSV5C", "cardIndex": "128", "count": 2},
        ], price_index=PRICE_INDEX, card_index=CARD_INDEX)
        self.assertEqual(len(r["rows"]), 1)
        self.assertEqual(r["rows"][0]["count"], 3)
        self.assertAlmostEqual(r["total"], 7.5, places=2)

    def test_by_set_and_rarity(self):
        r = valuate([
            {"setCode": "CSV5C", "cardIndex": "001", "count": 1},
            {"setCode": "CSV5C", "cardIndex": "128", "count": 1},
        ], price_index=PRICE_INDEX, card_index=CARD_INDEX)
        self.assertAlmostEqual(r["by_set"]["CSV5C"], 3.02, places=2)
        self.assertAlmostEqual(r["by_rarity"]["C"], 0.52, places=2)
        self.assertAlmostEqual(r["by_rarity"]["AR"], 2.5, places=2)

    def test_card_index_fills_name(self):
        r = valuate([{"setCode": "30thC", "cardIndex": "137", "count": 1}],
                    price_index=PRICE_INDEX, card_index=CARD_INDEX)
        self.assertEqual(r["rows"][0]["name"], "喷火龙")


if __name__ == "__main__":
    unittest.main()
