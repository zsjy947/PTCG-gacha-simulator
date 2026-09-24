# -*- coding: utf-8 -*-
"""Kyo Cards 公开接口客户端（价格数据源，集中隔离便于将来换源）。

接口（2026-09 实测，无鉴权、CORS 全开）：
    GET /sets?skip&take                        弹列表（productLine 参数不生效，需客户端过滤）
    GET /card-queries?skip&take&productLine&productType&search
                                              搜卡（search 同时匹配卡名与弹名，含 set 子串）
    GET /cards/{id}/price/single               单卡详情价（与列表价口径有差异，见 sync.py 校准说明）

礼貌抓取：默认 0.4s 最小间隔 + 3 次重试退避。已知接口怪癖：
- /card-queries 不支持按弹过滤参数（set/setCode 均被忽略），只有 search 生效；
  且按弹名搜索的索引不完整（30TH A 漏 137 喷火龙），完整枚举需按卡名补搜（见 sync.py）。
- 价格口径（2026-09 抽样 14 张卡实测）：detail 的 jihuansheMarketPrice 恒等于
  list 同名字段的 ×5.249 —— 是单位换算而非估值差异。判断：detail 为集换社
  人民币原价，list 为 Kyo 展示币种（新加坡站，SGD/CNY≈5.25）。sync 默认
  detail 优先（--prefer 可切换），未精修卡沿用 list 原值不做换算。
- jihuansheProductId 只在 price/single 返回，列表接口没有。
- 集换社公开榜单 searchPageRanking 的 value 是热度分不是价格，勿作价锚。
"""
import time

import requests

BASE = "https://kyocards.com/shopping-cards/v1"
PRODUCT_LINE = "PKCN"  # Pokemon Chinese（简中）产品线
HEADERS = {
    "User-Agent": "ptcg-pricetool/0.1 (local card price tool)",
    "Accept": "application/json",
}


class KyoError(RuntimeError):
    pass


def to_price(v):
    """接口价格字段混用数字/字符串/null，统一成 float 或 None。"""
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if f > 0 else None


# ---- 人民币口径（2026-09 抽样 14 张卡 ¥23~¥1630 实测：detail = list × 5.249 恒定）----
# 判定：detail（price/single 的 jihuansheMarketPrice）为集换社人民币原价，
# list（card-queries 的同名字段）为 Kyo 展示币种（新加坡站，SGD/CNY≈5.25）。
# 2026-09-21 用户用集换社 App 验证：30thC-137 喷火龙实际行情 ¥435，
# 与 detail 409.30 同侧（缓存时间差），口径确认无误。
# 未精修的卡按恒定比率折算；若日后发现口径有变，
# 把 LIST_IS_CNY 改为 True 即可全局翻转，无需重同步。
LIST_IS_CNY = False
LIST_TO_CNY = 5.249


def cny_price(info):
    """价格条目 → 人民币价（detail 优先，未精修按比率折算）。

    部分弹（如 CSV3C/宝石包）集换社字段为空、只有 marketPrice（与
    jihuansheMarketPrice 同币种的 Kyo 行情），作为折算回退。
    """
    if not info:
        return None
    if LIST_IS_CNY:
        return to_price(info.get("listPrice")) or to_price(info.get("marketPrice"))
    d = to_price(info.get("detailPrice"))
    if d is not None:
        return d
    lp = to_price(info.get("listPrice")) or to_price(info.get("marketPrice"))
    if lp is None:
        return None
    return round(lp * LIST_TO_CNY, 2)


class KyoClient:
    def __init__(self, min_interval: float = 0.6, timeout: int = 30, retries: int = 3):
        self.session = requests.Session()
        self.session.headers.update(HEADERS)
        self.min_interval = min_interval
        self.timeout = timeout
        self.retries = retries
        self._last = 0.0
        self.request_count = 0  # 实际发出的 HTTP 次数（含重试），供 sync 做预算控制

    def _get(self, path: str, params: dict):
        last_exc = None
        for i in range(self.retries):
            wait = self.min_interval - (time.monotonic() - self._last)
            if wait > 0:
                time.sleep(wait)
            self._last = time.monotonic()
            try:
                r = self.session.get(f"{BASE}/{path}", params=params, timeout=self.timeout)
                self.request_count += 1
                if r.status_code == 404:
                    return None
                r.raise_for_status()
                return r.json()
            except Exception as e:  # noqa: BLE001 - 网络重试
                last_exc = e
                time.sleep(1.5 * (i + 1))
        raise KyoError(f"请求 {path} 失败: {last_exc}")

    def _paged(self, path: str, params: dict, page_size: int = 100) -> list:
        items, skip = [], 0
        while True:
            p = dict(params, skip=skip, take=page_size)
            body = self._get(path, p)
            data = body.get("data") if isinstance(body, dict) else body
            if not data:
                break
            items.extend(data)
            skip += len(data)
            total = body.get("totalRecords") if isinstance(body, dict) else None
            if total is not None and skip >= int(total):
                break
        return items

    def list_sets(self) -> list:
        """全部弹（跨产品线），客户端过滤 PKCN。"""
        return [s for s in self._paged("sets", {}, page_size=500)
                if s.get("productLineCode") == PRODUCT_LINE]

    def search_cards(self, term: str) -> list:
        """按关键词搜简中单卡（search 匹配卡名/弹名子串）。

        已知怪癖：宝石包等弹在 productType=SING 过滤下返回空（不带该参数才有
        数据，含 SING 与 SLAB 分级卡），故空结果时自动去掉该参数重试；
        SLAB 条目由 matcher.pick_best_cards 丢弃。
        """
        params = {"productLine": PRODUCT_LINE, "productType": "SING", "search": term}
        items = self._paged("card-queries", params)
        if not items:
            params.pop("productType")
            items = self._paged("card-queries", params)
        return items

    def price_single(self, card_id: str) -> dict:
        """单卡详情，返回 data.metadata.card（含 jihuansheProductId / 更细价格字段）。"""
        body = self._get(f"cards/{card_id}/price/single", {})
        try:
            return body["data"]["metadata"]["card"] or {}
        except (KeyError, TypeError):
            return {}
