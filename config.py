# -*- coding: utf-8 -*-
"""抽卡规格与概率划档配置。

包规格依据官方发售公告（pokemon.cn）与神奇宝贝百科整理：
- 太阳&月亮 / 剑&盾 主弹：5张装（必出1闪）+ 25张装（5闪）
- 朱&紫 主弹 / 专题包 / 收集啦151：5张装（瘦包，4平+1闪）+ 20张装（肥包，6闪）
- 太晶盛聚（特殊弹）：10张装 —— 7平+3闪 或 6平+4闪
- 宝石包 VOL.1-6：4张装全闪 —— 3张普通稀有度闪卡 + 1张 R 及以上闪卡
- 对战派对 王者奖赏包：1张装（高稀有度闪卡）
- 对战派对 王者奖赏包：1张装（高稀有度闪卡）
- 嗨皮系列 / 大师战略卡组 / 起始卡组 / 专题包 / 礼盒·套装 / 特典卡等：
  无公开随机包规格，不开放拆卡（保留卡表浏览与分类）

官方未公布每张卡的精确出货率，平卡/闪卡内部各稀有度概率为划档模型，
可在下方权重与 SET_SPEC_OVERRIDES 中调整，页面「概率公示」全程透明。
"""

# 平卡槽位（普通/非普通之间分配）
NORMAL_WEIGHTS = {"C": 65, "U": 35}

# 闪卡槽位（R 及以上；按弹内实际存在的稀有度归一化）
HOLO_WEIGHTS = {"R": 70, "RR": 15, "AR": 5, "SR": 4.5, "SAR": 4, "ACE": 1, "UR": 0.5}

# 各弹槽位概率覆盖表（示例）：
# SET_SPEC_OVERRIDES = {
#     "CSV9.5C": {  # 太晶盛聚：覆盖 10张装 A 变体闪卡权重
#         ("10", "闪卡 8"): {"R": 60, "RR": 22, "SR": 7, "SAR": 7, "ACE": 2.5, "UR": 1.5},
#     },
# }
SET_SPEC_OVERRIDES = {}


def _slots(kind: str, n: int, weights: dict, prefix: str) -> list:
    return [{"name": f"{prefix} {i + 1}", "kind": kind, "weights": dict(weights)}
            for i in range(n)]


def _normal(n: int) -> list:
    return _slots("normal", n, NORMAL_WEIGHTS, "平卡")


def _holo(n: int) -> list:
    return _slots("holo", n, HOLO_WEIGHTS, "闪卡")


# ---------------------------------------------------------------- 包规格
SPECS = {
    "sm5": {
        "id": "5", "label": "5张装", "short": "5张",
        "note": "4张平卡 + 1张闪卡（必出闪卡）", "price": "10元/包", "priceCny": 10,
        "slots": _normal(4) + _holo(1),
    },
    "sm25": {
        "id": "25", "label": "25张装", "short": "25张",
        "note": "20张平卡 + 5张闪卡", "price": "50元/包", "priceCny": 50,
        "slots": _normal(20) + _holo(5),
    },
    "sv5": {
        "id": "5", "label": "5张装（瘦包）", "short": "5张",
        "note": "4张平卡 + 1张闪卡", "price": "10元/包", "priceCny": 10,
        "slots": _normal(4) + _holo(1),
    },
    "sv20": {
        "id": "20", "label": "20张装（肥包）", "short": "20张",
        "note": "14张平卡 + 6张闪卡", "price": "50元/包", "priceCny": 50,
        "slots": _normal(14) + _holo(6),
    },
    "tera10": {
        "id": "10", "label": "10张装", "short": "10张",
        "note": "7张平卡+3张闪卡 或 6张平卡+4张闪卡", "price": "30元/包", "priceCny": 30,
        "variants": [
            {"note": "7平 + 3闪", "slots": _normal(7) + _holo(3)},
            {"note": "6平 + 4闪", "slots": _normal(6) + _holo(4)},
        ],
    },
    "gem4": {
        "id": "4", "label": "4张装（全闪）", "short": "4张",
        "note": "每包4张均为闪卡：3张●/◆ + 1张★及以上（●=普通 ◆=非普通 ★=稀有）", "price": "10元/包", "priceCny": 10,
        "slots": (
            _slots("holo", 3, NORMAL_WEIGHTS, "闪卡（普通稀有度）")
            + _slots("holo", 1, HOLO_WEIGHTS, "闪卡（高稀有度）")
        ),
    },
    "reward1": {
        "id": "1", "label": "奖赏包（1张）", "short": "1张",
        "note": "每包1张高稀有度闪卡", "price": "未计价", "priceCny": None,
        "slots": _slots("holo", 1, HOLO_WEIGHTS, "闪卡"),
    },
}

