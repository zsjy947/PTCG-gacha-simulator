# -*- coding: utf-8 -*-
"""生成微信小程序端的数据与引擎资产（miniprogram/）。

- 卡表裁剪为拆卡/收藏/浏览所需的最小字段（setCode/cardIndex/cardName/rarity），
  全量约 0.9MB，可整体放进小程序主包（主包上限 2MB），无需分包。
- 抽卡规格元数据由 config.py 导出，与 exe / APK 完全同源。
- 引擎复制 shared/gacha.js（小程序 CommonJS require）。
- 卡背图压缩为 WebP。

用法：python tools/build_miniprogram.py
"""
import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import config  # noqa: E402
from version import APP_VERSION  # noqa: E402

MINI = ROOT / "miniprogram"
KEEP_FIELDS = ("setCode", "cardIndex", "cardName", "rarity")


def spec_brief(code: str) -> list:
    specs = []
    for i, s in enumerate(config.set_specs(code)):
        variants = s.get("variants")
        pack_size = len((variants or [{"slots": s["slots"]}])[0]["slots"])
        entry = {
            "id": s["id"], "key": s["key"], "label": s["label"],
            "short": s.get("short") or s["id"],
            "note": s.get("note", ""), "price": s.get("price"),
            "priceCny": s.get("priceCny"),
            "packSize": pack_size, "default": i == 0,
            "slots": s.get("slots") or variants[0]["slots"],
        }
        if variants:
            entry["variants"] = variants
        specs.append(entry)
    return specs


def main() -> int:
    data = ROOT / "data"
    cards_out = MINI / "data"
    cards_out.mkdir(parents=True, exist_ok=True)

    # ---- 弹索引 + 抽卡规格元数据 ----
    idx = json.loads((data / "sets_index.json").read_text(encoding="utf-8"))
    sets_meta = {}
    sets_list = []
    for s in idx:
        if not s.get("count"):
            continue
        group, drawable = config.product_group(s["id"])
        specs = spec_brief(s["id"]) if drawable else []
        sets_meta[s["id"]] = {"group": group, "drawable": drawable, "specs": specs}
        sets_list.append({"id": s["id"], "code": s["code"], "name": s["name"],
                          "seriesZh": s.get("seriesZh", ""), "count": s["count"]})

    (cards_out / "index.js").write_text(
        "/* 由 tools/build_miniprogram.py 生成，勿手改 */\n"
        "module.exports = " + json.dumps(
            {"appVersion": APP_VERSION, "sets": sets_list, "meta": sets_meta},
            ensure_ascii=False, separators=(",", ":")) + ";\n",
        encoding="utf-8")

    # ---- 全量卡表（裁剪字段）----
    trimmed = {}
    total = 0
    for f in sorted((data / "cards").glob("*.json")):
        cards = json.loads(f.read_text(encoding="utf-8"))
        trimmed[f.stem] = [{k: c.get(k) for k in KEEP_FIELDS} for c in cards]
        total += len(trimmed[f.stem])
    payload = json.dumps(trimmed, ensure_ascii=False, separators=(",", ":"))
    (cards_out / "cards.js").write_text(
        "/* 由 tools/build_miniprogram.py 生成，勿手改 */\n"
        "module.exports = " + payload + ";\n", encoding="utf-8")
    size_kb = len(payload.encode("utf-8")) / 1024

    # ---- 引擎 ----
    MINI.joinpath("utils").mkdir(exist_ok=True)
    shutil.copy2(ROOT / "shared" / "gacha.js", MINI / "utils" / "gacha.js")

    # ---- 卡背图（WebP 压缩）----
    try:
        from PIL import Image
        img_dir = MINI / "images"
        img_dir.mkdir(exist_ok=True)
        with Image.open(ROOT / "static" / "cardback.png") as im:
            im.thumbnail((480, 480), Image.LANCZOS)
            im.save(img_dir / "cardback.webp", "WEBP", quality=80, method=4)
    except ImportError:
        shutil.copy2(ROOT / "static" / "cardback.png", MINI / "images" / "cardback.png")

    print(f"小程序资产生成完成: {MINI}")
    print(f"  弹 {len(sets_list)} 个（可拆 {sum(1 for m in sets_meta.values() if m['drawable'])} 个）")
    print(f"  卡表 {total} 张，cards.js 约 {size_kb:.0f} KB（主包预算 2MB 内）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
