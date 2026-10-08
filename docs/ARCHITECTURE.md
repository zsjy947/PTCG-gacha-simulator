# ARCHITECTURE — 架构设计

> docs/ 仅有的两个入库文档之一（另一个为 [FEATURES.md](FEATURES.md)）。
> 本文含：系统架构、模块边界、数据契约、测试与发布体系、冻结契约（R1–R9）、
> v1.3.0 重构沉淀记录（原 `docs/refactor/` 与《重构与全量审查计划》已并入本文后移除）。

## 一、总览

三端一引擎、零后端、本地存储：

```
                    shared/gacha.js（拆卡引擎，唯一权威实现）
                      ▲            ▲             ▲
        ┌─────────────┘            │             └──────────────┐
        │                          │                            │
  Windows exe                 安卓 APK（feat/android 分支）  微信小程序
  Flask 本地服务 + 浏览器       WebView 纯资产模式（无后端）    原生 WXML（无后端）
  static/ 前端 + server/ 包    www/ 资产 + JS 桥              miniprogram/
        │                          │                            │
        └──────── gacha.py（服务端镜像实现，同种子对拍）──────────┘
```

- **零后端状态**：服务端只做只读数据 API + 图片代理；用户数据（抽卡记录/收藏册/设置）
  全部存 localStorage（`ptcg_*` 键），exe 端经 `/api/store/*` 镜像到磁盘、APK 经 JS 桥镜像。
- **同源确定性**：三端拆卡结果由同一 JS 引擎 + mulberry32 种子决定；服务端 `gacha.py`
  为镜像实现，两端同种子逐卡一致由测试守卫（`tests/test_consistency.py`）。

## 二、目录结构

```
PTCG/
├─ app.py              # 服务入口：Flask app 创建 + 装配 server/ 四模块 + 冻结路径适配
├─ gacha.py            # Python 拆卡引擎（shared/gacha.js 的镜像，服务端 /api/draw 用）
├─ config.py           # 概率划档权重、包规格 SPECS、商品线分组、规格族解析（四节归组）
├─ version.py          # 版本号唯一源（APP_VERSION）；APK 构建自动同步进 Manifest
├─ shared/gacha.js     # 拆卡引擎（exe / APK / 小程序三端共用；冻结契约 R3：一行不改）
├─ server/             # 后端包：api.py / media.py / store.py / httpcache.py / paths.py
├─ static/             # 前端 10 模块（core / data / store / prices / ui-* / app / style）
├─ miniprogram/        # 微信小程序源码（tools/build_miniprogram.py 生成 data/ 与卡背）
├─ android/            # APK 打包（build_assets.py 资产打包 / build_apk.py 薄入口 + pack.toml，流水线在共享工具链 android-pack）
├─ pricetool/          # 卡价同步 CLI（sync/reindex/query/table/value）
├─ fetch_data.py       # mik.moe 卡表同步 → data/cards/*.json + manifest.json
├─ tools/              # dev_server / build_miniprogram / baseline_perf / verify_data
├─ tests/              # 单元测试 + 对拍 + golden 快照 + 边界矩阵
├─ data/               # sets_index.json / manifest.json / cards/ / prices/index.json（+运行时缓存目录）
└─ docs/               # 仅 FEATURES.md 与 ARCHITECTURE.md 入库（见「文档规范」）
```

## 三、拆卡引擎与概率模型

### 引擎（shared/gacha.js，冻结契约 R3）
导出面：`mulberry32(seed)`（种子随机数）、`buildPools(cards)`（按稀有度分池）、
`drawPack / drawPacks`（按规格抽包，规格含封入变体时每包随机落位、包内去重）、
`specProbabilities(spec, pools)`（概率公示数据）、`expectedCost(spec, pools)`
（单卡期望：`anyPacks = 1/pPack`，`cardPacks ≈ anyPacks × 池大小`）、
`rarityProfile / boxProfile`（单包/整盒稀有度画像：期望张数与出现率，确定性无随机数，
v1.3.x）、`collectExpectation`（集齐期望：稀有度级闭式 `n·H_n/λ` 或卡集合固定种子
蒙特卡洛，v1.3.x）、`collectSimBatched`（上者的分批等价形态，前端分批执行防阻塞，
`test_consistency.py` 锁定分批跑完与全量同参结果完全相等）。
引入方式：exe 经 `/static/gacha.js` 同源分发；APK 内嵌资产；小程序 CommonJS 引入。