# ---------------- 商品线分组（界面分类）与拆卡范围 ----------------
# 仅“有公开随机包规格”的商品开放拆卡；其余只保留分类与卡表浏览。
GROUP_ORDER = ["补充包", "收集啦151", "宝石包", "嗨皮系列", "对战派对",
               "大师战略卡组", "起始卡组", "专题包", "礼盒·套装", "特典卡"]

# 剑&盾 补充包（官方：5张装 + 25张装）
_CS_MAIN = {
    "CS1AC", "CS1BC", "CS1.5C", "CS2AC", "CS2BC", "CS2.5C",
    "CS3AC", "CS3BC", "CS3.5C", "CS4AC", "CS4BC", "CS4.5C",
    "CS5AC", "CS5BC", "CS5.5C", "CS6AC", "CS6BC", "CS6.5C",
}
# 朱&紫 补充包
_CSV_MAIN = {f"CSV{i}C" for i in range(1, 11)}
# 收集啦151 四弹（旅/望/惊/聚，同一卡表的再版弹；单独成系列分组）
_SPLIT_151 = {"151C-LV", "151C-WANG", "151C-JING", "151C-JU"}
# 太阳&月亮 补充包（5张装 + 25张装）
_CSM_MAIN = {"CSM1AC", "CSM1BC", "CSM1CC", "CSM1.5C", "CSM2AC", "CSM2BC", "CSM2CC", "CSM2.5C"}
# 对战派对（盒装/组合/改造包，固定内容）
_PARTY_BOX = {"CSVE1C", "CSVE2C"} | {f"CSMP{c}C" for c in "ABCDEFGHI"}
# 大师战略卡组构筑套装（固定卡组）
_MASTER_DECKS = {"CSVM1AC", "CSVM1BC", "CSVM1CC", "CSVM2AC", "CSVM2BC", "CSVM2CC"}
# 专题包
_THEME = {"CSVL1C", "CSVL2C", "CSVNC", "CS2.1C"}
# 特典卡
_PROMO = {"MP", "PROMO"}


def product_group(code: str):
    """返回 (商品线分组名, 是否开放拆卡)。"""
    c = (code or "").upper()
    if c == "CSV9.5C":
        return ("补充包", True)          # 太晶盛聚：10张装
    if c in _SPLIT_151:
        return ("收集啦151", True)       # 旅/望/惊/聚：5/20张装
    if c in _CSV_MAIN:
        return ("补充包", True)          # 朱&紫补充包：5/20张装
    if c in _CS_MAIN:
        return ("补充包", True)          # 剑&盾补充包：5/25张装
    if c in _CSM_MAIN:
        return ("补充包", True)          # 太阳&月亮补充包：5/25张装
    if c.startswith("CBB"):
        return ("宝石包", True)          # 4张装全闪
    if c in ("CSVE1PC", "CSVE2PC"):
        return ("对战派对", True)        # 王者奖赏包：1张装
    if c.startswith("CSVH"):
        return ("嗨皮系列", False)
    if c in _PARTY_BOX:
        return ("对战派对", False)
    if c in _MASTER_DECKS:
        return ("大师战略卡组", False)
    if c.endswith("DC") or c == "CS4DAC":
        return ("起始卡组", False)
    if c in _THEME:
        return ("专题包", False)
    if c in _PROMO:
        return ("特典卡", False)
    if c.startswith(("CS", "CBB", "CSV", "151", "MP")):
        return ("礼盒·套装", False)
    return ("特典卡", False)


FAMILY_SPECS = {
    "sm_main": ["sm5", "sm25"],
    "cs_main": ["sm5", "sm25"],
    "sv_main": ["sv5", "sv20"],
    "tera_fes": ["tera10"],
    "gem_pack": ["gem4"],
    "reward_pack": ["reward1"],
}


def family_of(set_code: str, set_name: str = ""):
    """规格族；无公开随机包规格时返回 None（不开放拆卡）。"""
    code = (set_code or "").upper()
    if code == "CSV9.5C":
        return "tera_fes"
    if code in _CSV_MAIN or code in _SPLIT_151:
        return "sv_main"
    if code in _CS_MAIN:
        return "cs_main"
    if code in _CSM_MAIN:
        return "sm_main"
    if code.startswith("CBB"):
        return "gem_pack"
    if code in ("CSVE1PC", "CSVE2PC"):
        return "reward_pack"
    return None


def set_specs(set_code: str, set_name: str = "") -> list:
    """某弹可用的包规格列表；无公开随机包规格的商品返回空列表。"""
    fam = family_of(set_code, set_name)
    if fam is None:
        return []
    return [dict(SPECS[k], key=k) for k in FAMILY_SPECS[fam]]


# 宝石包等商品的符号稀有度 → 标准稀有度（仅用于卡池归类与概率计算）
RARITY_ALIAS = {
    "●": "C", "○": "C",
    "◆": "U", "◇": "U",
    "★": "R", "★★": "RR", "★★★": "SAR",
}
