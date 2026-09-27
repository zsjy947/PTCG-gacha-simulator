# -*- coding: utf-8 -*-
"""出站回源：限流、磁盘缓存 LRU、按文件锁并发下载、缩略图与卡牌详情回源、缓存路由。

只统计真正回源下载的请求；命中本地缓存的响应不占额度。
"""
import json
import os
import shutil
import threading
import time
from collections import deque
from pathlib import Path

import requests
from flask import jsonify, request

from .paths import DETAIL_CACHE, ICON_CACHE, IMG_CACHE

MIK_IMG = "https://tcg.mik.moe/static/img/{code}/{idx}.png"
MIK_ICON = "https://tcg.mik.moe/static/setCode/{code}.png"
MIK_API = "https://tcg.mik.moe/api/v3"

_http = requests.Session()
_http.headers["User-Agent"] = "Mozilla/5.0 ptcc-gacha"
_OUT_TIMEOUT = (5, 15)   # 出站请求（连接, 读取）超时：上游卡住时快速失败
_guard = threading.Lock()
_locks: dict = {}   # 每个目标文件一把锁：不同图片并行下载，互不阻塞；同文件并发等待复用

# ---------------------------------------------------------------- 回源限流（只统计真正回源下载的请求）
# 命中本地缓存的响应不占额度：一次整盒开包会请求几百张缩略图，缓存建立后必须不受限。
# 该限制仅防止异常循环/外部扫描把上游 mik.moe 打满，而非限制正常使用。
FETCH_WINDOW = 60.0      # 统计窗口（秒）
FETCH_LIMIT = 900        # 窗口内最多回源下载数（≈15 次/秒；冷缓存整盒首开 <700 张仍可一次完成）
_fetch_lock = threading.Lock()
_fetch_hits: dict = {}


def _fetch_allow() -> bool:
    ip = request.headers.get("X-Forwarded-For", request.remote_addr or "?").split(",")[0].strip()
    now = time.monotonic()
    with _fetch_lock:
        q = _fetch_hits.get(ip)
        if q is None:
            q = _fetch_hits[ip] = deque()
        while q and now - q[0] > FETCH_WINDOW:
            q.popleft()
        if len(q) >= FETCH_LIMIT:
            return False
        q.append(now)
        if len(_fetch_hits) > 256:  # 防御性清理，避免长期运行膨胀
            for k in [k for k, v in _fetch_hits.items() if not v]:
                _fetch_hits.pop(k, None)
    return True


# ---------------------------------------------------------------- 图片缓存 LRU 上限
IMG_CACHE_MB = int(os.environ.get("PTCG_IMG_CACHE_MB") or 600)
_lru_lock = threading.Lock()
_lru_size = -1            # 缓存目录字节数（-1 未初始化；下载/淘汰时增量维护）
_dl_since_enforce = 0     # 距上次 LRU 全量扫描的回源次数（扫描有成本，节流执行）


def _dir_size(path: Path) -> int:
    """递归统计目录字节数（LRU 初始化与 /api/cache/info 共用）。"""
    total = 0
    for p in path.rglob("*"):
        try:
            if p.is_file():
                total += p.stat().st_size
        except OSError:
            pass
    return total


def _lru_touch(dest: Path):
    """命中即续期（mtime 仍是下载时间的文件最旧，先被淘汰）。"""
    try:
        os.utime(dest, None)
    except OSError:
        pass


def _lru_after_download(nbytes: int):
    """下载落盘后增量记账；超限时每 20 次回源做一轮淘汰扫描。"""
    global _lru_size, _dl_since_enforce
    with _lru_lock:
        if _lru_size >= 0:
            _lru_size += nbytes
        _dl_since_enforce += 1
        over = _lru_size > IMG_CACHE_MB * 1048576
        due = _dl_since_enforce >= 20
        if due:
            _dl_since_enforce = 0
    if over and due:
        _lru_enforce()


