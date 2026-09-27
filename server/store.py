# -*- coding: utf-8 -*-
"""抽卡记录/收藏册持久化路由（自 app.py 原样搬移）：前端把 localStorage 的 ptcg_* 键镜像到这里。"""
import json
import threading

from flask import current_app, jsonify, request

from .paths import DATA

USER_STORE = DATA / "user_store.json"
_store_lock = threading.Lock()


def store_get():
    with _store_lock:
        if USER_STORE.exists():
            try:
                return current_app.response_class(
                    USER_STORE.read_text(encoding="utf-8"),
                    mimetype="application/json",
                )
            except OSError:
                pass
    return jsonify({"data": {}})


def store_set():
    body = request.get_json(silent=True) or {}
    data = body.get("data")
    if not isinstance(data, dict):
        return jsonify({"error": "非法参数"}), 400
    tmp = USER_STORE.with_suffix(".json.tmp")
    with _store_lock:
        try:
            tmp.write_text(json.dumps({"data": data}, ensure_ascii=False), encoding="utf-8")
            tmp.replace(USER_STORE)
        except OSError as e:
            try:  # 写失败不残留 .json.tmp（BE-022）
                tmp.unlink()
            except OSError:
                pass
            return jsonify({"error": f"写入失败：{e}"}), 500
    return jsonify({"ok": True})


def register(app):
    """把持久化路由挂到 Flask 应用。"""
    app.get("/api/store/get")(store_get)
    app.post("/api/store/set")(store_set)
