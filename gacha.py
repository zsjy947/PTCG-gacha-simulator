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


def _pick_rarity(probs: dict) -> str:
    roll = random.random()
    acc = 0.0
    for r, p in probs.items():
        acc += p
        if roll <= acc:
            return r
    return next(reversed(probs))


def _card_key(card: dict) -> str:
    return f"{card.get('setCode')}__{card.get('cardIndex')}"


def _pick_card(pools: dict, rarity: str | None, cards: list, used: set | None = None) -> dict:
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
    return dict(random.choice(src))


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


def _draw_by_slots(slots: list, set_code: str, spec_id: str, pools: dict, cards: list) -> list:
    pack: list = []
    used: set = set()  # 本包已出现的卡（setCode__cardIndex），包内不重复
    for slot in slots:
        probs = _slot_probs(slot, set_code, spec_id, pools)
        if probs:
            card = _pick_card(pools, _pick_rarity(probs), cards, used)
        else:
            card = _pick_card(pools, None, cards, used)
        used.add(_card_key(card))
        card["slotName"] = slot["name"]
        card["slotKind"] = slot["kind"]
        pack.append(card)
    return pack


def draw_pack(set_id: str, spec_id: str | None = None, packs: int = 1) -> list:
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

    variants = spec.get("variants") or [{"note": spec.get("note", ""), "slots": spec["slots"]}]
    result = []
    for _ in range(packs):
        v = random.choice(variants)
        pack = _draw_by_slots(v["slots"], set_code, spec["id"], pools, cards)
        result.append(pack)
    return result


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
