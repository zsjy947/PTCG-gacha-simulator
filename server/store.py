# -*- coding: utf-8 -*-
"""抽卡记录/收藏册持久化路由（自 app.py 原样搬移）：前端把 localStorage 的 ptcg_* 键镜像到这里。

存储信封 {"rev": <int>, "data": {...}}：rev 为客户端维护的单调递增版本号，
POST 携带的 rev 不大于已存 rev 时跳过写入，防止并发快照乱序到达时旧数据覆盖新数据
（F24/PTCG-R2-02）。旧格式文件（无 rev）读取时视为 rev=0，文件不存在视为尚未写入。
"""
import json
import threading

from flask import jsonify, request

from .paths import DATA

USER_STORE = DATA / "user_store.json"
_store_lock = threading.Lock()


def _load_state():
    """读取当前存储状态，返回 (rev, data)；文件不存在/损坏返回 (-1, {})，旧格式（无 rev）按 rev=0。"""
    try:
        env = json.loads(USER_STORE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return -1, {}
    if not isinstance(env, dict) or not isinstance(env.get("data"), dict):
        return -1, {}
    rev = env.get("rev")
    if not isinstance(rev, int) or isinstance(rev, bool):
        rev = 0
    return rev, env["data"]


def store_get():
    with _store_lock:
        rev, data = _load_state()
    return jsonify({"rev": max(rev, 0), "data": data})


def store_set():
    body = request.get_json(silent=True) or {}
    data = body.get("data")
    if not isinstance(data, dict):
        return jsonify({"error": "非法参数"}), 400
    rev = body.get("rev")
    if not isinstance(rev, int) or isinstance(rev, bool):
        rev = 0  # 缺失/非整数按 0（兼容不带版本号的旧客户端）
    tmp = USER_STORE.with_suffix(".json.tmp")
    with _store_lock:
        cur_rev, _ = _load_state()
        if rev <= cur_rev:  # 旧快照后到：跳过写入，避免乱序回退
            return jsonify({"success": True, "skipped": True, "rev": max(cur_rev, 0)})
        try:
            tmp.write_text(json.dumps({"rev": rev, "data": data}, ensure_ascii=False), encoding="utf-8")
            tmp.replace(USER_STORE)
        except OSError as e:
            try:  # 写失败不残留 .json.tmp（BE-022）
                tmp.unlink()
            except OSError:
                pass
            return jsonify({"error": f"写入失败：{e}"}), 500
    return jsonify({"success": True, "skipped": False, "rev": rev})


def register(app):
    """把持久化路由挂到 Flask 应用。"""
    app.get("/api/store/get")(store_get)
    app.post("/api/store/set")(store_set)
