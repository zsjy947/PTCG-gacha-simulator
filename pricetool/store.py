# -*- coding: utf-8 -*-
"""本地数据访问层：弹索引、卡表、价格文件的读写。"""
import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
CARDS_DIR = DATA_DIR / "cards"
PRICES_DIR = DATA_DIR / "prices"
MANIFEST_PATH = PRICES_DIR / "manifest.json"


def atomic_write_json(path: Path, obj) -> None:
    """原子写 JSON：进程中断不会留下截断文件（与 fetch_data.py 同一套路）。"""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(obj, ensure_ascii=False, indent=1), encoding="utf-8")
    os.replace(tmp, path)


def norm_index(v) -> str:
    """卡号归一：纯数字补零到三位（"1"→"001"），非数字（如 FIR）原样保留。"""
    s = str(v).strip()
    return s.zfill(3) if s.isdigit() else s


def card_key(set_code: str, card_index) -> str:
    return f"{set_code}__{norm_index(card_index)}"


def load_sets_index() -> list:
    """读弹索引；sets_index 里 PROMO 等代码重复的条目按 id 去重（共享同一卡表文件）。"""
    data = json.loads((DATA_DIR / "sets_index.json").read_text(encoding="utf-8"))
    seen, out = set(), []
    for e in data:
        if e["id"] in seen:
            continue
        seen.add(e["id"])
        out.append(e)
    return out


def load_cards(set_id: str) -> list:
    p = CARDS_DIR / f"{set_id}.json"
    if not p.exists():
        return []
    return json.loads(p.read_text(encoding="utf-8"))


def load_price_file(set_id: str) -> dict:
    p = PRICES_DIR / f"{set_id}.json"
    if not p.exists():
        return {}
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def load_price_index() -> dict:
    """合并所有弹的价格文件为 {setCode__cardIndex: {...}} 索引。"""
    index = {}
    if not PRICES_DIR.exists():
        return index
    for p in sorted(PRICES_DIR.glob("*.json")):
        if p.name == "manifest.json":
            continue
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        set_code = data.get("setCode") or p.stem
        for num, info in (data.get("cards") or {}).items():
            index[f"{set_code}__{num}"] = info
    return index


def load_card_index() -> dict:
    """全量卡表索引 {setCode__cardIndex: 卡对象}，供查价/估值取卡名。"""
    index = {}
    for e in load_sets_index():
        for c in load_cards(e["id"]):
            index[card_key(c["setCode"], c["cardIndex"])] = c
    return index


def load_manifest() -> dict:
    if not MANIFEST_PATH.exists():
        return {}
    try:
        return json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
