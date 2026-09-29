# -*- coding: utf-8 -*-
"""抽卡引擎：按弹（扩展系列）构建稀有度卡池，按各弹发售规格的划档概率抽包。"""
import json
import random
from pathlib import Path

import config

ROOT = Path(__file__).parent
CARDS_DIR = ROOT / "data" / "cards"


class SetDataError(RuntimeError):
    pass


def load_cards(set_id: str) -> list:
    path = CARDS_DIR / f"{set_id}.json"
    if not path.exists():
        raise SetDataError(f"弹 {set_id} 的卡牌数据不存在，请先运行 python fetch_data.py")
    return json.loads(path.read_text(encoding="utf-8"))


def build_pools(cards: list) -> dict:
    """按稀有度分池；符号稀有度（宝石包 ●◆★ 等）先映射为标准稀有度。

    卡面展示仍保留原始记号，映射仅用于概率归类。
    """
    pools = {}
    for c in cards:
        r = c.get("rarity") or "N"
        pools.setdefault(config.RARITY_ALIAS.get(r, r), []).append(c)
    return pools


def _normalize(weights: dict, available: set) -> dict:
    """仅保留池中存在的稀有度并归一化；若全部缺失则返回空表。"""
    w = {r: v for r, v in weights.items() if r in available and v > 0}
    if not w:
        return {}
    total = sum(w.values())
    return {r: v / total for r, v in w.items()}


def _pick_rarity(probs: dict, rng) -> str:
    roll = rng.random()
    acc = 0.0
    for r, p in probs.items():
        acc += p
        if roll <= acc:
            return r
    return next(reversed(probs))


def _card_key(card: dict) -> str:
    return f"{card.get('setCode')}__{card.get('cardIndex')}"


def _pick_card(pools: dict, rarity: str | None, cards: list, used: set | None, rng) -> dict:
    """按稀有度池均匀抽卡；包内已出现的卡不再出现（同稀有度池去重，池耗尽退回整弹去重）。"""
    if rarity is None:
        # 兜底：整弹均匀抽（特典/礼盒类弹的权重稀有度全部缺失时）
        src = cards
    else:
        src = pools.get(rarity) or cards
    if used:
        fresh = [c for c in src if _card_key(c) not in used]
        if not fresh:
            fresh = [c for c in cards if _card_key(c) not in used]
        if fresh:
            src = fresh
    return dict(src[int(rng.random() * len(src))])


def resolve_spec(set_id: str, spec_id: str | None) -> dict:
    """按 key 或 id 解析某弹的包规格。"""
    specs = config.set_specs(set_id)
    if spec_id:
        for s in specs:
            if s["key"] == spec_id or s["id"] == spec_id:
                return s
        raise SetDataError(f"弹 {set_id} 不存在规格 {spec_id}")
    return specs[0]


def _slot_probs(slot: dict, set_code: str, spec_id: str, pools: dict):
    """计算某槽位的实际概率表（已按本弹稀有度归一化）。

    权重稀有度在本弹全部缺失时返回 None，表示该槽位退化为整弹均匀抽。
    """
    overrides = config.SET_SPEC_OVERRIDES.get(set_code, {})
    weights = overrides.get((spec_id, slot["name"])) or slot["weights"]
    return _normalize(weights, set(pools)) or None


def _draw_by_slots(slots: list, set_code: str, spec_id: str, pools: dict, cards: list, rng) -> list:
    pack: list = []
    used: set = set()  # 本包已出现的卡（setCode__cardIndex），包内不重复
    for slot in slots:
        probs = _slot_probs(slot, set_code, spec_id, pools)
        if probs:
            card = _pick_card(pools, _pick_rarity(probs, rng), cards, used, rng)
        else:
            card = _pick_card(pools, None, cards, used, rng)
        used.add(_card_key(card))
        card["slotName"] = slot["name"]
        card["slotKind"] = slot["kind"]
        pack.append(card)
    return pack


def draw_pack_from_cards(cards: list, spec: dict, rng=None) -> list:
    """直接基于给定卡列表开一包（tests 与跨引擎对拍用；rng 缺省为全局 random 模块）。"""
    rng = rng if rng is not None else random
    pools = build_pools(cards)
    set_code = "FIXTURE"
    variants = spec.get("variants") or [{"note": spec.get("note", ""), "slots": spec["slots"]}]
    v = variants[int(rng.random() * len(variants))]
    return _draw_by_slots(v["slots"], set_code, spec["id"], pools, cards, rng)


