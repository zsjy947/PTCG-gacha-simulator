# -*- coding: utf-8 -*-
"""kyo.cny_price 人民币口径单元测试。"""
import unittest

from pricetool import kyo


class TestCnyPrice(unittest.TestCase):
    def test_detail_preferred(self):
        self.assertEqual(kyo.cny_price({"listPrice": 77.98, "detailPrice": 409.3}), 409.3)

    def test_list_converted_when_unrefined(self):
        self.assertEqual(kyo.cny_price({"listPrice": 1.0, "detailPrice": None}), 5.25)
        self.assertEqual(kyo.cny_price({"listPrice": 0.1}), 0.52)

    def test_market_price_fallback(self):
        # 集换社字段为空、仅 Kyo marketPrice 的弹（如 CSV3C/CBB）
        self.assertEqual(kyo.cny_price({"marketPrice": 2.0}), 10.5)
        self.assertIsNone(kyo.cny_price({"marketPrice": 0}))

    def test_zero_and_none(self):
        self.assertIsNone(kyo.cny_price(None))
        self.assertIsNone(kyo.cny_price({}))
        self.assertIsNone(kyo.cny_price({"listPrice": 0, "detailPrice": 0}))
        self.assertIsNone(kyo.cny_price({"listPrice": "abc"}))

    def test_string_fields(self):
        self.assertEqual(kyo.cny_price({"detailPrice": "409.3"}), 409.3)

    def test_list_is_cny_mode(self):
        old = kyo.LIST_IS_CNY
        try:
            kyo.LIST_IS_CNY = True
            self.assertEqual(kyo.cny_price({"listPrice": 77.98, "detailPrice": 409.3}), 77.98)
        finally:
            kyo.LIST_IS_CNY = old


if __name__ == "__main__":
    unittest.main()
