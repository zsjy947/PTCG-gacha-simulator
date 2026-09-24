# pricetool —— PTCG 简中卡牌价格工具（独立开发阶段）

按现有卡表唯一键 `setCode__cardIndex` 挂载集换社行情价，为下一阶段集成进
模拟器统计「拆出卡总价值」铺路。本包完全独立，不依赖也不改动
app.py / static / miniprogram / android / config.py。

## 用法

```bash
python -m pricetool sync                    # 同步价格（TTL 6h，增量）
python -m pricetool sync --set CSV5C        # 只同步一个弹
python -m pricetool sync --refine-all       # 每张卡都拉详情价（慢，全人民币价+集换社链接）
python -m pricetool query 喷火龙             # 中文名/英文名/setCode__卡号 查价
python -m pricetool table CSV5C --csv a.csv # 整弹价格表（降序，可导出 CSV）
python -m pricetool value collection.json   # 收藏册估值（模拟器收藏导出格式）
python -m unittest discover -s pricetool/tests -t .   # 单元测试
```

## 数据源与覆盖（2026-09 实测）

集换社本体核心行情接口要求加密请求体无法直连；数据源用 **Kyo Cards**
（`kyocards.com/shopping-cards/v1`，公开 JSON），其 `jihuansheMarketPrice`
字段直接代理集换社行情，`jihuansheProductId` 与集换社 card_version_id
一致，可拼详情链接。

- **覆盖 22 弹**：朱&紫 CSV1C~CSV10C、太晶盛聚（CSV9.5C）、宝石包 VOL.1~6、
  30周年庆典、收集啦151（旅/望/惊/聚）。除 30thC（162/176）外全部 ≥99%。
- **Kyo 无价的弹**：宝石包 VOL.6（最新弹，行情未同步）、无畏太晶 CSV3C。
- **无覆盖的本地弹（110 个）**：剑盾 CS*、日月 CSM*、嗨皮 CSVH*、大师
  CSVM*aC、各类特典/奖赏包——Kyo 的 PKCN 产品线只有 23 个弹。
- 30thDC 与 OGV1-3（30周年原搭档）编号体系对不齐，未自动映射。

## 价格口径（重要）

列表接口与详情接口的 `jihuansheMarketPrice` 对同一张卡恒差 ×5.249
（¥0.1~¥1630 全区间实测），是单位换算不是估值差异：

- `detailPrice`（price/single 接口）＝ 集换社人民币价，**默认采用**；
- `listPrice`（card-queries 接口）＝ Kyo 展示币种（新加坡站，SGD），
  未精修的卡按 `kyo.LIST_TO_CNY = 5.249` 折算；
- 口径已于 2026-09-21 经集换社 App 验证（30thC-137 喷火龙实际 ¥435，
  工具显示 ¥409.30，缓存时间差内的正常偏差）；若日后发现口径有变，
  把 `kyo.LIST_IS_CNY` 改为 `True` 即可全局翻转，无需重新同步。

## 接口怪癖（都已在代码里处理）

- 搜索不支持按弹过滤参数；按弹名搜索的索引不完整（30TH A 漏喷火龙），
  缺卡按本地英文名补搜（`name_cache.json` 跨运行缓存）；
- 卡号以 `collectorNo` 为准：宝石包是 `"20 03/07"`（卡组+卡号，对应本地
  4 位连写），CSV2C 带 `"CSV2C-002/128"` 弹码前缀，151 有 `"23 05"` 变体分组；
- 宝石包在 `productType=SING` 过滤下搜不到，自动去参重试并丢弃 SLAB 分级条目；
- 限流两段式：先返回 200 空数据（软拦截，sync 会重试一次并在空结果时不落盘），
  再是 403（sync 提前中止、保留旧数据）。单次运行请控制在 ~120 个请求内
  （`--budget` 默认 120），触发 403 后等几分钟再跑。

## 数据落盘

- `data/prices/<setCode>.json`：每弹一个价格文件（listPrice/marketPrice/
  detailPrice/refined/jihuansheProductId/kyoCardId…）；
- `data/prices/manifest.json`：fetchedAt/md5 清单（增量与新鲜度判断）；
- `data/prices/name_cache.json`：英文名补搜缓存。

## 下一阶段集成（模拟器统计拆卡总价值）

价格文件按 `setCode__cardIndex` 键与收藏册（static/app.js）、拆卡引擎输出
天然对齐，模拟器侧只需读 `data/prices/` 后用 `pricetool.kyo.cny_price()`
同款口径取价求和；收藏导出格式可直接喂 `python -m pricetool value`。
