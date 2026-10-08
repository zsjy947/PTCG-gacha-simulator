# -*- coding: utf-8 -*-
"""APK 构建薄入口 — 流水线由共享工具链 android-pack (apx) 执行，配置见 pack.toml。

用法：
    python android/build_apk.py                  # 构建（自动重建 WebView 资产）
    python android/build_apk.py --selfcheck      # 配置与工具链自检
    python android/build_apk.py --init-keystore  # fields 签名风格专用（本项目不需要）

共享包定位：ANDROID_PACK_HOME 或 <工作区>/archived/android-pack；
工具链（JDK 17 / build-tools / platform）发现与字段说明见 android-pack README。
"""
import os
import sys
from pathlib import Path

ANDROID = Path(__file__).resolve().parent
ROOT = ANDROID.parent


def _pack_home() -> Path:
    env = os.environ.get("ANDROID_PACK_HOME")
    if env and (Path(env) / "apx").is_dir():
        return Path(env)
    cand = ROOT.parent / "archived" / "android-pack"
    if (cand / "apx").is_dir():
        return cand
    raise SystemExit("未找到共享工具链 android-pack：设置 ANDROID_PACK_HOME，"
                     "或将其置于 <工作区>/archived/android-pack")


sys.path.insert(0, str(_pack_home()))
from apx.pipeline import main  # noqa: E402

if __name__ == "__main__":
    sys.exit(main(ANDROID / "pack.toml", argv=sys.argv[1:]))
