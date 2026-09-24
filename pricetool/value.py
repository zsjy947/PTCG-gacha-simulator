# -*- coding: utf-8 -*-
"""估值核心：给定 (setCode, cardIndex, count) 列表，按本地价格数据算市值。

输入兼容模拟器收藏导出格式（static/app.js 的 {name, rarity, setCode, cardIndex, count}）
以及裸列表 / {"cards": [...]} 包装。价格为 0/null 的卡不算入总价，单独归入缺价清单。
"""
from . import store
from .kyo import cny_price


def parse_collection(data):
    """把收藏 JSON 解析为 [{setCode, cardIndex, count, name?, rarity?}]，非法条目跳过。"""
    if isinstance(data, dict):
        if "cards" in data:
            data = data["cards"]
        elif "collection" in data:
            data = data["collection"]
        else:
            raise ValueError("收藏文件应为卡列表 JSON（或 {\"cards\": [...]}）")
    if not isinstance(data, list):
        raise ValueError("收藏文件应为卡列表 JSON（或 {\"cards\": [...]}）")
    entries = []
    for it in data:
        if not isinstance(it, dict):
            continue
        set_code = it.get("setCode")
        card_index = it.get("cardIndex")
        if not set_code or card_index in (None, ""):
            continue
        try:
            count = int(it.get("count", 1))
        except (TypeError, ValueError):
            count = 1
        if count <= 0:
            continue
        entries.append({
            "setCode": set_code,
            "cardIndex": card_index,
            "count": count,
            "name": it.get("name") or "",
            "rarity": it.get("rarity") or "",
        })
    return entries


def valuate(entries: list, price_index: dict = None, card_index: dict = None) -> dict:
    """逐卡估值并汇总。返回 {rows, missing, total, by_set, by_rarity}。

    rows 按单卡小计降序；missing 为无价卡（单独计数，不计入总价）。
    """
    price_index = price_index if price_index is not None else store.load_price_index()
    card_index = card_index if card_index is not None else store.load_card_index()

    rows, missing = [], []
    # 同一卡合并数量（收藏导出可能重复条目）
    merged = {}
    for e in entries:
        key = store.card_key(e["setCode"], e["cardIndex"])
        m = merged.setdefault(key, {"key": key, "setCode": e["setCode"],
                                    "cardIndex": e["cardIndex"], "count": 0,
                                    "name": e.get("name") or "", "rarity": e.get("rarity") or ""})
        m["count"] += e["count"]

    for m in merged.values():
        card = card_index.get(m["key"])
        if card:
            m["name"] = m["name"] or card.get("cardName") or ""
            m["rarity"] = m["rarity"] or card.get("rarity") or ""
        info = price_index.get(m["key"]) or {}
        price = cny_price(info)
        m["jihuansheProductId"] = info.get("jihuansheProductId")
        if price is not None and price > 0:
            m["unit"] = price
            m["subtotal"] = round(price * m["count"], 2)
            rows.append(m)
        else:
            m["unit"] = None
            m["subtotal"] = None
            missing.append(m)

    rows.sort(key=lambda r: r["subtotal"], reverse=True)
    by_set, by_rarity = {}, {}
    for r in rows:
        by_set[r["setCode"]] = round(by_set.get(r["setCode"], 0.0) + r["subtotal"], 2)
        rk = r["rarity"] or "未知"
        by_rarity[rk] = round(by_rarity.get(rk, 0.0) + r["subtotal"], 2)
    return {
        "rows": rows,
        "missing": missing,
        "total": round(sum(r["subtotal"] for r in rows), 2),
        "by_set": dict(sorted(by_set.items(), key=lambda kv: kv[1], reverse=True)),
        "by_rarity": dict(sorted(by_rarity.items(), key=lambda kv: kv[1], reverse=True)),
        "total_count": sum(m["count"] for m in merged.values()),
        "priced_count": sum(r["count"] for r in rows),
    }
