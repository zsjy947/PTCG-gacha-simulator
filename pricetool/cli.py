# -*- coding: utf-8 -*-
"""pricetool 命令行入口。

    python -m pricetool sync  [--set CSV5C,...] [--force] [--ttl 6] [--no-refine]
    python -m pricetool query 喷火龙 | CSV5C__128
    python -m pricetool table CSV5C [--csv out.csv] [--limit 30]
    python -m pricetool value collection.json [--csv out.csv] [--top 20]
"""
import argparse
import csv
import json
import sys

from . import store, value as value_mod
from .kyo import cny_price

JHS_LINK = "https://www.jihuanshe.com/app/cardDetail?gameKey=pkm&gameSubKey=sc&cardVersionId={pid}"
MIK_IMG = "https://tcg.mik.moe/static/img/{sc}/{num}.png"


def _resolve_set(term: str):
    """按 id / 代码（忽略大小写）/ 中文名找弹，返回索引条目或 None。"""
    sets = store.load_sets_index()
    t = term.strip()
    for e in sets:
        if e["id"] == t or e["code"] == t:
            return e
    tl = t.lower()
    for e in sets:
        if e["code"].lower() == tl:
            return e
    for e in sets:
        if t in e["name"]:
            return e
    return None


def _set_lookups():
    """返回 (按弹id, 按卡表代码) 两个查表；151C 等共享代码取第一个索引条目。"""
    by_id, by_code = {}, {}
    for e in store.load_sets_index():
        by_id[e["id"]] = e
        by_code.setdefault(e["code"], e)
    return by_id, by_code


def _fmt_price(p):
    return f"¥{p:.2f}" if p is not None and p > 0 else "-"


def _print_card_row(key, card, info, set_entry=None):
    set_name = set_entry["name"] if set_entry else ""
    sid = set_entry["id"] if set_entry else key.split("__", 1)[0]
    name = (card or {}).get("cardName") or (info or {}).get("name") or "?"
    rarity = (card or {}).get("rarity") or (info or {}).get("rarity") or "?"
    num = key.split("__", 1)[1]
    price = cny_price(info)
    print(f"  {name}（{set_name}） [{sid}#{num}] {rarity}  {_fmt_price(price)}")
    if info and info.get("refined"):
        print(f"    列表价 {info['listPrice']:.2f}（Kyo 展示币种） → 详情价 ¥{info['detailPrice']:.2f}（集换社人民币）")
    elif info and info.get("listPrice"):
        print(f"    列表价 {info['listPrice']:.2f}（Kyo 展示币种，按 5.249 折算为人民币）")
    pid = (info or {}).get("jihuansheProductId")
    if pid:
        print(f"    集换社: {JHS_LINK.format(pid=pid)}")
    sc = (card or {}).get("setCode") or key.split("__", 1)[0]
    print(f"    卡图: {MIK_IMG.format(sc=sc, num=store.norm_index(num))}")


def cmd_query(args) -> int:
    term = args.term.strip()
    card_index = store.load_card_index()
    price_index = store.load_price_index()
    set_by_id, set_by_code = _set_lookups()

    def _set_of(key):
        prefix = key.split("__", 1)[0]
        return set_by_id.get(prefix) or set_by_code.get(prefix)

    if "__" in term:  # setCode__cardIndex 直接查
        key = store.card_key(*term.split("__", 1))
        if key not in card_index:
            print(f"!! 卡表中不存在：{key}")
            return 2
        info = price_index.get(key)
        _print_card_row(key, card_index[key], info, _set_of(key))
        if cny_price(info) is None:
            print("  （无价格数据：该弹未同步或 Kyo 无覆盖，可运行 python -m pricetool sync）")
        return 0

    tl = term.lower()
    hits = [(k, c) for k, c in card_index.items()
            if term in (c.get("cardName") or "")
            or tl in (c.get("nameEn") or "").lower()]

    def _has_price(k):
        return cny_price(price_index.get(k)) is not None

    if not hits:
        print(f"!! 没有找到匹配「{term}」的卡（支持中文名/英文名/卡号键）")
        return 2
    hits.sort(key=lambda kc: kc[0])
    priced_hits = [h for h in hits if _has_price(h[0])]
    show = priced_hits or hits
    print(f"共 {len(hits)} 张匹配（有价 {len(priced_hits)} 张），显示前 {min(len(show), args.limit)} 张：")
    for k, c in show[:args.limit]:
        _print_card_row(k, c, price_index.get(k), _set_of(k))
    if len(show) > args.limit:
        print(f"  … 其余 {len(show) - args.limit} 张省略（--limit 调整）")
    if not priced_hits:
        print("  （均无价格数据：先运行 python -m pricetool sync）")
    return 0


def cmd_table(args) -> int:
    e = _resolve_set(args.set)
    if not e:
        print(f"!! 找不到弹：{args.set}（可用 id/代码/中文名）")
        return 2
    cards = store.load_cards(e["id"])
    pdata = store.load_price_file(e["id"])
    rows = []
    for c in cards:
        num = store.norm_index(c["cardIndex"])
        info = (pdata.get("cards") or {}).get(num) or {}
        rows.append((num, c.get("cardName") or "?", c.get("rarity") or "?",
                     cny_price(info), info.get("jihuansheProductId")))
    rows.sort(key=lambda r: (r[3] is None, -(r[3] or 0)))
    fetched = pdata.get("fetchedAt", "从未同步")
    print(f"{e['name']}（{e['id']}）{e['count']} 张，数据时间 {fetched}，"
          f"有价 {sum(1 for r in rows if r[3])} 张")
    for num, name, rarity, price, pid in rows[:args.limit]:
        print(f"  {num}  {name}  {rarity}  {_fmt_price(price)}" + (f"  jhs:{pid}" if pid else ""))
    if len(rows) > args.limit:
        print(f"  … 其余 {len(rows) - args.limit} 张省略（--limit 调整）")
    if args.csv:
        with open(args.csv, "w", newline="", encoding="utf-8-sig") as f:
            w = csv.writer(f)
            w.writerow(["卡号", "卡名", "稀有度", "人民币价", "集换社ID", "卡键"])
            for num, name, rarity, price, pid in rows:
                w.writerow([num, name, rarity, price or "", pid or "", f"{e['code']}__{num}"])
        print(f">> CSV 已写入 {args.csv}")
    return 0


