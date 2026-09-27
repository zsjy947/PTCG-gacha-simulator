# -*- coding: utf-8 -*-
"""sync 过滤与快照构建的离线单元测试（临时目录，不碰网络与真实数据）。

价格夹具模拟 sync 落盘的真实形态：listPrice=Kyo 展示币种、detailPrice=集换社
人民币价（未精修为 None），人民币口径经 kyo.cny_price 统一折算（×5.249）。
"""
import json
import tempfile
import unittest
from pathlib import Path

from pricetool.sync import apply_min_cny, build_cny_index

CARDS = {
    "137": {"listPrice": 55.52, "detailPrice": 291.41},   # 精修 → ¥291.41，保留
    "048": {"listPrice": 2.0, "detailPrice": None},        # 未精修 → ¥10.50，保留
    "049": {"listPrice": 0.9, "detailPrice": None},        # 未精修 → ¥4.72，过滤
    "050": {"listPrice": None, "marketPrice": None, "detailPrice": None},  # 无价，过滤
}


class TestApplyMinCny(unittest.TestCase):
    def test_keeps_only_above_threshold(self):
        out = apply_min_cny(CARDS, 5.0)
        self.assertEqual(sorted(out), ["048", "137"])

    def test_none_keeps_everything(self):
        self.assertEqual(len(apply_min_cny(CARDS, None)), 4)

    def test_boundary_is_exclusive(self):
        # ¥5.00 整不算"超过 5 元"
        cards = {"001": {"listPrice": 5 / 5.249, "detailPrice": None}}
        self.assertEqual(apply_min_cny(cards, 5.0), {})


class TestBuildCnyIndex(unittest.TestCase):
    def _write(self, root: Path, name: str, obj):
        (root / name).write_text(json.dumps(obj, ensure_ascii=False), encoding="utf-8")

    def test_merge_filter_and_skip_meta(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            self._write(root, "CSV5C.json", {
                "setCode": "CSV5C",
                "cards": {n: dict(info) for n, info in CARDS.items()},
            })
            # 未过滤的旧文件（含低价卡）也不得污染快照
            self._write(root, "CSV1C.json", {
                "setCode": "CSV1C",
                "cards": {"001": {"listPrice": 0.1, "detailPrice": None}},
            })
            self._write(root, "manifest.json", {"sets": {}})
            self._write(root, "name_cache.json", {"Oddish": []})
            self._write(root, "index.json", {"prices": {}})

            idx = build_cny_index(5.0, prices_dir=root)
            self.assertEqual(idx, {"CSV5C__048": 10.5, "CSV5C__137": 291.41})
            all_idx = build_cny_index(None, prices_dir=root)
            self.assertIn("CSV1C__001", all_idx)


if __name__ == "__main__":
    unittest.main()