### 概率模型（config.py，划档免责）
官方未公布单卡出货率，槽位内稀有度分配为**划档模型**，页面全程公示：
- `NORMAL_WEIGHTS`（平卡位 C/U = 65/35）、`HOLO_WEIGHTS`（闪卡位 R+ 全档位权重，
  弹内不存在的稀有度归一化自动剔除——其余档位概率不变，且保证收藏 100% 可达）；
- 30 周年弹专用 `FEST30_WEIGHTS` / `FEST30_SPECIAL_WEIGHTS`；
- `SET_SPEC_OVERRIDES`：按 (弹, 规格, 槽位) 覆盖权重；
- `SPECS`：各包规格（槽位构成、价格 priceCny、整盒包数 boxPacks）；
- `product_group / family_of / set_specs`：弹代码 → 商品线分组与可用规格；
- `RARITY_ALIAS`：符号稀有度（●◆★）→ 标准稀有度，仅用于概率归类；
- `SET_BOX_PACKS`：按弹覆盖整盒包数（如宝石包 Vol.1 为 15 包/盒）。

## 四、服务端（exe 端）

- `app.py`：入口。创建 Flask app、`register()` 装配 server/ 模块、`_free_port` 回退、
  pywebview / 浏览器拉起、PyInstaller 冻结路径适配。
- `server/paths.py`：数据目录解析（开发/冻结双模式）与可写性保障；`_SAFE` 路径校验
  （`^(?!\.\.?$)[A-Za-z0-9._\-]{1,40}$`，拒绝 `.`/`..`）。
- `server/api.py`：`/api/*` 只读与数据路由（sets / cards / probabilities / draw / card
  详情代理 / version / data-manifest / prices / health）。`/api/draw` 的 packs 钳制
  `max(1, min(int(packs or 1), 40))`，非法类型 → 400。
- `server/media.py`：`/img` `/thumb` `/icon` 图片代理，磁盘缓存（`data/img_cache/`、
  `icon_cache/`），webp 缩略图（缺 Pillow 回退原图）。
- `server/httpcache.py`：出站限流（60s 窗口 900 次）、LRU 磁盘缓存淘汰（默认 600MB，
  `PTCG_IMG_CACHE_MB` 可调，节流扫描 + 0.9 水位淘汰）、详情缓存原子写、按文件锁。
- `server/store.py`：`/api/store/get|set` 磁盘镜像。协议：只收 `ptcg_*` 键、只补缺失键、
  `rev` 单调递增（旧快照乱序后到被跳过），原子写 + 进程锁。

完整 17 路由表（路径、方法、成功形状、错误码与文案）见冻结契约 R1。

## 五、前端（static/，classic script 按序加载，无模块系统/框架/打包器）

加载顺序（index.html 固定）：`core.js`（常量/全局 state/工具/API·URL/`__imgFail`/
本地引擎入口）→ `data.js`（数据访问层，服务/资产双模式 + 卡表热更新）→
`store.js`（持久化镜像 + 统计/消费/收藏册）→ `prices.js`（卡价快照/卡值/回本）→
`ui-sets.js`（弹列表）→ `ui-draw.js`（开包时序链）→ `ui-collection.js`（收藏册）→
`ui-cardlist.js`（卡表）→ `ui-modals.js`（概率/详情/期望/战报弹窗）→
`app.js`（装配/主题/更新检查/启动 IIFE）。

- **window 契约（R3）**：`__imgFail(img)`（内联 onerror 依赖）、`__ASSET_MODE__` /
  `__ASSET_BASE__`（APK 资产标记）、`PTCGNative`（安卓桥：saveStore/loadStore/saveImage/
  setSystemBars/cacheSize/clearCache）、`PTCGGacha`（引擎导出）。
- **时序常量（R4，值冻结）**：burst→showCards 480ms；翻卡间隔 22/60ms；自动翻卡补偿
  420ms；稀有度爆闪 1100ms；图片重试 800/2000ms；再来一次 250ms；历史上限 30；
  翻页窗口 7；卡表增量渲染 120 张/批。CSS 动画参数（flip `.6s cubic-bezier(.3,1.3,.4,1)` 等）冻结。
