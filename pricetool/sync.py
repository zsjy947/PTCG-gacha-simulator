# -*- coding: utf-8 -*-
"""价格同步：按弹拉取 Kyo Cards 行情 → data/prices/<setCode>.json + manifest。

策略（仿 fetch_data.py：原子写、失败保留旧数据、manifest 供增量）：
- 弹级批量走 card-queries（search=Kyo弹码），过滤 set id 防串弹；
- 价格 ≥ 阈值的卡再调 price/single 精修（两端口径有差异，两个价都落盘）；
- 缓存 TTL 默认 6 小时；失败保留旧文件并在汇总里点名。
"""
import hashlib
import json
import time
from datetime import datetime

from . import store
from .kyo import KyoClient, to_price
from .matcher import build_set_map, entry_price, match_cards

DEFAULT_TTL_HOURS = 6.0
DEFAULT_REFINE_THRESHOLD = 50.0
DEFAULT_BUDGET = 120        # 单次运行发出的 HTTP 请求上限（实测约 80~110 次会触发源站限流）
TOPUP_RATIO_GATE = 0.3      # 弹级搜索命中低于该比例时跳过按卡名补搜
TOPUP_NAME_CAP = 60         # 单弹最多补搜的卡名数

# 补搜条目只保留匹配/落盘所需字段，跨运行缓存（data/prices/name_cache.json）
_TRIM_FIELDS = ("id", "number", "name", "rarity", "grade", "type",
                "jihuansheMarketPrice", "marketPrice", "updatedAt")


def _trim(entries):
    out = []
    for e in entries:
        if not isinstance(e, dict):
            continue
        t = {k: e.get(k) for k in _TRIM_FIELDS}
        t["set"] = {"id": (e.get("set") or {}).get("id")}
        out.append(t)
    return out


def _md5(path) -> str:
    return hashlib.md5(path.read_bytes()).hexdigest()


def _is_fresh(entry: dict, ttl_hours: float) -> bool:
    ts = entry.get("fetchedAt")
    if not ts:
        return False
    try:
        fetched = datetime.fromisoformat(ts)
    except ValueError:
        return False
    age_h = (datetime.now().astimezone() - fetched).total_seconds() / 3600
    return 0 <= age_h < ttl_hours


