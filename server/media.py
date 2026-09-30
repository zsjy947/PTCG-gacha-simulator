# -*- coding: utf-8 -*-
"""/img /thumb /icon 图片代理路由（自 app.py 原样搬移）。"""
import re

import requests
from flask import jsonify, send_file

from .httpcache import MIK_ICON, MIK_IMG, _cached_fetch, _lru_touch, _thumb_for
from .paths import ICON_CACHE, IMG_CACHE, _SAFE


def _strip_ext(name: str) -> str:
    """允许客户端带上 .png/.webp 等扩展名，统一去掉。"""
    return re.sub(r"\.(png|webp|jpg|jpeg)$", "", name, flags=re.I)


def card_image(code: str, idx: str):
    idx = _strip_ext(idx)
    if not (_SAFE.match(code) and _SAFE.match(idx)):
        return jsonify({"error": "非法参数"}), 400
    dest = IMG_CACHE / code / f"{idx}.png"
    try:
        ok = _cached_fetch(MIK_IMG.format(code=code, idx=idx), dest)
    except (requests.RequestException, OSError):  # 上游网络/本地磁盘异常 → 结构化 404，而非 500（F14）
        ok = False
    if ok:
        _lru_touch(dest)
        return send_file(dest, mimetype="image/png", max_age=86400)
    return jsonify({"error": "图片获取失败"}), 404


def card_thumb(code: str, idx: str):
    idx = _strip_ext(idx)
    if not (_SAFE.match(code) and _SAFE.match(idx)):
        return jsonify({"error": "非法参数"}), 400
    src = IMG_CACHE / code / f"{idx}.png"
    dest = IMG_CACHE / "thumb" / code / f"{idx}.webp"
    if not _thumb_for(src, dest):
        # 缩略图不可用（如 Pillow 缺失）时下载原图并兜底直出，保证有图
        try:
            _cached_fetch(MIK_IMG.format(code=code, idx=idx), src)
        except (requests.RequestException, OSError):  # 回源异常时走下方无图兜底 404（F14）
            pass
        if not _thumb_for(src, dest):
            if src.exists() and src.stat().st_size > 0:
                return send_file(src, mimetype="image/png", max_age=86400)
            return jsonify({"error": "图片获取失败"}), 404
    _lru_touch(dest)
    return send_file(dest, mimetype="image/webp", max_age=86400)


def set_icon(code: str):
    code = _strip_ext(code)
    if not _SAFE.match(code):
        return jsonify({"error": "非法参数"}), 400
    dest = ICON_CACHE / f"{code}.png"
    try:
        ok = _cached_fetch(MIK_ICON.format(code=code), dest)
    except (requests.RequestException, OSError):  # 上游网络/本地磁盘异常 → 结构化 404，而非 500（F14）
        ok = False
    if ok:
        return send_file(dest, mimetype="image/png", max_age=86400)
    return jsonify({"error": "无图标"}), 404


def register(app):
    """把图片代理路由挂到 Flask 应用。"""
    app.get("/img/<code>/<idx>")(card_image)
    app.get("/thumb/<code>/<idx>")(card_thumb)
    app.get("/icon/<code>")(set_icon)