- **存储键（R2）**：`ptcg_theme / stats / coll / history / spend / spend_enabled /
  autoflip / datasrc / data_applied`；`datacard_*`（热更新卡表）与 `imgcache_<set>`
  （按弹预缓存标记：日期/张数/是否含原图）不带前缀、不镜像磁盘。
  新增持久化键必须 `ptcg_` 前缀并经 `store.js` 封装。

## 六、数据管线

- **卡表**：`fetch_data.py` 从 mik.moe 同步 → `data/cards/<弹>.json`（134 弹）+
  `sets_index.json` + `manifest.json`（各弹 md5）。前端热更新：内置数据指纹 +
  `ptcg_data_applied` 为基线，只下载有差异的弹（`datacard_*` 键落地），可一键恢复内置。
- **卡价**：`pricetool sync`（源站 Kyo Cards/集换社，人民币口径，`--min-cny` 阈值过滤）
  → `data/prices/index.json` 快照 → `/api/prices`。GitHub Actions 每周一 03:00（北京
  时间）自动跑 sync 提交 master；客户端启动静默检查（jsDelivr/raw）并热应用。
- **卡图**：mik.moe 图源。exe 经 `/img`·`/thumb` 代理 + 磁盘 LRU；APK WebView 直连 +
  原生缓存（500MB 最旧淘汰）；小程序 `<image>` 组件直连。

## 七、平台端

- **exe**：`build_exe.bat` → PyInstaller（入口 app.py，自动分析 server/ 本地导入）。
  运行时数据缓存在 `%LOCALAPPDATA%\PTCGGacha`。
- **APK**：`android/build_assets.py` 按 index.html 引用清单把前端 + 内嵌数据打包为
  WebView 资产（注入 `__ASSET_MODE__`、版本号）；构建流水线（aapt2 → javac → d8 →
  zipalign → apksigner）由共享工具链 **android-pack（apx）** 执行——`android/pack.toml`
  配置、`android/build_apk.py` 薄入口，与 game-ledger 共用同一条链（工具链发现：
  `JAVA_HOME`/`ANDROID_HOME` 系统级优先，回退项目 `.android-build/` 与 `D:\Tools`
  惯例位置；SDK 升级规程见 android-pack README）。版本经 aapt2 link 传参注入并经
  badging 守卫校验（不改写 Manifest 源文件）；签名密钥 `android/gacha.keystore`
  本地生成、永不入库（`.gitignore` 排除），口令在 `android/keystore.properties` 或
  `PTCG_KEYSTORE_PASS`；更换密钥后旧 APK 需卸载重装。
- **小程序**：`tools/build_miniprogram.py` 把 `data/` 裁剪为最小字段内嵌 `cards.js`
  （~1MB，主包 2MB 限制内）；拆卡引擎 CommonJS 引入；图源 `<image>` 直连不占域名白名单。
  上线清单见 archived/miniapp 分支 `docs/MINIPROGRAM-LAUNCH.md`（仅该分支追踪，暂停开发）。

## 八、测试与 CI

| 文件 | 职责 |
| --- | --- |
| `tests/test_engine.py` | 引擎单测：同种子对拍（Python↔Node：`parity_node.js` / `parity_profile.js` / `parity_collect.js` / `parity_collect_batched.js`）、统计落位、包内去重、集齐期望闭式↔模拟互验、rarityProfile 统计性收敛断言（固定种子，15% 相对界 + 噪声下限） |
| `tests/test_consistency.py` | 跨实现一致性：稀有度色板、normIdx 三镜像、atomic_write/_md5 双实现、GROUP_ORDER 前端副本、spec_brief 三平台等价 |
| `tests/test_api_golden.py` | Flask test_client 对确定性端点做 JSON 快照断言（`tests/golden/`） |
| `tests/test_edge_matrix.py` | 边界异常矩阵：非法 set id、packs 边界、非法 store 体、缺文件、详情未命中——错误码与文案逐字断言 |
| `tests/test_rarity_reach.py` | 稀有度可达性守卫：全弹全稀有度理论可达（收藏 100% 红线） |
| `tests/test_missing_list.py` | 缺卡清单文本纯函数对拍（Python 镜像实现）：空缺卡 / 全缺 / >60 张分页标注 |
| `pricetool/tests/` | pricetool 单测（31 项） |