def sync(only=None, force=False, ttl_hours=DEFAULT_TTL_HOURS,
         refine_threshold=DEFAULT_REFINE_THRESHOLD, budget=DEFAULT_BUDGET, client=None) -> int:
    """同步价格。only 为弹 id/代码列表时只同步这些弹；refine_threshold=None 跳过精修、
    0 表示全部精修；budget 为单次运行的请求上限。返回 0 成功、2 有失败。"""
    client = client or KyoClient()
    local_sets = store.load_sets_index()
    # 本地卡表为空的弹（PROMO）没有可挂价格的卡，直接跳过
    local_sets = [e for e in local_sets if store.load_cards(e["id"])]
    only_ids = None
    if only:
        only_ids = {o.strip() for o in only if o.strip()}

    print(">> 拉取 Kyo Cards 弹列表 ...")
    kyo_sets = client.list_sets()
    mapping, report = build_set_map(local_sets, kyo_sets)
    print(f"   PKCN {len(kyo_sets)} 弹；本地 {len(local_sets)} 弹命中 {len(mapping)}（"
          f"exact {sum(1 for *_, m in report['matched'] if m == 'exact')}/"
          f"alias {sum(1 for *_, m in report['matched'] if m == 'alias')}/"
          f"normalized {sum(1 for *_, m in report['matched'] if m == 'normalized')}）")
    if report["kyo_unused"]:
        print(f"   Kyo 未映射弹：{'、'.join(report['kyo_unused'])}"
              + "（其中 OGV1-3 疑似 30thDC 但编号体系不一致，暂不自动映射）")

    todo = [e for e in local_sets
            if e["id"] in mapping
            and (only_ids is None or only_ids & {e["id"], e["code"]})]
    if only_ids:
        known = {e["id"] for e in local_sets} | {e["code"] for e in local_sets}
        unknown = only_ids - known
        if unknown:
            print(f"!! 未知弹代号：{'、'.join(sorted(unknown))}")
            return 2

    if only_ids and not todo:
        mapped_only = only_ids & {e["id"] for e in local_sets if e["id"] in mapping}
        print(f"!! 指定的弹均不在 Kyo 覆盖范围（如 {'、'.join(sorted(only_ids))}），无可同步项")
        return 2

    manifest = store.load_manifest()
    manifest.setdefault("sets", {})
    entries_cache = {}   # kyo set id -> 弹级搜索条目（151 四弹共享同一次搜索）
    name_cache = {}      # 英文名 -> 补搜条目（跨运行复用，防重复请求触发限流）
    name_cache_path = store.PRICES_DIR / "name_cache.json"
    if name_cache_path.exists():
        try:
            name_cache = json.loads(name_cache_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            name_cache = {}
    failed, total_cards, total_priced, total_refined = [], 0, 0, 0
    waf_hit = False

    for i, e in enumerate(todo, 1):
        sid, code, name = e["id"], e["code"], e["name"]
        old = manifest["sets"].get(sid) or {}
        if not force and _is_fresh(old, ttl_hours) and (store.PRICES_DIR / f"{sid}.json").exists():
            print(f"[{i}/{len(todo)}] {name}（{sid}）缓存新鲜，跳过")
            continue
        kset = mapping[sid]
        try:
            if kset["id"] not in entries_cache:
                entries_cache[kset["id"]] = client.search_cards(kset["code"])
                # 源站限流时会返回 200 空数据（软拦截）：等几秒重试一次仍为空才认
                if not entries_cache[kset["id"]]:
                    time.sleep(5)
                    entries_cache[kset["id"]] = client.search_cards(kset["code"])
            entries = list(entries_cache[kset["id"]])
            local_cards = store.load_cards(sid)
            priced, missing_remote, mismatch = match_cards(local_cards, entries, kyo_set_id=kset["id"])
            if not entries:
                raise RuntimeError("搜索结果为空（疑被源站软限流），不落盘等下次重试")
            if entries and not priced:
                print(f"   [{sid}] 警告：搜索有 {len(entries)} 条但无一张匹配本地卡号")
            # 按弹名搜索的索引不完整（如 30TH A 漏 137 喷火龙）：
            # 对缺价卡用本地英文名补搜，再靠 set id + 卡号过滤兜底。
            # 命中率过低的弹（如宝石包仅有整盒产品）没有散卡可补，直接跳过。
            if missing_remote and len(priced) / max(1, len(local_cards)) >= TOPUP_RATIO_GATE:
                local_by_num = {store.norm_index(c["cardIndex"]): c for c in local_cards}
                extended, searched = False, 0
                for num in missing_remote:
                    if searched >= TOPUP_NAME_CAP or client.request_count >= budget:
                        break
                    en = (local_by_num[num].get("nameEn") or "").strip()
                    if not en:
                        continue
                    if en not in name_cache:
                        try:
                            name_cache[en] = _trim(client.search_cards(en))
                        except Exception:  # noqa: BLE001 - 补搜失败不影响已有结果
                            name_cache[en] = []
                        searched += 1
                    entries.extend(name_cache[en])
                    extended = True
                if extended:
                    priced, missing_remote, mismatch = match_cards(
                        local_cards, entries, kyo_set_id=kset["id"])
            elif missing_remote:
                print(f"   [{sid}] 弹级搜索命中 {len(priced)}/{len(local_cards)}"
                      f"（< {TOPUP_RATIO_GATE:.0%}），跳过按卡名补搜")
        except Exception as exc:  # noqa: BLE001 - 单弹失败保留旧数据
            print(f"[{i}/{len(todo)}] {name}（{sid}）拉取失败: {exc}")
            failed.append(sid)
            if "403" in str(exc):
                print("!! 疑似触发源站限流（403），提前结束本次同步；已同步数据保留，稍后重试")
                waf_hit = True
                break
            continue

        cards = {}
        for num, kc in sorted(priced.items()):
            cards[num] = {
                "price": entry_price(kc),
                "listPrice": to_price(kc.get("jihuansheMarketPrice")),
                "marketPrice": to_price(kc.get("marketPrice")),
                "detailPrice": None,
                "refined": False,
                "jihuansheProductId": kc.get("jihuansheProductId"),
                "kyoCardId": kc.get("id"),
                "rarity": kc.get("rarity"),
                "name": kc.get("name"),
                "updatedAt": kc.get("updatedAt"),
            }

        refined = 0
        for num, info in cards.items():
            if refine_threshold is None or not info["kyoCardId"]:
                continue
            base = info["listPrice"] or info["marketPrice"]
            if (base or 0) < refine_threshold:
                continue
            if client.request_count >= budget:
                print(f"   [{sid}] 请求预算耗尽（{budget}），剩余卡沿用列表价")
                break
            try:
                detail = client.price_single(info["kyoCardId"])
                dp = to_price(detail.get("jihuansheMarketPrice"))
            except Exception:  # noqa: BLE001 - 精修失败不影响列表价
                continue
            if dp is not None:
                info["detailPrice"] = dp
                info["price"] = dp
                info["refined"] = True
                refined += 1
                pid = detail.get("jihuansheProductId")
                if pid:
                    info["jihuansheProductId"] = pid

        fetched_at = time.strftime("%Y-%m-%dT%H:%M:%S+08:00")
        n_priced = sum(1 for c in cards.values() if c["price"] is not None)
        store.atomic_write_json(store.PRICES_DIR / f"{sid}.json", {
            "setCode": code,
            "setName": name,
            "kyoSet": {"id": kset["id"], "code": kset["code"], "name": kset.get("name")},
            "fetchedAt": fetched_at,
            "cards": cards,
        })
        manifest["sets"][sid] = {
            "fetchedAt": fetched_at,
            "total": len(store.load_cards(sid)),
            "priced": n_priced,
            "refined": refined,
            "md5": _md5(store.PRICES_DIR / f"{sid}.json"),
        }
        total_cards += len(store.load_cards(sid))
        total_priced += n_priced
        total_refined += refined
        extra = f"，缺价 {len(missing_remote)}" if missing_remote else ""
        warn = f"，名称不一致 {len(mismatch)}" if mismatch else ""
        print(f"[{i}/{len(todo)}] {name}（{sid}）匹配 {len(cards)}/{e['count']}、有价 {n_priced}"
              f"（精修 {refined}{extra}{warn}）")
        time.sleep(0.3)

    manifest["generated"] = time.strftime("%Y-%m-%dT%H:%M:%S+08:00")
    store.atomic_write_json(store.MANIFEST_PATH, manifest)
    if name_cache:
        store.atomic_write_json(name_cache_path, name_cache)

    print(f">> 完成：同步 {len(todo) - len(failed)}/{len(todo)} 弹，"
          f"有价 {total_priced}/{total_cards} 张（精修 {total_refined} 张），"
          f"共 {client.request_count} 次请求，清单写入 data/prices/manifest.json")
    if waf_hit:
        return 2
    if report["missed"]:
        print(f">> Kyo 无覆盖的本地弹（{len(report['missed'])} 个，多为剑盾/日月/嗨皮/大师等早期系列）："
              + "、".join(report["missed"][:12]) + ("…" if len(report["missed"]) > 12 else ""))
    if failed:
        print(f">> 注意：{len(failed)} 弹拉取失败（已保留原有数据）：{'、'.join(failed)}")
        return 2
    return 0
