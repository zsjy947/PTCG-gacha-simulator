# 冻结契约（R1–R9）

> 基线：`dev` @ b4b080b。重构全程本文件不可变；阶段 3 审查按本文件逐项核对，
> 阶段 4 动态测试按本文件逐项断言。任何与契约冲突的改动一律打回。

## R1 · 17 个 HTTP 路由

路径、方法、JSON 形状、错误码与 `{"error":...}` 文案**逐字不变**：

| # | 路由 | 方法 | 成功形状 | 错误（文案逐字） |
|---|---|---|---|---|
| 1 | `/` | GET | index.html | — |
| 2 | `/static/gacha.js` | GET | shared/gacha.js（max_age=3600） | — |
| 3 | `/api/sets` | GET | `{"groups":[{group,sets}]}` | 503 `本地暂无弹数据，请先运行 python fetch_data.py` |
| 4 | `/api/sets/<id>/cards` | GET | `{"count":n,"cards":[...]}`（含 image 字段） | 400 `非法弹代码`；404 `弹 {id} 的卡牌数据不存在，请先运行 python fetch_data.py` |
| 5 | `/api/sets/<id>/probabilities` | GET | `{"specs":[...]}` | 400 `非法弹代码`；404 同上 |
| 6 | `/api/draw` | POST | `{"mode":"pack","spec":...,"packs":[[...]]}` | 400 `非法弹代码`；400 `该商品无公开随机包规格，未开放拆卡（可浏览卡表）`；404 弹/规格错误文案；packs 钳制 `max(1, min(int(packs or 1), 40))` |
| 7 | `/api/card/<set>/<idx>` | GET | mik 详情 JSON 原样 | 400 `非法参数`；502 `获取失败` |
| 8 | `/img/<code>/<idx>` | GET | png（max_age=86400） | 400 `非法参数`；404 `图片获取失败` |
| 9 | `/thumb/<code>/<idx>` | GET | webp（缺 Pillow/原图缺失时回退 png） | 400 `非法参数`；404 `图片获取失败` |
| 10 | `/icon/<code>` | GET | png | 400 `非法参数`；404 `无图标` |
| 11 | `/api/health` | GET | `{"ok":true,"time":<float>}` | — |
| 12 | `/api/version` | GET | `{"version":APP_VERSION}` | — |
| 13 | `/api/data-manifest` | GET | manifest.json 原文 | 缺文件时 `{"sets": {}}` |
| 14 | `/api/prices` | GET | prices/index.json 原文 | 缺快照时 `{"generated": null, "count": 0, "prices": {}}` |
| 15 | `/api/store/get` | GET | `{"rev":<int>,"data":{…}}`（信封含版本号，缺文件时 `{"rev":0,"data":{}}`） | — |
| 16 | `/api/store/set` | POST | `{"success":true,"skipped":<bool>,"rev":<int>}`（rev ≤ 已存 rev 时跳过） | 400 `非法参数`（data 非 dict）；500 `写入失败：{e}` |
| 17 | `/api/cache/info` · `/api/cache/clear` | GET · POST | `{"total_bytes","label"}` · `{"ok":true}` | — |

路径校验正则 `_SAFE = ^(?!\.\.?$)[A-Za-z0-9._\-]{1,40}$`（整体拒绝 "." / ".."，PTCG-R3-01）；`/img` `/thumb` `/icon` 先 `_strip_ext`。

## R2 · localStorage 键

`ptcg_theme` / `ptcg_stats` / `ptcg_coll` / `ptcg_history` / `ptcg_spend` / `ptcg_spend_enabled` /
`ptcg_autoflip` / `ptcg_datasrc` / `ptcg_data_applied` + `datacard_*`（热更新卡表，键不带 ptcg_ 前缀、不镜像磁盘）。
磁盘镜像协议：仅 `ptcg_` 前缀键、只补缺失键不覆盖、`/api/store/set` 整包 `{"data": {...}, "rev": n}`
（rev 为客户端递增版本号，旧快照乱序后到被服务端跳过，F24/PTCG-R2-02）。

## R3 · window 契约

- `__imgFail(img)`：内联 onerror 依赖，全局函数必须存在；
- `__ASSET_MODE__` / `__ASSET_BASE__`：APK 资产模式标记（build_assets.py 注入）；
- `PTCGNative`：安卓 JS 桥（saveStore/loadStore/saveImage/setSystemBars/cacheSize/clearCache）；
- `PTCGGacha`：shared/gacha.js 导出（**shared/gacha.js 一行不改**）。

## R4 · 时序链常量（值不变，仅命名化）

| 常量 | 值 |
|---|---|
| BURST_TO_CARDS_MS | 480（burst→showCards） |
| STAGGER_FAST / STAGGER_SLOW | `min(36, floor(600/len))` / `min(90, floor(1200/len))` |
| AUTOFLIP_EXTRA_MS | 420（auto-flip 补偿） |
| FLIP_GAP_FAST / FLIP_GAP_SLOW | 22 / 60（flip 间隔） |
| RARITY_BURST_MS | 1100（稀有度爆闪） |
| IMG_RETRY_MS | 800 / 2000（图片重试两档） |
| AGAIN_DELAY_MS | 250（再来一次） |
| DATASRC_TIMEOUT_MS | 8000（数据源超时） |
| UPDATE_TIMEOUT_MS | 5000（更新检查） |
| HISTORY_LIMIT | 30（历史上限） |
| PAGE_WINDOW | 7（翻页窗口） |
| RENDER_CHUNK | 120（卡表增量渲染） |

## R5 · CSS

全部动画参数不动：packIn / shake / burst / deal / flip（`.6s cubic-bezier(.3,1.3,.4,1)`）/ holyGlow /
rb（rarity-burst 1s）等；`[hidden]{display:none!important}` 修复模式及其元素级覆写
（`.spec-drop[hidden]` 等）不动。

## R6 · 数据键规范

`setCode__cardIndex`，卡号纯数字三位补零（"1"→"001"，非数字原样）。三处镜像保持一致：
`static/app.js normIdx` ↔ 服务端 `pricetool/store.py norm_index` ↔ 拆卡引擎卡键。

## R7 · pricetool CLI

子命令 sync/reindex/query/table/value 与参数不变；输出格式（`>>` / `!!` / `[i/n]` 前缀与输出时序）不变；
退出码 0 成功 / 2 失败 不变。

## R8 · 构建脚本

`build_exe.bat`、`android/build_assets.py`、`tools/build_miniprogram.py` 的**输入输出不变**
（产物功能等价；允许为带入拆分后的新前端文件调整 build_assets.py 的复制机制，产物清单须干跑核对）。

## R9 · 平台边界

`miniprogram/`、`android/*.java` 不改代码；`data/` 卡表与索引数据文件不增删
（`data/` 下运行时缓存目录 `img_cache/` `icon_cache/` `detail_cache/` 为产物，不算数据文件）。