CI（`.github/workflows/ci.yml`）：全分支 push/PR → `python -m unittest discover -s tests`
+ `python -m unittest discover -s pricetool/tests`（Python 3.11 + Node 20）。
另有数据自动同步 workflow（卡表每周）与卡价自动同步 workflow（卡价每周一）。

本地验证命令：`python -m pytest tests/ -q`（或 `python -m unittest discover -s tests -v`）；
引擎对拍需 Node ≥18。发版改 `version.py` 后建议跑 `build_exe.bat` 与
`android/build_apk.py` 双端冒烟。

## 九、冻结契约（R1–R9，改动须专项评审）

### R1 · 17 个 HTTP 路由
路径、方法、JSON 形状、错误码与 `{"error":...}` 文案不变：
`/`、`/static/gacha.js`、`/api/sets`、`/api/sets/<id>/cards`、`/api/sets/<id>/probabilities`、
`/api/draw`、`/api/card/<set>/<idx>`、`/img/<code>/<idx>`、`/thumb/<code>/<idx>`、
`/icon/<code>`、`/api/health`、`/api/version`、`/api/data-manifest`、`/api/prices`、
`/api/store/get`、`/api/store/set`、`/api/cache/info|clear`。
关键细节：`/api/draw` packs 钳制与 400 文案；`/api/store/set` rev 跳过协议；
`/api/prices` 缺快照返回 `{"generated": null, "count": 0, "prices": {}}`。

### R2 · localStorage 键
见「五、前端」。磁盘镜像协议（只补缺失键 + rev 乱序保护）不变。

### R3 · window 契约
`__imgFail` / `__ASSET_MODE__` / `PTCGNative` / `PTCGGacha`；`shared/gacha.js` 一行不改。

### R4 · 时序链常量
见「五、前端」。值冻结，仅允许命名化。

### R5 · CSS
全部动画参数与 `[hidden]{display:none!important}` 修复模式及其元素级覆写不动。

### R6 · 数据键规范
`setCode__cardIndex`，卡号纯数字三位补零（"1"→"001"，非数字原样）。三处镜像一致：
前端 `normIdx` ↔ 服务端 `pricetool norm_index` ↔ 引擎卡键（`test_consistency.py` 守卫）。

### R7 · pricetool CLI
子命令（sync/reindex/query/table/value）、参数、输出格式（`>>`/`!!`/`[i/n]` 前缀）、
退出码（0/2）不变。

### R8 · 构建脚本
`build_exe.bat`、`android/build_assets.py`、`tools/build_miniprogram.py` 输入输出不变
（产物功能等价）。`android/build_apk.py` 自 v1.3.1 后为薄入口，流水线委托共享工具链
android-pack（`<工作区>/archived/android-pack`）执行：命令、产物路径与版本守卫
（资产内嵌版本 / badging）行为不变；版本注入方式由「改写 Manifest 源文件」改为
「aapt2 link 传参 + badging 校验」，属等价实现变更（2026-10 迁移记录见 android-pack
README）。

### R9 · 平台边界
`miniprogram/` 框架代码与 `android/*.java` 谨慎对待（改动须过三端验证）；`data/` 卡表
数据文件不手改（只由 fetch_data.py 生成；运行时缓存目录除外）。

## 十、历史重构记录（v1.3.0，沉淀自 docs/refactor/*，原文件已移除）

> 背景：重构前 `static/app.js` 1749 行单文件（约 90 个全局符号）、`app.py` 586 行
> （17 路由 + 图片代理 + LRU + 限流 + 锁混杂）。重构遵循"业务逻辑绝对不变 +
> 接口完全兼容 + 修崩溃级 + 无感加固"原则，从 `refactor/code-review` 分支逐阶段
> 推进后合回 dev。

### 拆分结果
- 后端：`app.py` → `server/` 包五模块（paths/api/media/httpcache/store），函数签名不变；
  缓存路由统一 `register(app)` 装配。`fetch_data.py main()` 拆出 split_151/expand_sets/
  write_manifest；`pricetool/sync.py sync()`（205 行）拆出 6 个私有函数。
- 前端：`app.js` → 10 模块按序 classic script 加载（见「五」）；拆分前后
  `Object.getOwnPropertyNames(window)` 页面符号 0 丢失 0 新增。
