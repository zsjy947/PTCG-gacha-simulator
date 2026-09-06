# -*- coding: utf-8 -*-
"""宝可梦卡牌（简中）模拟抽卡 —— 桌面小程序。

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
from pathlib import Path

import requests
from flask import Flask, jsonify, request, send_file, send_from_directory

import config
import gacha

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
IMG_CACHE = DATA / "img_cache"
ICON_CACHE = DATA / "icon_cache"
DETAIL_CACHE = DATA / "detail_cache"


def _ensure_writable_data():
    """exe 首次运行时，把打包内置的卡表数据释放到可写目录。"""
    if DATA == BUNDLED_DATA:
        return
    DATA.mkdir(parents=True, exist_ok=True)
    idx = DATA / "sets_index.json"
    if not idx.exists() and (BUNDLED_DATA / "sets_index.json").exists():
        shutil.copy2(BUNDLED_DATA / "sets_index.json", idx)
    src_cards, dst_cards = BUNDLED_DATA / "cards", DATA / "cards"
    if (src_cards / "CSV9.5C.json").exists() and not (dst_cards / "CSV9.5C.json").exists():
        dst_cards.mkdir(parents=True, exist_ok=True)
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
_guard = threading.Lock()
_locks: dict = {}   # 每个目标文件一把锁：不同图片并行下载，互不阻塞
_inflight: set = set()


def _lock_for(key: str) -> threading.Lock:
    with _guard:
        return _locks.setdefault(key, threading.Lock())


def _cached_fetch(url: str, dest: Path, timeout: int = 30) -> bool:
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
        with Image.open(src) as im:
            w, h = im.size
            if w > THUMB_WIDTH:
                im = im.resize((THUMB_WIDTH, round(h * THUMB_WIDTH / w)), Image.LANCZOS)
            im.save(dest, "WEBP", quality=82, method=4)
        return True
    except Exception:
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
            timeout=30,
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
        "packSize": len((s.get("variants") or [{"slots": s["slots"]}])[0]["slots"]),
        "default": i == 0,
    } for i, s in enumerate(specs)]


# ---------------------------------------------------------------- 页面
@app.route("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


# ---------------------------------------------------------------- API
@app.get("/api/sets")
def api_sets():
    groups = {}
    for s in load_index():
        if not s.get("count"):
            continue  # 数据源无卡牌索引的弹（如特典卡）不展示
        s = dict(s)
        s["specs"] = _spec_brief(s["code"])
        groups.setdefault(s.get("seriesZh") or "其他", []).append(s)
    order = [config.SERIES_GROUP[k] for k in
             ("Mega", "Scarlet & Violet", "Sword & Shield", "Sun & Moon", "30th")]
    result = []
    for g in order:
        if g in groups:
            result.append({"group": g, "sets": groups.pop(g)})
    for g, sets in groups.items():
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
    body = request.get_json(silent=True) or {}
    set_id = str(body.get("set") or "")
    spec = body.get("spec") or None
    packs = max(1, min(int(body.get("packs") or 1), 10))
    if not _SAFE.match(set_id):
        return jsonify({"error": "非法弹代码"}), 400
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
    idx = _strip_ext(idx)
    if not (_SAFE.match(code) and _SAFE.match(idx)):
        return jsonify({"error": "非法参数"}), 400
    dest = IMG_CACHE / code / f"{idx}.png"
    ok = _cached_fetch(MIK_IMG.format(code=code, idx=idx), dest)
    if ok:
        return send_file(dest, mimetype="image/png", max_age=86400)
    return jsonify({"error": "图片获取失败"}), 404


@app.get("/thumb/<code>/<idx>")
def card_thumb(code: str, idx: str):
    idx = _strip_ext(idx)
    if not (_SAFE.match(code) and _SAFE.match(idx)):
        return jsonify({"error": "非法参数"}), 400
    src = IMG_CACHE / code / f"{idx}.png"
    dest = IMG_CACHE / "thumb" / code / f"{idx}.webp"
    if _thumb_for(src, dest) or _cached_fetch(MIK_IMG.format(code=code, idx=idx), src) and _thumb_for(src, dest):
        return send_file(dest, mimetype="image/webp", max_age=86400)
    return jsonify({"error": "图片获取失败"}), 404


@app.get("/icon/<code>")
def set_icon(code: str):
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
            "宝可梦卡牌 · 简中模拟抽卡",
            url,
            width=1360, height=900, min_size=(960, 640),
            background_color="#0b0f1a",
        )
        webview.start()  # 阻塞直到窗口关闭
    else:
        # 无 pywebview 时回退到浏览器
        if getattr(sys, "frozen", False) or os.environ.get("PTCG_OPEN"):
            threading.Timer(1.2, lambda: webbrowser.open(url)).start()
        print(f"宝可梦卡牌（简中）模拟抽卡 → {url}")
        app.run(host="127.0.0.1", port=port, debug=False, threaded=True)