def _lru_enforce():
    """超过上限时按 mtime 从旧到新淘汰，直到回到上限的 90%。"""
    global _lru_size
    with _lru_lock:
        if _lru_size < 0:
            _lru_size = _dir_size(IMG_CACHE)
        if _lru_size <= IMG_CACHE_MB * 1048576:
            return
        files = [(p.stat().st_mtime, p) for p in IMG_CACHE.rglob("*") if p.is_file()]
        files.sort()
        target = IMG_CACHE_MB * 1048576 * 0.9
        for _, p in files:
            if _lru_size <= target:
                break
            try:
                size = p.stat().st_size
                p.unlink()
                _lru_size -= size
            except OSError:
                break


def _lock_for(key: str) -> threading.Lock:
    with _guard:
        return _locks.setdefault(key, threading.Lock())


def _cached_fetch(url: str, dest: Path, timeout: tuple = _OUT_TIMEOUT) -> bool:
    """下载到缓存目录；同一文件并发请求只下载一次，其余等待后直接命中缓存，
    不同文件并行。仅真正回源时占用限流额度；命中缓存的请求不受限。"""
    if dest.exists() and dest.stat().st_size > 0:
        return True
    if not _fetch_allow():
        return False  # 回源额度用尽：本次图片暂缺，窗口过后重试即得
    lock = _lock_for(str(dest))
    with lock:  # 并发同文件：等首个下载者完成后复查缓存，而非拒绝请求
        if dest.exists() and dest.stat().st_size > 0:
            return True
        for attempt in range(2):
            try:
                r = _http.get(url, timeout=timeout)
                if r.status_code == 200 and r.content:
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    tmp = dest.with_suffix(dest.suffix + ".part")
                    tmp.write_bytes(r.content)
                    tmp.replace(dest)
                    _lru_after_download(len(r.content))
                    return True
                if r.status_code == 404:
                    return False
            except requests.RequestException:
                if attempt == 1:
                    raise
                time.sleep(0.5)
        return False


try:
    from PIL import Image
except ImportError:
    Image = None

THUMB_WIDTH = 480  # 卡片缩略图宽度（webp），列表/翻卡用，详情弹窗用原图


def _thumb_for(src: Path, dest: Path) -> bool:
    if dest.exists() and dest.stat().st_size > 0:
        return True
    if Image is None or not src.exists():
        return False
    try:
        dest.parent.mkdir(parents=True, exist_ok=True)
        with Image.open(src) as im:
            w, h = im.size
            if w > THUMB_WIDTH:
                im = im.resize((THUMB_WIDTH, round(h * THUMB_WIDTH / w)), Image.LANCZOS)
            im.save(dest, "WEBP", quality=82, method=4)
        return True
    except Exception as e:
        try:  # 冻结环境排障：把缩略图异常落盘
            (IMG_CACHE / "thumb_error.log").write_text(repr(e), encoding="utf-8")
        except Exception:
            pass
        return False


def _fetch_detail(code: str, idx: str) -> bool:
    """mik 详情接口为 POST，拉取后缓存为 JSON 文件（回源占限流额度，缓存命中不受限）。"""
    dest = DETAIL_CACHE / f"{code}__{idx}.json"
    if dest.exists() and dest.stat().st_size > 0:
        return True
    if not _fetch_allow():
        return False
    try:
        r = _http.post(
            f"{MIK_API}/card/card-detail",
            json={"setCode": code, "cardIndex": idx},
            timeout=_OUT_TIMEOUT,
        )
        data = r.json()
        if data.get("code") == 200 and data.get("data"):
            dest.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
            return True
    except (requests.RequestException, ValueError):
        return False
    return False


# ---------------------------------------------------------------- 缓存路由


def cache_info():
    img = _dir_size(IMG_CACHE)
    icon = _dir_size(ICON_CACHE)
    detail = _dir_size(DETAIL_CACHE)
    total = img + icon + detail
    return jsonify({
        "total_bytes": total,
        "label": f"{total / 1048576:.1f} MB" if total >= 1048576 else f"{total / 1024:.0f} KB",
    })


def cache_clear():
    global _lru_size
    for d in (IMG_CACHE, ICON_CACHE, DETAIL_CACHE):
        for p in d.rglob("*"):
            try:
                if p.is_file():
                    p.unlink()
                elif p.is_dir():
                    shutil.rmtree(p, ignore_errors=True)
            except OSError:
                pass
    with _lru_lock:
        _lru_size = 0
    return jsonify({"ok": True})
