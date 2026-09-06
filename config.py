# -*- coding: utf-8 -*-
"""抽卡规格与概率划档配置。

包规格依据官方发售公告（pokemon.cn）与神奇宝贝百科整理：
- 太阳&月亮 / 剑&盾 主弹：5张装（必出1闪）+ 25张装（5闪）
- 朱&紫 主弹 / 专题包 / 收集啦151：5张装（瘦包，4平+1闪）+ 20张装（肥包，6闪）
- 太晶盛聚（特殊弹）：10张装 —— 7平+3闪 或 6平+4闪
- 宝石包 VOL.1-6：4张装全闪 —— 3张普通稀有度闪卡 + 1张 R 及以上闪卡
- 对战派对 王者奖赏包：1张装（高稀有度闪卡）
- 对战派对组合（太阳&月亮）：20张装卡包（封入比例参考同时代产品）
- 其余礼盒/套装类：无随机补充包规格，按 5张装（参考）模拟

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
        "note": "4张平卡 + 1张闪卡（必出闪卡）", "price": "10元/包",
        "slots": _normal(4) + _holo(1),
    },
    "sm25": {
        "id": "25", "label": "25张装", "short": "25张",
        "note": "20张平卡 + 5张闪卡", "price": None,
        "slots": _normal(20) + _holo(5),
    },
    "sv5": {
        "id": "5", "label": "5张装（瘦包）", "short": "5张",
        "note": "4张平卡 + 1张闪卡", "price": "10元/包",
        "slots": _normal(4) + _holo(1),
    },
    "sv20": {
        "id": "20", "label": "20张装（肥包）", "short": "20张",
        "note": "14张平卡 + 6张闪卡", "price": "50元/包",
        "slots": _normal(14) + _holo(6),
    },
    "tera10": {
        "id": "10", "label": "10张装", "short": "10张",
        "note": "7张平卡+3张闪卡 或 6张平卡+4张闪卡", "price": "30元/包",
        "variants": [
            {"note": "7平 + 3闪", "slots": _normal(7) + _holo(3)},
            {"note": "6平 + 4闪", "slots": _normal(6) + _holo(4)},
        ],
    },
    "gem4": {
        "id": "4", "label": "4张装（全闪）", "short": "4张",
        "note": "每包4张均为闪卡：3张●/◆ + 1张★及以上（●=普通 ◆=非普通 ★=稀有）", "price": None,
        "slots": (
            _slots("holo", 3, NORMAL_WEIGHTS, "闪卡（普通稀有度）")
            + _slots("holo", 1, HOLO_WEIGHTS, "闪卡（高稀有度）")
        ),
    },
    "reward1": {
        "id": "1", "label": "奖赏包（1张）", "short": "1张",
        "note": "每包1张高稀有度闪卡", "price": None,
        "slots": _slots("holo", 1, HOLO_WEIGHTS, "闪卡"),
    },
    "party20": {
        "id": "20", "label": "20张装卡包", "short": "20张",
        "note": "16张平卡 + 4张闪卡（封入比例参考同时代产品）", "price": None,
        "slots": _normal(16) + _holo(4),
    },
    "generic5": {
        "id": "5", "label": "5张装（参考）", "short": "5张",
        "note": "该商品无公开随机包规格，按4平+1闪模拟参考", "price": None,
        "slots": _normal(4) + _holo(1),
    },
}

# 每族默认按钮顺序中第一个为默认规格
FAMILY_SPECS = {
    "sm_main": ["sm5", "sm25"],
    "cs_main": ["sm5", "sm25"],
    "sv_main": ["sv5", "sv20"],
    "tera_fes": ["tera10"],
    "gem_pack": ["gem4"],
    "reward_pack": ["reward1"],
    "party20": ["party20"],
    "generic": ["generic5"],
}

# 对战派对组合（太阳&月亮时代的 20张卡组包）
_PARTY20_CODES = {f"CSMP{c}C" for c in "ABCDEFGH"}

# 剑&盾 主弹（官方公告：5张装 + 25张装）
_CS_MAIN = {
    "CS1AC", "CS1BC", "CS1.5C", "CS2AC", "CS2BC", "CS2.5C",
    "CS3AC", "CS3BC", "CS3.5C", "CS4AC", "CS4BC", "CS4.5C",
    "CS5AC", "CS5BC", "CS5.5C", "CS6AC", "CS6BC", "CS6.5C",
}
# 朱&紫 主弹 + 收集啦151（5张装瘦包 + 20张装肥包）
_CSV_MAIN = {f"CSV{i}C" for i in range(1, 11)} | {"151C"}
# 太阳&月亮 主弹（5张装 + 25张装）
_CSM_MAIN = {"CSM1AC", "CSM1BC", "CSM1CC", "CSM1.5C", "CSM2AC", "CSM2BC", "CSM2CC", "CSM2.5C"}


def family_of(set_code: str, set_name: str = "") -> str:
    code = (set_code or "").upper()
    if code in _PARTY20_CODES:
        return "party20"
    if code in ("CSVE1PC", "CSVE2PC"):
        return "reward_pack"
    if code == "CSV9.5C":
        return "tera_fes"
    if code in _CS_MAIN:
        return "cs_main"
    if code in _CSV_MAIN:
        return "sv_main"
    if code in _CSM_MAIN:
        return "sm_main"
    if code.startswith("CBB"):
        return "gem_pack"
    return "generic"


def set_specs(set_code: str, set_name: str = "") -> list:
    """某弹可用的包规格列表（已按官方发售信息映射）。"""
    fam = family_of(set_code, set_name)
    return [dict(SPECS[k], key=k) for k in FAMILY_SPECS[fam]]


# 宝石包等商品的符号稀有度 → 标准稀有度（仅用于卡池归类与概率计算）
RARITY_ALIAS = {
    "●": "C", "○": "C",
    "◆": "U", "◇": "U",
    "★": "R", "★★": "RR", "★★★": "SAR",
}


def set_specs(set_code: str, set_name: str = "") -> list:
    """某弹可用的包规格列表（已按官方发售信息映射）。"""
    fam = family_of(set_code, set_name)
    return [dict(SPECS[k], key=k) for k in FAMILY_SPECS[fam]]


# 稀有度展示元数据（颜色/名称供前端与后端共用）
RARITY_META = {
    "C":   {"label": "普通 C",     "color": "#9aa5b1"},
    "U":   {"label": "非普通 U",   "color": "#58c470"},
    "R":   {"label": "稀有 R",     "color": "#4aa8ff"},
    "RR":  {"label": "双稀有 RR",  "color": "#ffd75e"},
    "AR":  {"label": "艺术稀有 AR","color": "#7ee8fa"},
    "SR":  {"label": "超级稀有 SR","color": "#ff7edb"},
    "SAR": {"label": "特艺术 SAR", "color": "#b28dff"},
    "UR":  {"label": "究极稀有 UR","color": "#ffc82e"},
    "ACE": {"label": "ACE SPEC",   "color": "#8f7bff"},
    "TR":  {"label": "双星 TR",    "color": "#f6a5c0"},
}

# 系列分组
SERIES_GROUP = {
    "Mega": "超级进化系列",
    "Scarlet & Violet": "朱&紫 系列",
    "Sword & Shield": "剑&盾 系列",
    "Sun & Moon": "太阳&月亮 系列",
    "30th": "30周年庆典",
}
