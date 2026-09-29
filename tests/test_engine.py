# -*- coding: utf-8 -*-
"""引擎一致性测试。

1. golden：Python 与 shared/gacha.js 注入同种子 mulberry32，
   对同一卡池 + 同一规格逐包逐卡对拍，输出必须完全一致。
2. 统计：大数模拟校验划档概率落位（宽松界，防 flake）。
"""
import json
import math
import random
import subprocess
import sys
import tempfile
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


def js_packs(cards: list, spec: dict, seeds, packs: int) -> list:
    """多种子批量对拍：返回 [[seed1 的包序列], [seed2 的包序列], ...]（与 seeds 同序）。"""
    if isinstance(seeds, int):
        seeds = [seeds]
    with tempfile.TemporaryDirectory() as tmp:
        f_cards = Path(tmp) / "fixture.json"
        f_spec = Path(tmp) / "spec.json"
        f_cards.write_text(json.dumps(cards, ensure_ascii=False), encoding="utf-8")
        f_spec.write_text(json.dumps(spec, ensure_ascii=False), encoding="utf-8")
        out = subprocess.run(
            ["node", str(Path(__file__).parent / "parity_node.js"),
             str(f_cards), str(f_spec), ",".join(str(s) for s in seeds), str(packs)],
            capture_output=True, text=True, timeout=120,
        )
    if out.returncode != 0:
        raise RuntimeError(f"node 对拍脚本失败: {out.stderr}")
    return json.loads(out.stdout)


# 对拍种子矩阵（≥20 种子 × 多规格，计划阶段 0 要求）：覆盖边界与常规值
PARITY_SEEDS = [1, 2, 3, 7, 13, 42, 99, 777, 4096, 5150,
                2024, 20260914, 31337, 65535, 42424242, 123456789,
                987654321, 8675309, 2147483646, 2147483647]


class TestGoldenParity(unittest.TestCase):
    """Python 与 JS 引擎同种子输出必须逐卡一致。"""

    def test_same_seed_same_packs(self):
        cards = fixture_cards()
        specs = {
            "sv5(平+闪)": config.set_specs("CSV1C")[0],
            "sm25(多平卡槽)": config.set_specs("CS1AC")[1],
            "gem4(符号稀有度)": config.set_specs("CBB1C")[0],
            "tera10(封入变体)": config.set_specs("CSV9.5C")[0],
            "fest6(30周年特款)": config.set_specs("30thC")[0],
        }
        for name, spec in specs.items():
            with self.subTest(spec=name):
                # 两侧驱动方式完全同构：每个种子一个独立 rng 实例连抽 25 包
                py_all = []
                for seed in PARITY_SEEDS:
                    rng = Mulberry32(seed)
                    py_all.append([project(gacha.draw_pack_from_cards(cards, spec, rng))
                                   for _ in range(25)])
                js = js_packs(cards, spec, PARITY_SEEDS, 25)
                self.assertEqual(py_all, js, f"{name} {len(PARITY_SEEDS)} 种子对拍不一致")


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


class TestBoxProfile(unittest.TestCase):
    """整盒理论画像（T1）：期望张数守恒、出现率值域、变体逐一返回、无盒规返回空。"""

    def test_rarity_profile_conserves_pack_size(self):
        for sid, key in (("CSV1C", "sv5"), ("CS1AC", "sm25"), ("CSV9.5C", "tera10")):
            spec = next(s for s in config.set_specs(sid) if s["key"] == key)
            pack_size = len((spec.get("variants") or [{"slots": spec["slots"]}])[0]["slots"])
            for v in gacha.rarity_profile(sid, spec):
                # Σ_r E[张数_r] = 包内张数（归一化概率守恒；浮点和留 1e-9 容差）
                self.assertAlmostEqual(sum(v["expectedCount"].values()), pack_size,
                                       delta=1e-9, msg=sid)

    def test_box_profile_sums_to_box(self):
        spec = config.set_specs("CSV1C")[0]  # sv5: 5张/包 × 30包/盒
        profiles = gacha.box_profile("CSV1C", spec)
        self.assertEqual(len(profiles), 1)
        p = profiles[0]
        self.assertEqual(p["boxPacks"], spec["boxPacks"])
        self.assertAlmostEqual(sum(p["expectedCount"].values()),
                               spec["boxPacks"] * 5, delta=1e-9)
        for q in p["pAtLeastOne"].values():
            self.assertGreater(q, 0.0)
            self.assertLessEqual(q, 1.0)

    def test_box_profile_variants_and_empty(self):
        # 变体规格：返回元素数 == variants 数（太晶盛聚 7+3/6+4）
        tera = config.set_specs("CSV9.5C")[0]
        self.assertEqual(len(gacha.box_profile("CSV9.5C", tera)), len(tera["variants"]))
        self.assertEqual({p["note"] for p in gacha.box_profile("CSV9.5C", tera)},
                         {v["note"] for v in tera["variants"]})
        # 无 boxPacks 的规格（奖赏包）→ 无整盒 → 返回 []
        reward = config.set_specs("CSVE1PC")[0]
        self.assertIsNone(reward.get("boxPacks"))
        self.assertEqual(gacha.box_profile("CSVE1PC", reward), [])
        # rarityProfile 不受盒规影响：奖赏包仍返回单变体画像
        self.assertEqual(len(gacha.rarity_profile("CSVE1PC", reward)), 1)


class TestRarityProfileStatistics(unittest.TestCase):
    """统计性断言（T2 依赖）：固定种子模拟的实测占比应接近 rarityProfile 期望占比。

    种子写死保证可复现（统计性断言不再有随机 flake 空间）。容差取
    max(15% 相对误差, 4σ 泊松噪声下限)——5000 张样本下 UR 等稀有档期望仅约 5 张，
    纯相对误差在统计上必然超界，稀有档按噪声下限放宽；高占比档位仍由 15% 相对界约束。
    """

    SEEDS = [11, 23, 37, 51, 73]
    PACKS = 1000
    REL_TOL = 0.15

    def test_empirical_share_matches_profile(self):
        cards = gacha.load_cards("CSV1C")
        spec = config.set_specs("CSV1C")[0]  # sv5: 4平 + 1闪
        profile = gacha.rarity_profile("CSV1C", spec)[0]
        expect_total = sum(profile["expectedCount"].values())
        expect_share = {r: e / expect_total for r, e in profile["expectedCount"].items()}
        counts = {}
        total_cards = 0
        for seed in self.SEEDS:
            rng = Mulberry32(seed)
            for _ in range(self.PACKS):
                pack = gacha.draw_pack_from_cards(cards, spec, rng)
                total_cards += len(pack)
                for c in pack:
                    r = c["rarity"] or "N"
                    counts[r] = counts.get(r, 0) + 1
        self.assertEqual(total_cards, self.PACKS * len(self.SEEDS) * 5)
        for r, expect in expect_share.items():
            actual = counts.get(r, 0) / total_cards
            sigma = math.sqrt(expect * (1 - expect) / total_cards)
            tol = max(self.REL_TOL * expect, 4 * sigma)
            self.assertLess(abs(actual - expect), tol,
                            f"稀有度 {r} 实测占比 {actual:.4f} 偏离期望 {expect:.4f} "
                            f"超容差 {tol:.4f}（15% 相对或 4σ 取大）")


if __name__ == "__main__":
    unittest.main()
