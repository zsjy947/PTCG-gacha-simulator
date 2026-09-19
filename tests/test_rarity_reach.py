# -*- coding: utf-8 -*-
"""稀有度可达性守卫：可拆弹卡表中出现的每个稀有度，必须在该弹规格的
归一化概率表（含全部封入变体）中可达——否则收藏完成度永远到不了 100%。

背景：权重表缺某稀有度键时，_normalize 会把它整体剔除，该稀有度的卡
永远抽不到；此类问题数据驱动地在这里拦截，而非靠人肉发现。
"""
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

import config  # noqa: E402
import gacha  # noqa: E402


class TestRarityReach(unittest.TestCase):
    def test_all_present_rarities_reachable(self):
        idx = json.loads((ROOT / "data" / "sets_index.json").read_text(encoding="utf-8"))
        checked = 0
        problems = []
        for e in idx:
            sid = e["id"]
            specs = config.set_specs(sid)
            if not specs:
                continue
            try:
                cards = gacha.load_cards(sid)
            except gacha.SetDataError:
                continue
            if not cards:
                continue
            pools = gacha.build_pools(cards)
            present = set(pools.keys())
            reachable = set()
            set_code = sid.split("__")[0]
            for spec in specs:
                variants = spec.get("variants") or [{"slots": spec["slots"]}]
                for v in variants:
                    for slot in v["slots"]:
                        probs = gacha._slot_probs(slot, set_code, spec["id"], pools)
                        if probs:
                            reachable.update(probs.keys())
                        else:
                            reachable.update(present)  # 兜底槽：整弹均匀抽，全可达
            checked += 1
            missing = present - reachable
            if missing:
                problems.append(f"{sid}: 不可达稀有度 {sorted(missing)}")
        self.assertGreater(checked, 40, f"可拆弹数量异常（仅 {checked} 个），检查数据/规格映射")
        self.assertEqual(problems, [], "存在不可达稀有度：\n" + "\n".join(problems))


if __name__ == "__main__":
    unittest.main()
