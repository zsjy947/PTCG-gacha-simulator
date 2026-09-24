# -*- coding: utf-8 -*-
"""pricetool —— PTCG 简中卡牌价格工具（独立开发阶段，不依赖也不改动现有模拟器代码）。

价格数据来自 Kyo Cards 公开接口（带集换社行情价字段 jihuansheMarketPrice），
按现有卡表唯一键 setCode__cardIndex 挂载到 data/prices/，
为下一阶段集成进模拟器统计「拆出卡总价值」铺路。

用法：
    python -m pricetool sync                 # 同步价格数据
    python -m pricetool query 喷火龙          # 单卡查价
    python -m pricetool table CSV5C           # 整弹价格表
    python -m pricetool value collection.json # 收藏册估值
"""

__version__ = "0.1.0"
