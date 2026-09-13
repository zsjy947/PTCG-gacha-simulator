# -*- coding: utf-8 -*-
"""宝可梦卡牌（简中）拆卡模拟 —— 桌面小程序。

数据：Cryst's Cards Database（tcg.mik.moe）公开 API 同步的简中卡表（本地缓存）。
图片：抽卡时按需经本服务代理并缓存（/img、/icon）。

开发运行：python app.py  →  自动打开浏览器
打包 exe：PyInstaller --onefile --noconsole（见 build_exe.py），双击即用
"""
import json
import os
import re
import shutil
import socket
import sys
import threading
import time
import webbrowser
from collections import deque
from pathlib import Path

import requests
from flask import Flask, jsonify, request, send_file, send_from_directory

import config
import gacha
from version import APP_VERSION

# ---------------------------------------------------------------- 路径（兼容 PyInstaller 冻结环境）
def _resolve_dirs():
    if getattr(sys, "frozen", False):  # exe 模式：资源在 _MEIPASS，可写数据在 %LOCALAPPDATA%
        bundled = Path(getattr(sys, "_MEIPASS", Path(sys.executable).parent)) / "data"
        data_root = Path(os.environ.get("LOCALAPPDATA") or Path.home()) / "PTCGGacha"
        return bundled, data_root
    root = Path(__file__).parent
    return root / "data", root / "data"


BUNDLED_DATA, DATA = _resolve_dirs()
STATIC_DIR = (Path(getattr(sys, "_MEIPASS", "")) / "static") if getattr(sys, "frozen", False) else Path(__file__).parent / "static"
SHARED_DIR = (Path(getattr(sys, "_MEIPASS", "")) / "shared") if getattr(sys, "frozen", False) else Path(__file__).parent / "shared"
IMG_CACHE = DATA / "img_cache"
ICON_CACHE = DATA / "icon_cache"
DETAIL_CACHE = DATA / "detail_cache"


def _ensure_writable_data():
    """exe 每次启动都用打包内置的最新卡表数据刷新可写目录（%LOCALAPPDATA%）。

    旧版本遗留的本地数据可能过期（弹索引拆分/新增/分类调整等），必须整体覆盖，
    否则 exe 会一直沿用旧卡表。
    """
    if DATA == BUNDLED_DATA:
        return
    DATA.mkdir(parents=True, exist_ok=True)
    bundled_idx = BUNDLED_DATA / "sets_index.json"
    if bundled_idx.exists():
        shutil.copy2(bundled_idx, DATA / "sets_index.json")
    src_cards, dst_cards = BUNDLED_DATA / "cards", DATA / "cards"
    if src_cards.exists():
        dst_cards.mkdir(parents=True, exist_ok=True)
        bundled_names = {f.name for f in src_cards.glob("*.json")}
        for f in dst_cards.glob("*.json"):  # 清理内置包已不存在的旧卡表
            if f.name not in bundled_names:
                try:
                    f.unlink()
                except OSError:
                    pass
        for f in src_cards.glob("*.json"):
            shutil.copy2(f, dst_cards / f.name)


_ensure_writable_data()
for d in (IMG_CACHE, ICON_CACHE, DETAIL_CACHE):
    d.mkdir(parents=True, exist_ok=True)

app = Flask(__name__, static_folder=str(STATIC_DIR), static_url_path="/static")

MIK_IMG = "https://tcg.mik.moe/static/img/{code}/{idx}.png"
MIK_ICON = "https://tcg.mik.moe/static/setCode/{code}.png"
MIK_API = "https://tcg.mik.moe/api/v3"

_SAFE = re.compile(r"^[A-Za-z0-9._\-]{1,40}$")
_http = requests.Session()
_http.headers["User-Agent"] = "Mozilla/5.0 ptcc-gacha"
_OUT_TIMEOUT = (5, 15)   # 出站请求（连接, 读取）超时：上游卡住时快速失败
_guard = threading.Lock()
_locks: dict = {}   # 每个目标文件一把锁：不同图片并行下载，互不阻塞
_inflight: set = set()

# ---------------------------------------------------------------- 代理限流（防止本机代理被滥用打满上游）
RL_WINDOW = 60.0        # 统计窗口
RL_LIMIT = 90           # 窗口内最多请求数（正常拆卡/浏览远低于此值）
_rl_lock = threading.Lock()
_rl_hits: dict = {}


def _rate_limited() -> bool:
    ip = request.headers.get("X-Forwarded-For", request.remote_addr or "?").split(",")[0].strip()
    now = time.monotonic()
    with _rl_lock:
        q = _rl_hits.get(ip)
        if q is None:
            q = _rl_hits[ip] = deque()
        while q and now - q[0] > RL_WINDOW:
            q.popleft()
        if len(q) >= RL_LIMIT:
            return True
        q.append(now)
        if len(_rl_hits) > 256:  # 防御性清理，避免长期运行膨胀
            for k in [k for k, v in _rl_hits.items() if not v]:
                _rl_hits.pop(k, None)
    return False


