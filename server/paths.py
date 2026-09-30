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

# 路由参数（弹代码/卡号）白名单：客户端传入的路径片段必须整体匹配，防目录穿越；
# 前瞻排除纯 "." / ".."（曾可拼出指向目录本身的路径，PTCG-R3-01）
_SAFE = re.compile(r"^(?!\.\.?$)[A-Za-z0-9._\-]{1,40}$")


def _ensure_writable_data():
    """exe 每次启动用打包内置的最新 sets_index.json / manifest.json 刷新可写目录（%LOCALAPPDATA%）。

    只拷贝这两个文件：弹索引供 /api/sets 等读取，manifest 供热更新基线比对。
    cards/*.json 不再拷贝——冻结态卡表由引擎直接读 _MEIPASS 内置数据（gacha.CARDS_DIR
    指向打包目录），用户目录下的卡表副本无任何读者，整体复制只拖慢启动（PTCG-R2-04）。
    旧版本遗留的 cards 目录原地保留，不影响运行。
    """
    if DATA == BUNDLED_DATA:
        return
    DATA.mkdir(parents=True, exist_ok=True)
    for name in ("sets_index.json", "manifest.json"):  # manifest 供热更新基线比对
        bundled_idx = BUNDLED_DATA / name
        if bundled_idx.exists():
            shutil.copy2(bundled_idx, DATA / name)


try:  # 可写目录/缓存目录初始化失败（磁盘占满、权限等）不阻断 import（PTCG-R2-04）：
    # exe --noconsole 下 import 期静默死亡无任何日志，告警到 stderr 后降级继续更易排查
    _ensure_writable_data()
    for d in (IMG_CACHE, ICON_CACHE, DETAIL_CACHE):
        d.mkdir(parents=True, exist_ok=True)
except OSError as e:
    print(f"数据目录初始化失败（继续运行，图片缓存等可能不可用）：{e}", file=sys.stderr)
