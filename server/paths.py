# -*- coding: utf-8 -*-
"""数据/资源目录解析（兼容 PyInstaller 冻结环境）与路由参数路径白名单。"""
import os
import re
import shutil
import sys
from pathlib import Path


def _resolve_dirs():
    if getattr(sys, "frozen", False):  # exe 模式：资源在 _MEIPASS，可写数据在 %LOCALAPPDATA%
        bundled = Path(getattr(sys, "_MEIPASS", Path(sys.executable).parent)) / "data"
        data_root = Path(os.environ.get("LOCALAPPDATA") or Path.home()) / "PTCGGacha"
        return bundled, data_root
    root = Path(__file__).parent.parent
    return root / "data", root / "data"


BUNDLED_DATA, DATA = _resolve_dirs()
STATIC_DIR = (Path(getattr(sys, "_MEIPASS", "")) / "static") if getattr(sys, "frozen", False) else Path(__file__).parent.parent / "static"
SHARED_DIR = (Path(getattr(sys, "_MEIPASS", "")) / "shared") if getattr(sys, "frozen", False) else Path(__file__).parent.parent / "shared"
IMG_CACHE = DATA / "img_cache"
ICON_CACHE = DATA / "icon_cache"
DETAIL_CACHE = DATA / "detail_cache"

# 路由参数（弹代码/卡号）白名单：客户端传入的路径片段必须整体匹配，防目录穿越
_SAFE = re.compile(r"^[A-Za-z0-9._\-]{1,40}$")


def _ensure_writable_data():
    """exe 每次启动都用打包内置的最新卡表数据刷新可写目录（%LOCALAPPDATA%）。

    旧版本遗留的本地数据可能过期（弹索引拆分/新增/分类调整等），必须整体覆盖，
    否则 exe 会一直沿用旧卡表。
    """
    if DATA == BUNDLED_DATA:
        return
    DATA.mkdir(parents=True, exist_ok=True)
    for name in ("sets_index.json", "manifest.json"):  # manifest 供热更新基线比对
        bundled_idx = BUNDLED_DATA / name
        if bundled_idx.exists():
            shutil.copy2(bundled_idx, DATA / name)
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
