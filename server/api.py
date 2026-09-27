# -*- coding: utf-8 -*-
"""/api/* 只读与数据路由（自 app.py 原样搬移）：弹列表、卡表、概率、开包、详情、清单、价格。"""
import json
import sys
import time

from flask import current_app, jsonify, request, send_file

import config
import gacha
from version import APP_VERSION

from .httpcache import DETAIL_CACHE, _fetch_detail
from .paths import BUNDLED_DATA, DATA, _SAFE


def load_index() -> list:
    path = DATA / "sets_index.json"
    if not path.exists():
        return []
    return json.loads(path.read_text(encoding="utf-8"))


def _card_urls(card: dict) -> dict:
    code, idx = card.get("setCode"), card.get("cardIndex")
    card["image"] = f"/img/{code}/{idx}" if code and idx else None
    return card


def _spec_brief(code: str) -> list:
    """某弹的包规格简表（给前端渲染按钮与说明）。"""
    specs = config.set_specs(code)
    return [{
        "id": s["id"],
        "key": s["key"],
        "label": s["label"],
        "short": s.get("short") or s["id"],
        "note": s.get("note", ""),
        "price": s.get("price"),
        "priceCny": s.get("priceCny"),
        "boxPacks": s.get("boxPacks"),
        "packSize": len((s.get("variants") or [{"slots": s["slots"]}])[0]["slots"]),
        "default": i == 0,
    } for i, s in enumerate(specs)]


# ---------------------------------------------------------------- API
def api_sets():
    groups = {}
    for s in load_index():
        if not s.get("count"):
            continue  # 数据源无卡牌索引的弹（如特典卡）不展示
        s = dict(s)
        # 用条目 id 而非 code：收集啦151 拆分弹共享 code=151C，须按各自 id 归类
        group, drawable = config.product_group(s["id"])
        s["group"] = group
        s["drawable"] = drawable
        s["specs"] = _spec_brief(s["id"])
        groups.setdefault(group, []).append(s)
    result = [{"group": g, "sets": groups[g]}
              for g in config.GROUP_ORDER if g in groups]
    for g, sets in groups.items():  # 兜底：未知分组排最后
        if g not in config.GROUP_ORDER:
            result.append({"group": g, "sets": sets})
    if not result:
        return jsonify({"error": "本地暂无弹数据，请先运行 python fetch_data.py"}), 503
    return jsonify({"groups": result})


def api_set_cards(set_id: str):
    if not _SAFE.match(set_id):
        return jsonify({"error": "非法弹代码"}), 400
    try:
        cards = gacha.load_cards(set_id)
    except gacha.SetDataError as e:
        return jsonify({"error": str(e)}), 404
    return jsonify({"count": len(cards), "cards": [_card_urls(c) for c in cards]})


def api_set_probabilities(set_id: str):
    if not _SAFE.match(set_id):
        return jsonify({"error": "非法弹代码"}), 400
    try:
        return jsonify({"specs": gacha.set_probabilities(set_id)})
    except gacha.SetDataError as e:
        return jsonify({"error": str(e)}), 404


def api_draw():
    body = request.get_json(silent=True) or {}
    set_id = str(body.get("set") or "")
    spec = body.get("spec") or None
    packs = max(1, min(int(body.get("packs") or 1), 40))
    if not _SAFE.match(set_id):
        return jsonify({"error": "非法弹代码"}), 400
    if not config.set_specs(set_id):
        return jsonify({"error": "该商品无公开随机包规格，未开放拆卡（可浏览卡表）"}), 400
    try:
        packs_out = gacha.draw_pack(set_id, spec, packs)
        return jsonify({
            "mode": "pack",
            "spec": spec,
            "packs": [[_card_urls(c) for c in p] for p in packs_out],
        })
    except gacha.SetDataError as e:
        return jsonify({"error": str(e)}), 404


def api_card_detail(set_id: str, idx: str):
    if not (_SAFE.match(set_id) and _SAFE.match(idx)):
        return jsonify({"error": "非法参数"}), 400
    dest = DETAIL_CACHE / f"{set_id}__{idx}.json"
    if not _fetch_detail(set_id, idx):
        return jsonify({"error": "获取失败"}), 502
    return send_file(dest, mimetype="application/json")


def health():
    return jsonify({"ok": True, "time": time.time()})


def app_version():
    return jsonify({"version": APP_VERSION})


def data_manifest():
    """内置数据清单：前端热更新以此 + 已应用记录为基线做增量比对（而非全量下载）。"""
    src = BUNDLED_DATA if getattr(sys, "frozen", False) else DATA
    path = src / "manifest.json"
    if not path.exists():
        path = DATA / "manifest.json"
    if not path.exists():
        return jsonify({"sets": {}})
    return current_app.response_class(path.read_text(encoding="utf-8"), mimetype="application/json")


def api_prices():
    """内置卡价静态快照（pricetool sync 生成 data/prices/index.json，随包发布）。

    非实时行情：更新需重新运行 python -m pricetool sync 并重打包。
    无快照（旧版本数据）时返回空表，前端隐藏卡值/回本栏。
    """
    src = BUNDLED_DATA if getattr(sys, "frozen", False) else DATA
    path = src / "prices" / "index.json"
    if not path.exists():
        path = DATA / "prices" / "index.json"
    if not path.exists():
        return jsonify({"generated": None, "count": 0, "prices": {}})
    return current_app.response_class(path.read_text(encoding="utf-8"), mimetype="application/json")


def register(app):
    """把 /api/* 路由挂到 Flask 应用（endpoint 名与原装饰器时代一致）。"""
    app.get("/api/sets")(api_sets)
    app.get("/api/sets/<set_id>/cards")(api_set_cards)
    app.get("/api/sets/<set_id>/probabilities")(api_set_probabilities)
    app.post("/api/draw")(api_draw)
    app.get("/api/card/<set_id>/<idx>")(api_card_detail)
    app.get("/api/health")(health)
    app.get("/api/version")(app_version)
    app.get("/api/data-manifest")(data_manifest)
    app.get("/api/prices")(api_prices)