def cmd_value(args) -> int:
    try:
        data = json.loads(open(args.file, encoding="utf-8").read())
    except (OSError, ValueError) as exc:
        print(f"!! 读取收藏文件失败: {exc}")
        return 2
    entries = value_mod.parse_collection(data)
    if not entries:
        print("!! 收藏文件里没有有效条目（需要 setCode/cardIndex/count 字段）")
        return 2
    r = value_mod.valuate(entries)
    print(f"收藏共 {r['total_count']} 张，有价 {r['priced_count']} 张，"
          f"总市值 ¥{r['total']:.2f}（集换社行情，人民币）")
    if r["by_set"]:
        print("按弹：")
        for sc, v in list(r["by_set"].items())[:8]:
            print(f"  {sc:<10} ¥{v:.2f}")
    print(f"价值最高的前 {min(args.top, len(r['rows']))} 张：")
    for m in r["rows"][:args.top]:
        print(f"  {m['name']}（{m['setCode']}#{m['cardIndex']}）×{m['count']}"
              f"  ¥{m['unit']:.2f}/张 → ¥{m['subtotal']:.2f}")
    if r["missing"]:
        print(f"缺价 {len(r['missing'])} 种（未计入总价）：")
        for m in r["missing"][:args.top]:
            print(f"  {m['name']}（{m['setCode']}#{m['cardIndex']}）×{m['count']}")
        if len(r["missing"]) > args.top:
            print(f"  … 其余 {len(r['missing']) - args.top} 种省略")
    if args.csv:
        with open(args.csv, "w", newline="", encoding="utf-8-sig") as f:
            w = csv.writer(f)
            w.writerow(["卡键", "卡名", "稀有度", "数量", "单价", "小计", "集换社ID"])
            for m in r["rows"]:
                w.writerow([m["key"], m["name"], m["rarity"], m["count"],
                            m["unit"], m["subtotal"], m.get("jihuansheProductId") or ""])
            for m in r["missing"]:
                w.writerow([m["key"], m["name"], m["rarity"], m["count"], "", "", ""])
        print(f">> CSV 已写入 {args.csv}")
    return 0


def cmd_sync(args) -> int:
    from .sync import sync
    if args.no_refine:
        threshold = None            # 跳过精修
    elif args.refine_all:
        threshold = 0.0             # 全部精修
    else:
        threshold = args.refine_threshold
    return sync(
        only=args.set.split(",") if args.set else None,
        force=args.force,
        ttl_hours=args.ttl,
        refine_threshold=threshold,
        budget=args.budget,
    )


def main(argv=None) -> int:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            try:
                stream.reconfigure(encoding="utf-8", errors="replace")
            except Exception:  # noqa: BLE001
                pass
    ap = argparse.ArgumentParser(prog="pricetool", description="PTCG 简中卡牌价格工具（Kyo Cards/集换社行情）")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("sync", help="同步价格数据到 data/prices/")
    p.add_argument("--set", help="仅同步指定弹（id 或代码，逗号分隔）")
    p.add_argument("--force", action="store_true", help="忽略缓存新鲜度强制重拉")
    p.add_argument("--ttl", type=float, default=6.0, help="缓存有效期（小时，默认 6）")
    p.add_argument("--refine-threshold", type=float, default=50.0, help="高于该价的卡调详情接口拿人民币价与集换社链接（默认 50）")
    p.add_argument("--refine-all", action="store_true", help="每张卡都调详情接口（慢，约 0.6s/张，但全部拿到人民币价）")
    p.add_argument("--no-refine", action="store_true", help="跳过详情精修")
    p.add_argument("--budget", type=int, default=600, help="单次运行请求上限（防触发源站限流，默认 600）")
    p.set_defaults(func=cmd_sync)

    p = sub.add_parser("query", help="单卡查价（中文名/英文名/setCode__卡号）")
    p.add_argument("term")
    p.add_argument("--limit", type=int, default=20, help="最多显示条数（默认 20）")
    p.set_defaults(func=cmd_query)

    p = sub.add_parser("table", help="整弹价格表（按价格降序）")
    p.add_argument("set")
    p.add_argument("--csv", help="导出 CSV 路径")
    p.add_argument("--limit", type=int, default=30, help="最多显示条数（默认 30）")
    p.set_defaults(func=cmd_table)

    p = sub.add_parser("value", help="收藏册估值")
    p.add_argument("file", help="收藏导出 JSON（{setCode, cardIndex, count} 列表）")
    p.add_argument("--csv", help="导出 CSV 路径")
    p.add_argument("--top", type=int, default=20, help="明细最多显示条数（默认 20）")
    p.set_defaults(func=cmd_value)

    args = ap.parse_args(argv)
    return args.func(args)