# ---------------------------------------------------------------- 图片缓存 LRU 上限
IMG_CACHE_MB = int(os.environ.get("PTCG_IMG_CACHE_MB") or 600)
_lru_lock = threading.Lock()
_lru_size = -1  # 缓存的目录字节数（-1 未初始化）


def _dir_bytes(path: Path) -> int:
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


def _lru_enforce():
    """超过上限时按 mtime 从旧到新淘汰，直到回到上限的 90%。"""
    global _lru_size
    with _lru_lock:
        if _lru_size < 0:
            _lru_size = _dir_bytes(IMG_CACHE)
        if _lru_size <= IMG_CACHE_MB * 1048576:
            return
        files = [(p.stat().st_mtime, p) for p in IMG_CACHE.rglob("*.png") if p.is_file()]
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
    """下载到缓存目录；同一文件并发请求只下载一次，不同文件并行。"""
    if dest.exists() and dest.stat().st_size > 0:
        return True
    key = str(dest)
    with _lock_for(key):
        if key in _inflight:
            return False  # 有并发请求在下载
        _inflight.add(key)
    try:
        for attempt in range(2):
            try:
                r = _http.get(url, timeout=timeout)
                if r.status_code == 200 and r.content:
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    tmp = dest.with_suffix(dest.suffix + ".part")
                    tmp.write_bytes(r.content)
                    tmp.replace(dest)
                    _lru_enforce()
                    return True
                if r.status_code == 404:
                    return False
            except requests.RequestException:
                if attempt == 1:
                    raise
                time.sleep(0.5)
        return False
    finally:
        with _lock_for(key):
            _inflight.discard(key)


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
    """mik 详情接口为 POST，拉取后缓存为 JSON 文件。"""
    dest = DETAIL_CACHE / f"{code}__{idx}.json"
    if dest.exists() and dest.stat().st_size > 0:
        return True
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
        "packSize": len((s.get("variants") or [{"slots": s["slots"]}])[0]["slots"]),
        "default": i == 0,
    } for i, s in enumerate(specs)]