def draw_pack(set_id: str, spec_id: str | None = None, packs: int = 1, rng=None) -> list:
    """开包：按弹的发售规格抽 packs 包。

    返回 [pack, ...]，pack 为 [{card, slotName, slotKind}, ...]。
    规格含多个封入变体时（如太晶盛聚 7+3/6+4），每包随机落位。
    """
    cards = load_cards(set_id)
    if not cards:
        raise SetDataError(f"弹 {set_id} 暂无卡牌数据")
    pools = build_pools(cards)
    spec = resolve_spec(set_id, spec_id)
    set_code = set_id.split("__")[0]
    rng = rng if rng is not None else random

    variants = spec.get("variants") or [{"note": spec.get("note", ""), "slots": spec["slots"]}]
    result = []
    for _ in range(packs):
        v = variants[int(rng.random() * len(variants))]
        pack = _draw_by_slots(v["slots"], set_code, spec["id"], pools, cards, rng)
        result.append(pack)
    return result


def rarity_profile(set_id: str, spec: dict) -> list:
    """每包稀有度画像（确定性，无随机数）——shared/gacha.js rarityProfile 的镜像。

    变体规格逐变体返回。p(slot=r) 经 _slot_probs（含 SET_SPEC_OVERRIDES 按弹覆盖，
    目前为空）计算；兜底槽位退化为整弹均匀抽。浮点累加顺序与 JS 逐行一致（对拍逐位断言）。
    """
    cards = load_cards(set_id)
    pools = build_pools(cards)
    set_code = set_id.split("__")[0]
    spec_id = spec["id"]
    available = list(pools)
    total = sum(len(v) for v in pools.values())
    variants = spec.get("variants") or [{"note": spec.get("note", ""), "slots": spec["slots"]}]
    out = []
    for v in variants:
        expected = {r: 0.0 for r in available}
        appear = {r: 0.0 for r in available}
        for slot in v["slots"]:
            probs = _slot_probs(slot, set_code, spec_id, pools)
            for r in available:
                if probs:
                    p = probs.get(r, 0.0)
                else:
                    p = len(pools[r]) / total if total else 0.0
                expected[r] = expected[r] + p
                appear[r] = 1.0 - (1.0 - appear[r]) * (1.0 - p)
        out.append({"note": v.get("note", ""), "expectedCount": expected, "pAppear": appear})
    return out


def box_profile(set_id: str, spec: dict) -> list:
    """整盒理论画像——shared/gacha.js boxProfile 的镜像。

    boxPacks 缺省视为无整盒商品，返回 []。pAtLeastOne 用连乘而非 pow，保证逐位一致。
    """
    n = spec.get("boxPacks")
    if not n:
        return []
    out = []
    for v in rarity_profile(set_id, spec):
        expected = {}
        at_least = {}
        for r, e in v["expectedCount"].items():
            miss = 1.0
            for _ in range(n):
                miss = miss * (1.0 - v["pAppear"][r])
            expected[r] = e * n
            at_least[r] = 1.0 - miss
        out.append({"note": v["note"], "boxPacks": n,
                    "expectedCount": expected, "pAtLeastOne": at_least})
    return out


class _Mulberry32:
    """mulberry32 引擎内自含实现——与 shared/gacha.js 逐位一致（引擎勿 import tests）。"""

    def __init__(self, seed: int):
        self.a = seed & 0xFFFFFFFF

    def random(self) -> float:
        self.a = (self.a + 0x6D2B79F5) & 0xFFFFFFFF
        t = self.a
        t = ((t ^ (t >> 15)) * (t | 1)) & 0xFFFFFFFF
        t = (t ^ ((t + (((t ^ (t >> 7)) * (t | 61)) & 0xFFFFFFFF)) & 0xFFFFFFFF)) & 0xFFFFFFFF
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296


