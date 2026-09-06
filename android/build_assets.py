# -*- coding: utf-8 -*-
"""生成安卓 APK 的 WebView 资产（android/app/src/main/assets/www/）。

内嵌：前端三件套（index.html 注入资产模式标记）、弹索引、每弹卡表、
抽卡规格数据（由 config.py 导出，JS 端本地抽卡与概率公示共用）。
"""
import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import config

ROOT = Path(__file__).resolve().parent.parent
WWW = ROOT / "android" / "app" / "src" / "main" / "assets" / "www"


def spec_brief_full(code: str) -> list:
    specs = []
    for i, s in enumerate(config.set_specs(code)):
        variants = s.get("variants")
        pack_size = len((variants or [{"slots": s["slots"]}])[0]["slots"])
        entry = {
            "id": s["id"], "key": s["key"], "label": s["label"],
            "note": s.get("note", ""), "price": s.get("price"),
            "packSize": pack_size, "default": i == 0,
            "slots": s.get("slots") or variants[0]["slots"],
        }
        if variants:
            entry["variants"] = variants
        specs.append(entry)
    return specs


def main():
    data = ROOT / "data"
    if WWW.exists():
        shutil.rmtree(WWW)
    (WWW / "assets" / "cards").mkdir(parents=True, exist_ok=True)

    # 前端三件套（index.html 注入资产模式）
    html = (ROOT / "static" / "index.html").read_text(encoding="utf-8")
    html = html.replace('href="/static/style.css"', 'href="style.css"')
    html = html.replace('<script src="/static/app.js"></script>',
                        '<script>window.__ASSET_MODE__=true;'
                        'window.__ASSET_BASE__="https://tcg.mik.moe/static";</script>\n'
                        '<script src="app.js"></script>')
    (WWW / "index.html").write_text(html, encoding="utf-8")
    shutil.copy2(ROOT / "static" / "style.css", WWW / "style.css")
    shutil.copy2(ROOT / "static" / "app.js", WWW / "app.js")

    # 弹索引 + 抽卡规格元数据
    idx = json.loads((data / "sets_index.json").read_text(encoding="utf-8"))
    sets_meta = {}
    for s in idx:
        sets_meta[s["code"]] = {
            "name": s["name"],
            "seriesZh": s["seriesZh"],
            "count": s["count"],
            "specs": spec_brief_full(s["code"]),
        }
    (WWW / "assets" / "sets_index.json").write_text(
        json.dumps(idx, ensure_ascii=False), encoding="utf-8")
    (WWW / "assets" / "gacha_data.json").write_text(
        json.dumps({
            "sets": sets_meta,
            "fallback": {"specs": spec_brief_full("__generic__")},
        }, ensure_ascii=False), encoding="utf-8")

    # 每弹卡表
    for f in (data / "cards").glob("*.json"):
        shutil.copy2(f, WWW / "assets" / "cards" / f.name)

    n_cards = len(list((WWW / "assets" / "cards").glob("*.json")))
    print(f"资产生成完成: {WWW}")
    print(f"  卡表 {n_cards} 弹, 索引 {len(idx)} 条")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
