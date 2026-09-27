# -*- coding: utf-8 -*-
"""宝可梦卡牌（简中）拆卡模拟 —— 桌面小程序。

数据：Cryst's Cards Database（tcg.mik.moe）公开 API 同步的简中卡表（本地缓存）。
图片：抽卡时按需经本服务代理并缓存（/img、/icon）。

开发运行：python app.py  →  自动打开浏览器
打包 exe：PyInstaller --onefile --noconsole（见 build_exe.bat），双击即用

路由与服务实现拆分在 server/ 包（api/media/store/httpcache/paths），
本文件只保留：Flask app 创建、页面路由、桌面窗口（pywebview/浏览器回退）入口。
"""
import os
import socket
import sys
import threading
import time
import webbrowser

from flask import Flask, send_file, send_from_directory

from server import api as server_api
from server import httpcache as server_httpcache
from server import media as server_media
from server import store as server_store
from server.paths import (BUNDLED_DATA, DATA, DETAIL_CACHE, ICON_CACHE, IMG_CACHE,  # noqa: F401
                          SHARED_DIR, STATIC_DIR)  # 数据目录常量自 app 重导出：兼容旧导入方（tools/baseline_perf.py 等）

app = Flask(__name__, static_folder=str(STATIC_DIR), static_url_path="/static")

# 路由注册（endpoint 名与函数名一致，规则与拆分前逐条相同）
server_api.register(app)
server_media.register(app)
server_store.register(app)
server_httpcache.register(app)


# ---------------------------------------------------------------- 页面
@app.route("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


@app.get("/static/gacha.js")
def shared_gacha():
    """shared/gacha.js：与 Python 引擎同源的 JS 拆卡引擎（tests 同种子对拍）。"""
    return send_file(SHARED_DIR / "gacha.js", mimetype="text/javascript", max_age=3600)


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