def collect_expectation(spec: dict, pools: dict, targets: dict, opts: dict | None = None) -> dict:
    """多目标「集齐期望」——shared/gacha.js collectExpectation 的镜像。

    targets 只认显式集合（"RR+"等口径由前端解析后传入）：
    - {"kind": "rarity", "rarities": [...]}：闭式公式 n·H_n/λ（λ 对变体取平均，包内去重忽略）
    - {"kind": "cards", "keys": [...]}：固定种子蒙特卡洛，卡列表由 pools 按 key 序展开
      （与 JS 逐行一致，保证同种子逐位对拍），每试验复用 _draw_by_slots 逐包开、集齐即止。
    """
    o = {"trials": 300, "packCap": 3000, "seed": 0xC011EC7}
    if opts:
        o.update(opts)
    variants = spec.get("variants") or [{"note": spec.get("note", ""), "slots": spec["slots"]}]

    if targets and targets.get("kind") == "rarity":
        wanted = [r for r in (targets.get("rarities") or []) if pools.get(r)]
        n = sum(len(pools[r]) for r in wanted)
        available = list(pools)
        total = sum(len(v) for v in pools.values())
        lam = 0.0
        for v in variants:
            for slot in v["slots"]:
                probs = _normalize(slot["weights"], set(available)) or None
                for r in wanted:
                    lam += probs.get(r, 0.0) if probs else (len(pools[r]) / total if total else 0.0)
        if len(variants) > 1:
            lam /= len(variants)
        h = 0.0
        for k in range(1, n + 1):
            h += 1.0 / k
        expected = (n * h) / lam if (n and lam > 0) else None
        return {
            "mode": "closed",
            "expectedPacks": expected,
            "expectedSpend": expected * spec["priceCny"]
                if (expected is not None and spec.get("priceCny")) else None,
            "formula": "nHn/lambda",
        }

    card_list = [c for r in pools for c in pools[r]]
    key_set = {_card_key(c) for c in card_list}
    raw_keys = list((targets or {}).get("keys") or [])
    wanted_keys = [k for k in raw_keys if k in key_set]
    out = {
        "mode": "sim",
        "expectedPacks": None, "medianPacks": None, "p90Packs": None,
        "completedRatio": 0,
        "packCap": o["packCap"],
        "expectedSpend": None,
        "note": f"仅统计 {o['packCap']} 包内集齐的试验，完成率 0.0%",
        "filtered": len(raw_keys) - len(wanted_keys),
    }
    if not wanted_keys:
        return out

    rng = _Mulberry32(o["seed"])
    done: list = []
    for _ in range(o["trials"]):
        remaining = set(wanted_keys)
        for p in range(1, o["packCap"] + 1):
            v = variants[int(rng.random() * len(variants))]
            pack = _draw_by_slots(v["slots"], "FIXTURE", spec.get("id", ""), pools, card_list, rng)
            for c in pack:
                remaining.discard(_card_key(c))
            if not remaining:
                done.append(p)
                break
    completed = len(done)
    out["completedRatio"] = completed / o["trials"]
    if completed:
        done.sort()
        out["expectedPacks"] = sum(done) / completed
        out["medianPacks"] = done[(completed - 1) // 2]
        out["p90Packs"] = done[int((completed - 1) * 0.9)]
        out["expectedSpend"] = out["expectedPacks"] * spec["priceCny"] if spec.get("priceCny") else None
        out["note"] = f"仅统计 {o['packCap']} 包内集齐的试验，完成率 {out['completedRatio'] * 100:.1f}%"
    return out


def spec_probabilities(set_id: str, spec: dict) -> dict:
    """某弹某规格的概率表，含封入变体（供「概率公示」展示）。"""
    cards = load_cards(set_id)
    pools = build_pools(cards)
    set_code = set_id.split("__")[0]
    spec_id = spec["id"]

    def slot_table(slots: list) -> list:
        out = []
        for slot in slots:
            probs = _slot_probs(slot, set_code, spec_id, pools)
            out.append({
                "name": slot["name"],
                "kind": slot["kind"],
                "fallback": probs is None,
                "probabilities": [
                    {"rarity": r, "p": p, "pool": len(pools.get(r, []))}
                    for r, p in sorted((probs or {}).items(), key=lambda kv: -kv[1])
                ],
            })
        return out

    variants = spec.get("variants") or [{"note": spec.get("note", ""), "slots": spec.get("slots", [])}]
    first = variants[0]
    return {
        "id": spec_id,
        "label": spec["label"],
        "note": spec.get("note", ""),
        "price": spec.get("price"),
        "packSize": len(first.get("slots") or spec.get("slots") or []),
        "variants": [
            {"note": v["note"], "slots": slot_table(v["slots"])} for v in variants
        ],
    }


def set_probabilities(set_id: str) -> list:
    """某弹全部规格的概率表。"""
    return [spec_probabilities(set_id, spec) for spec in config.set_specs(set_id)]