- 审查结论：6 维度静态审查总分 94.2（通过线 ≥90），逻辑一致性维度 100 分
  （逐函数 diff 对照基线）；E2E 22 项场景全通过。

### 已闭环修复（摘要，ID 为原台账编号）
- **崩溃级**：`/api/draw` packs 非数字 500→400（BE-001）；文件加载补 (OSError,
  ValueError) 防御（BE-002）；cli.py 文件句柄 with-open（BE-012）；缓存 `.part` 残留
  清理（BE-013）；LRU 扫描 stat() 并发防御（BE-019）；详情缓存原子写（BE-020）；
  store 写失败 tmp 清理（BE-022）；空包守卫（FE-008）。
- **无感加固**（当前数据下渲染逐字节不变）：showDetail/筛选/色值/URL 拼接等 10+ 处
  escapeHtml（FE-009/010/011/017/018）。
- **重复逻辑收敛**：collectionTile() 模板工厂、recordPackResult()、
  rarityCounts()/renderChips()/rrUpTo()（FE-001/002/003）；_dir_size 合并（BE-003）。
- **刻意不合并的双实现**（有可执行一致性守卫）：atomic_write_json/_md5（BE-008）、
  spec_brief 三平台（BE-009）、normIdx 三镜像（BE-018）、稀有度色板三副本（FE-004）。
- **工程增强**：requirements.txt（BE-015）、CI 接入 pricetool 测试（BE-014）、
  README API 清单补全至 17 路由（BE-016）、config.py 四节归组（BE-006）。
- **v1.3.x 闭环**：FE-019（web 模式期望弹窗 `_spec_brief` 缺 slots 报错）随集齐期望
  上线修复——期望计算改经 `/api/sets/<id>/probabilities` 取全量规格视图，两模式结果一致。

### 留档保留项（有意不做，勿当缺陷重复上报）
| 项 | 理由 |
| --- | --- |
| BE-004 cache_clear 与在途下载竞态 | 修复需改锁时序（时序契约） |
| BE-005 X-Forwarded-For 可伪造 | 仅绑定 127.0.0.1，威胁模型不成立 |
| BE-017 requests Session 不关闭 | 进程级单例 |
| BE-021 LRU _lru_size=-1 初始化哨兵 | 基线行为，修复属行为变更（注释已说明协议） |
| BE-028 图片源网络异常返回 500 HTML | 改 404 属错误契约变更 |
| BE-029 锁膨胀/导入无白名单/无 CSP | CSP 与内联 onerror 契约冲突（FE-016 同源） |
| PR-002 print 而非 logging | 输出格式契约（R7） |
| FE-012 未知稀有度触发爆闪 / FE-013 style.display 混用 / FE-015 历史 30 条静默截断 | 用户可见行为，保持不变 |

### 性能基线（Flask test_client，Windows / Python 3.10）
500 次连续 `/api/draw`：~4.1–4.7ms/次；200 次 `/img` 缓存命中：~3.7–4.1ms/次；
复测阈值 1.5×。原始数据原存 `docs/refactor/baseline_perf.jsonl`（已随文档清理移除；
`tools/baseline_perf.py` 输出路径已改至 `build/baseline_perf.jsonl`，不入库）。

## 十一、文档规范

- `docs/` **入库**文档仅两个，全大写英文命名：`FEATURES.md`（功能清单）、
  `ARCHITECTURE.md`（本文，含架构设计 + 历史重构沉淀）。
- **工作文档不入库**：执行计划、临时方案等一律本地留存（如 `docs/PLAN.md`），
  不提交、不写 .gitignore（避免掩盖同类本地文档），文档头部自行注明"不入库"。
- **分支特例**：`docs/MINIPROGRAM-LAUNCH.md`（小程序上线清单，原中文名文档已改标准名）
  仅在 `archived/miniapp` 分支追踪（2026-10-02 由 `wechat-miniapp` 更名，暂停开发）；
  `dev`/`master`/`feat/android` 分支不保留。
- 历史文档处置记录：`docs/重构与全量审查计划.md` 与 `docs/refactor/`（CONTRACT/
  LEDGER/REVIEW_REPORT/TEST_REPORT 及基线数据）已检查并将修改记录沉淀进本文「十」，
  从 git 移除（2026-09）。
