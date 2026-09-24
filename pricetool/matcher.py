# -*- coding: utf-8 -*-
"""本地卡表 ↔ Kyo Cards 的弹/卡匹配。

弹匹配优先级：本地 id 精确相等 → 手工别名表 → 去符号归一化比较。
卡匹配：Kyo number 与本地 cardIndex 都按 store.norm_index 归一后比对；
card-queries 对同一卡号可能返回多条变体（分级/语言等），取最优一条。
"""
import re

from .kyo import to_price
from .store import norm_index

# 本地 setCode 与 Kyo 弹码不一致的特例（2026-09 实测 PKCN 全量 23 弹对账得出）
SET_ALIASES = {
    "30thC": "30TH A",       # 30周年庆典
    "CSV9.5C": "SV9.5C",     # 太晶盛聚
    "CBB4C": "CBB4",         # 宝石包 VOL.4
    # 收集啦151 本地拆为旅/望/惊/聚四弹，共享同一卡表与 Kyo 151C
    "151C-LV": "151C",
    "151C-WANG": "151C",
    "151C-JING": "151C",
    "151C-JU": "151C",
}

# 有候选但编号体系对不齐、暂不自动映射（sync 报告里会提示）：
#   30thDC（45张，卡号含 FIR/GRA 等后缀）↔ OGV1/OGV2/OGV3（各 size 30）
#   PROMO 本地卡表为空，无需映射 CNP


def normalize_code(code: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", str(code).upper())


def norm_kyo_number(entry: dict) -> str:
    """从 Kyo 条目取规范卡号，与本地 cardIndex 对齐。

    collectorNo 才是可靠来源（number 字段混乱）：
      "048/129"        → "048"（普通弹）
      "CSV2C-002/128"  → "002"（部分弹带弹码前缀）
      "20 03/07"       → "2003"（宝石包：卡组号+卡号，本地即 4 位连写）
      "144/151"        → "144"（151 变体条目 number 是 "23 05" 这种分组号）
      "B/RGB"          → "B"（30周年 RGB 特殊卡）
    """
    raw = (entry.get("collectorNo") or entry.get("number") or "") if isinstance(entry, dict) else ""
    left = str(raw).split("/")[0]
    token = left.split("-")[-1].strip().replace(" ", "")
    return norm_index(token) if token else ""


def build_set_map(local_sets: list, kyo_sets: list):
    """返回 (mapping, report)：mapping 本地 id → Kyo 弹对象；report 含命中明细。"""
    by_code, by_norm = {}, {}
    for k in kyo_sets:
        by_code.setdefault(k.get("code"), k)
        by_norm.setdefault(normalize_code(k.get("code") or ""), k)

    mapping, matched, missed = {}, [], []
    for local in local_sets:
        lid = local["id"]
        hit, method = None, None
        if lid in by_code:
            hit, method = by_code[lid], "exact"
        elif lid in SET_ALIASES and SET_ALIASES[lid] in by_code:
            hit, method = by_code[SET_ALIASES[lid]], "alias"
        else:
            n = by_norm.get(normalize_code(lid))
            if n:
                hit, method = n, "normalized"
        if hit:
            mapping[lid] = hit
            matched.append((lid, hit.get("code"), method))
        else:
            missed.append(lid)

    used = {id(k) for k in mapping.values()}
    kyo_unused = [k.get("code") for k in kyo_sets if id(k) not in used]
    return mapping, {"matched": matched, "missed": missed, "kyo_unused": kyo_unused}


def entry_price(e: dict):
    """条目价格：优先集换社行情价，回退 marketPrice；0/null 视为无价。"""
    return to_price(e.get("jihuansheMarketPrice")) or to_price(e.get("marketPrice"))


def _rank(e: dict):
    """变体排序键：有集换社价 > 有价 > 未分级 > 单卡类型 > 更新时间新。"""
    return (
        0 if to_price(e.get("jihuansheMarketPrice")) is not None else 1,
        0 if entry_price(e) is not None else 1,
        e.get("grade") or 0,
        0 if e.get("type") == "SING" else 1,
        e.get("updatedAt") or "",
    )


def pick_best_cards(entries: list, kyo_set_id: str = None):
    """按卡号去重取最优条目。kyo_set_id 提供时先过滤掉其他弹混入的结果；
    SLAB（分级卡，价格口径不同）一律丢弃。"""
    best = {}
    for e in entries:
        if e.get("type") == "SLAB":
            continue
        if kyo_set_id:
            sid = (e.get("set") or {}).get("id")
            if sid and sid != kyo_set_id:
                continue
        num = norm_kyo_number(e)
        if not num:
            continue
        if num not in best or _rank(e) < _rank(best[num]):
            best[num] = e
    return best


def match_cards(local_cards: list, entries: list, kyo_set_id: str = None):
    """本地卡表 ↔ Kyo 条目按卡号匹配。

    返回 (priced, missing_remote, name_mismatch)：
      priced           {卡号: 最优 Kyo 条目}（只保留本地卡表里存在的卡号）
      missing_remote   本地有、Kyo 没有的卡号
      name_mismatch    [(卡号, 本地名, Kyo名)] —— 仅告警用
    """
    best = pick_best_cards(entries, kyo_set_id)
    local_nums = {norm_index(c["cardIndex"]): c for c in local_cards}
    priced = {n: e for n, e in best.items() if n in local_nums}
    missing_remote = sorted(set(local_nums) - set(best))
    mismatch = []
    for n, e in priced.items():
        en = (local_nums[n].get("nameEn") or "").strip().lower()
        kn = (e.get("name") or "").strip().lower()
        if en and kn and en != kn and kn not in en and en not in kn:
            mismatch.append((n, local_nums[n].get("nameEn"), e.get("name")))
    return priced, missing_remote, mismatch