# ---------------------------------------------------------------- 页面
@app.route("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


@app.get("/static/gacha.js")
def shared_gacha():
    """shared/gacha.js：与 Python 引擎同源的 JS 拆卡引擎（tests 同种子对拍）。"""
    return send_file(SHARED_DIR / "gacha.js", mimetype="text/javascript", max_age=3600)


# ---------------------------------------------------------------- API
@app.get("/api/sets")
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


@app.get("/api/sets/<set_id>/cards")
def api_set_cards(set_id: str):
    if not _SAFE.match(set_id):
        return jsonify({"error": "非法弹代码"}), 400
    try:
        cards = gacha.load_cards(set_id)
    except gacha.SetDataError as e:
        return jsonify({"error": str(e)}), 404
    return jsonify({"count": len(cards), "cards": [_card_urls(c) for c in cards]})


@app.get("/api/sets/<set_id>/probabilities")
def api_set_probabilities(set_id: str):
    if not _SAFE.match(set_id):
        return jsonify({"error": "非法弹代码"}), 400
    try:
        return jsonify({"specs": gacha.set_probabilities(set_id)})
    except gacha.SetDataError as e:
        return jsonify({"error": str(e)}), 404


@app.post("/api/draw")
def api_draw():
    if _rate_limited():
        return jsonify({"error": "请求过于频繁，请稍后再试"}), 429
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


@app.get("/api/card/<set_id>/<idx>")
def api_card_detail(set_id: str, idx: str):
    if _rate_limited():
        return jsonify({"error": "请求过于频繁，请稍后再试"}), 429
    if not (_SAFE.match(set_id) and _SAFE.match(idx)):
        return jsonify({"error": "非法参数"}), 400
    dest = DETAIL_CACHE / f"{set_id}__{idx}.json"
    if not _fetch_detail(set_id, idx):
        return jsonify({"error": "获取失败"}), 502
    return send_file(dest, mimetype="application/json")


# ---------------------------------------------------------------- 图片代理
def _strip_ext(name: str) -> str:
    """允许客户端带上 .png/.webp 等扩展名，统一去掉。"""
    return re.sub(r"\.(png|webp|jpg|jpeg)$", "", name, flags=re.I)


@app.get("/img/<code>/<idx>")
def card_image(code: str, idx: str):
    if _rate_limited():
        return jsonify({"error": "请求过于频繁，请稍后再试"}), 429
    idx = _strip_ext(idx)
    if not (_SAFE.match(code) and _SAFE.match(idx)):
        return jsonify({"error": "非法参数"}), 400
    dest = IMG_CACHE / code / f"{idx}.png"
    ok = _cached_fetch(MIK_IMG.format(code=code, idx=idx), dest)
    if ok:
        _lru_touch(dest)
        return send_file(dest, mimetype="image/png", max_age=86400)
    return jsonify({"error": "图片获取失败"}), 404


@app.get("/thumb/<code>/<idx>")
def card_thumb(code: str, idx: str):
    if _rate_limited():
        return jsonify({"error": "请求过于频繁，请稍后再试"}), 429
    idx = _strip_ext(idx)
    if not (_SAFE.match(code) and _SAFE.match(idx)):
        return jsonify({"error": "非法参数"}), 400
    src = IMG_CACHE / code / f"{idx}.png"
    dest = IMG_CACHE / "thumb" / code / f"{idx}.webp"
    if not _thumb_for(src, dest):
        # 缩略图不可用（如 Pillow 缺失）时下载原图并兜底直出，保证有图
        _cached_fetch(MIK_IMG.format(code=code, idx=idx), src)
        if not _thumb_for(src, dest):
            if src.exists() and src.stat().st_size > 0:
                return send_file(src, mimetype="image/png", max_age=86400)
            return jsonify({"error": "图片获取失败"}), 404
    _lru_touch(dest)
    return send_file(dest, mimetype="image/webp", max_age=86400)


@app.get("/icon/<code>")
def set_icon(code: str):
    if _rate_limited():
        return jsonify({"error": "请求过于频繁，请稍后再试"}), 429
    code = _strip_ext(code)
    if not _SAFE.match(code):
        return jsonify({"error": "非法参数"}), 400
    dest = ICON_CACHE / f"{code}.png"
    ok = _cached_fetch(MIK_ICON.format(code=code), dest)
    if ok:
        return send_file(dest, mimetype="image/png", max_age=86400)
    return jsonify({"error": "无图标"}), 404


@app.get("/api/health")
def health():
    return jsonify({"ok": True, "time": time.time()})


@app.get("/api/version")
def app_version():
    return jsonify({"version": APP_VERSION})


# ---- 抽卡记录/收藏册持久化：前端把 localStorage 的 ptcg_* 键镜像到这里 ----
USER_STORE = DATA / "user_store.json"
_store_lock = threading.Lock()


@app.get("/api/store/get")
def store_get():
    with _store_lock:
        if USER_STORE.exists():
            try:
                return app.response_class(
                    USER_STORE.read_text(encoding="utf-8"),
                    mimetype="application/json",
                )
            except OSError:
                pass
    return jsonify({"data": {}})


@app.post("/api/store/set")
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
            return jsonify({"error": f"写入失败：{e}"}), 500
    return jsonify({"ok": True})


def _dir_size(path: Path) -> int:
    total = 0
    for p in path.rglob("*"):
        try:
            if p.is_file():
                total += p.stat().st_size
        except OSError:
            pass
    return total


@app.get("/api/cache/info")
def cache_info():
    img = _dir_size(IMG_CACHE)
    icon = _dir_size(ICON_CACHE)
    detail = _dir_size(DETAIL_CACHE)
    total = img + icon + detail
    return jsonify({
        "total_bytes": total,
        "label": f"{total / 1048576:.1f} MB" if total >= 1048576 else f"{total / 1024:.0f} KB",
    })


@app.post("/api/cache/clear")
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


# ---------------------------------------------------------------- 启动
def _free_port(preferred: int = 5000) -> int:
    for port in (preferred, 8123, 8457, 0):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(("127.0.0.1", port))
                return s.getsockname()[1]
            except OSError:
                continue
    return preferred


if __name__ == "__main__":
    port = _free_port()
    url = f"http://127.0.0.1:{port}"
    window_mode = not os.environ.get("PTCG_NO_WINDOW")
    try:
        import webview  # pywebview：原生窗口（Edge WebView2）
    except ImportError:
        webview = None

    if webview is not None:
        threading.Thread(
            target=lambda: app.run(host="127.0.0.1", port=port, debug=False, threaded=True),
            daemon=True,
        ).start()
        time.sleep(1.0)
        webview.create_window(
            "PTCG拆卡模拟器",
            url,
            width=1360, height=900, min_size=(960, 640),
            background_color="#0b0f1a",
        )
        webview.start()  # 阻塞直到窗口关闭
    else:
        # 无 pywebview 时回退到浏览器
        if getattr(sys, "frozen", False) or os.environ.get("PTCG_OPEN"):
            threading.Timer(1.2, lambda: webbrowser.open(url)).start()
        print(f"PTCG拆卡模拟器 → {url}")
        app.run(host="127.0.0.1", port=port, debug=False, threaded=True)
