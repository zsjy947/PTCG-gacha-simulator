# -*- coding: utf-8 -*-
"""从 Cryst's Cards Database（tcg.mik.moe）同步简中 PTCG 弹与卡牌数据到本地。

数据源为简中社区维护的公开 API，本脚本只做只读拉取并缓存为 JSON，
后续抽卡完全基于本地数据，卡牌图片在抽卡时按需经后端代理下载。

用法：
    python fetch_data.py            # 增量同步（已有卡表的弹跳过）
    python fetch_data.py --force    # 全量重新同步
"""
import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

BASE = "https://tcg.mik.moe/api/v3"
ROOT = Path(__file__).parent
DATA = ROOT / "data"
CARDS_DIR = DATA / "cards"

HEADERS = {
    "Content-Type": "application/json",
    "Referer": "https://tcg.mik.moe/",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) ptcc-gacha-sync",
}
SERIES_ZH = {
    "Mega": "超级进化系列",
    "Scarlet & Violet": "朱&紫 系列",
    "Sword & Shield": "剑&盾 系列",
    "Sun & Moon": "太阳&月亮 系列",
    "30th": "30周年庆典",
}


def derive_series(code: str) -> str:
    """mik 的 expansion 条目不带 series 字段，按弹代码前缀推导所属系列。"""
    if code.startswith("MP"):
        return "Mega"
    if code.startswith("CSM"):
        return "Sun & Moon"
    if code.startswith(("CSV", "CBB")) or code == "151C":
        return "Scarlet & Violet"
    if code.startswith("CS"):
        return "Sword & Shield"
    return "PROMO" if code == "PROMO" else "Other"


def post(path: str, payload: dict, retries: int = 3):
    req = urllib.request.Request(
        f"{BASE}/{path}",
        data=json.dumps(payload).encode("utf-8"),
        headers=HEADERS,
        method="POST",
    )
    last = None
    for i in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                body = json.loads(r.read().decode("utf-8"))
            if body.get("code") != 200:
                raise RuntimeError(f"API 返回异常: {body.get('msg')}")
            return body["data"]
        except Exception as e:  # noqa: BLE001 - 网络重试
            last = e
            time.sleep(1.5 * (i + 1))
    raise RuntimeError(f"请求 {path} 失败: {last}")


def series_slug(series: str) -> str:
    return {v: k for k, v in SERIES_ZH.items()}.get(series, series or "unknown")


def set_file_id(code: str, series: str, seen: dict) -> str:
    """同代码多系列（PROMO）时生成带系列后缀的唯一 ID。"""
    if code not in seen:
        seen[code] = series
        return code
    if seen[code] == series:
        return code
    return f"{code}__{series_slug(series)}"


def fetch_all_expansions():
    data = post("card/card-advance-search-params", {})
    exp = data.get("expansion") or []
    return exp


def fetch_set_cards(code: str, series: str):
    cards, page = [], 1
    while True:
        payload = {"set": [code], "page": page, "pageSize": 100}
        if series:
            payload["series"] = series
        d = post("card/card-advance-search", payload)
        lst = d.get("list") or []
        cards.extend(lst)
        item_num = int(d.get("itemNum") or 0)
        if not lst or len(cards) >= item_num or page > 50:
            break
        page += 1
        time.sleep(0.2)
    return cards


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true", help="忽略本地缓存全量重新拉取")
    args = ap.parse_args()

    CARDS_DIR.mkdir(parents=True, exist_ok=True)
    DATA.mkdir(exist_ok=True)

    print(">> 拉取弹列表 ...")
    expansions = fetch_all_expansions()
    print(f"   共 {len(expansions)} 个弹")

    seen = {}
    index = []
    for i, e in enumerate(expansions, 1):
        code = e["setCode"]
        series = derive_series(code)
        name = e.get("setName") or code
        fid = set_file_id(code, series, seen)
        out = CARDS_DIR / f"{fid}.json"

        if out.exists() and not args.force:
            cards = json.loads(out.read_text(encoding="utf-8"))
            print(f"[{i}/{len(expansions)}] {name}（{code}）本地已有 {len(cards)} 张，跳过")
        else:
            try:
                cards = fetch_set_cards(code, series)
            except Exception as exc:  # noqa: BLE001
                print(f"[{i}/{len(expansions)}] {name}（{code}）拉取失败: {exc}")
                cards = []
            out.write_text(
                json.dumps(cards, ensure_ascii=False, indent=1), encoding="utf-8"
            )
            print(f"[{i}/{len(expansions)}] {name}（{code}）同步 {len(cards)} 张")
            time.sleep(0.25)

        index.append({
            "id": fid,
            "code": code,
            "name": name,
            "series": series,
            "seriesZh": SERIES_ZH.get(series, "特典卡" if series == "PROMO" else "其他"),
            "count": len(cards),
        })

    (DATA / "sets_index.json").write_text(
        json.dumps(index, ensure_ascii=False, indent=1), encoding="utf-8"
    )
    print(f">> 完成：{len(index)} 个弹，索引已写入 data/sets_index.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
