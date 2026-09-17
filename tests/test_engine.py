# -*- coding: utf-8 -*-
"""引擎一致性测试。

1. golden：Python 与 shared/gacha.js 注入同种子 mulberry32，
   对同一卡池 + 同一规格逐包逐卡对拍，输出必须完全一致。
2. 统计：大数模拟校验划档概率落位（宽松界，防 flake）。
"""
import json
import random
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import config  # noqa: E402
import gacha  # noqa: E402
from tests.mulberry import Mulberry32  # noqa: E402


def fixture_cards() -> list:
    """确定性卡池：覆盖 C/U/R/RR/SR 与宝石包符号稀有度（●◆★ 走 RARITY_ALIAS）。"""
    cards = []
    plan = ([("C", 8), ("U", 6), ("R", 5), ("RR", 3), ("SR", 2)]
            + [("●", 4), ("◆", 3), ("★", 3)])
    n = 1
    for rarity, cnt in plan:
        for _ in range(cnt):
            cards.append({
                "setCode": "FIXSET",
                "cardIndex": f"{n:03d}",
                "cardName": f"测试卡{n:03d}",
                "rarity": rarity,
            })
            n += 1
    return cards


def project(pack: list) -> list:
    return [{"i": c["cardIndex"], "r": c["rarity"], "s": c["slotName"], "k": c["slotKind"]}
            for c in pack]


def js_packs(cards: list, spec: dict, seed: int, packs: int) -> list:
    tmp = Path(__file__).parent / "_tmp_parity"
    tmp.mkdir(exist_ok=True)
    f_cards = tmp / "fixture.json"
    f_spec = tmp / "spec.json"
    f_cards.write_text(json.dumps(cards, ensure_ascii=False), encoding="utf-8")
    f_spec.write_text(json.dumps(spec, ensure_ascii=False), encoding="utf-8")
    out = subprocess.run(
        ["node", str(Path(__file__).parent / "parity_node.js"),
         str(f_cards), str(f_spec), str(seed), str(packs)],
        capture_output=True, text=True, timeout=60,
    )
    if out.returncode != 0:
        raise RuntimeError(f"node 对拍脚本失败: {out.stderr}")
    return json.loads(out.stdout)


class TestGoldenParity(unittest.TestCase):
    """Python 与 JS 引擎同种子输出必须逐卡一致。"""

    def test_same_seed_same_packs(self):
        cards = fixture_cards()
        specs = {
            "sv5(平+闪)": config.set_specs("CSV1C")[0],
            "sm25(多平卡槽)": config.set_specs("CS1AC")[1],
            "gem4(符号稀有度)": config.set_specs("CBB1C")[0],
            "tera10(封入变体)": config.set_specs("CSV9.5C")[0],
        }
        for name, spec in specs.items():
            for seed in (42, 20260914):
                with self.subTest(spec=name, seed=seed):
                    # 两侧驱动方式完全同构：单个 rng 实例连续抽 25 包
                    rng = Mulberry32(seed)
                    py_packs = [project(gacha.draw_pack_from_cards(cards, spec, rng))
                                for _ in range(25)]
                    js = js_packs(cards, spec, seed, 25)
                    self.assertEqual(py_packs, js, f"{name} seed={seed} 对拍不一致")


class TestDistribution(unittest.TestCase):
    """统计落位：闪卡位 RR+ 占比应落在期望 ±6σ 内（宽松防 flake）。"""

    def test_holo_rrplus_ratio(self):
        cards = fixture_cards()
        spec = config.set_specs("CSV1C")[0]  # sv5: 4平 + 1闪
        rng = random.Random(7)
        n = 4000
        rr_plus = 0
        for _ in range(n):
            pack = gacha.draw_pack_from_cards(cards, spec, rng)
            holo = [c for c in pack if c["slotKind"] == "holo"]
            self.assertEqual(len(holo), 1, "sv5 必须恰好 1 个闪卡位")
            if holo[0]["rarity"] in ("RR", "AR", "SR", "SAR", "ACE", "UR"):
                rr_plus += 1
        # HOLO_WEIGHTS 在池 {R,RR,SR} 归一化后 RR+ ≈ (15+4.5)/89.5
        p = (15 + 4.5) / (70 + 15 + 4.5)
        import math
        sigma = math.sqrt(n * p * (1 - p))
        self.assertLess(abs(rr_plus - n * p), 6 * sigma,
                        f"RR+ 频率 {rr_plus / n:.4f} 偏离期望 {p:.4f} 超过 6σ")

    def test_pack_no_duplicates(self):
        cards = fixture_cards()
        spec = config.set_specs("CSV1C")[0]
        rng = random.Random(11)
        for _ in range(500):
            pack = gacha.draw_pack_from_cards(cards, spec, rng)
            keys = {f"{c['setCode']}__{c['cardIndex']}" for c in pack}
            self.assertEqual(len(keys), len(pack), "包内卡牌不应重复")


if __name__ == "__main__":
    unittest.main()
