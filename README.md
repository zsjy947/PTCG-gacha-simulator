# PTCG拆卡模拟器（宝可梦卡牌 · 简中）

一个按**弹（扩展系列）**分类的简体中文宝可梦卡牌拆卡模拟器：
选择弹包 → 按该弹**官方发售规格**开包（5张瘦包 / 20张肥包 / 25张装 / 10张装 / 宝石包 4张全闪等）→
3D 翻卡看牌面（卡图从网络实时获取并缓存）。内置概率公示、收藏册与完整卡表浏览。

## 快速开始（exe，免安装）

双击 `dist\PTCG拆卡模拟器.exe` 即可 —— 程序会自动启动本地服务并打开浏览器。

- 卡表数据已内置；卡牌牌面首次显示时联网下载并缓存到 `%LOCALAPPDATA%\PTCGGacha`。
- 重新打包：修改代码后运行 `build_exe.bat`（需要 `pip install pyinstaller`）。

## 开发方式运行

```bash
# 1. 同步简中卡表数据（首次必须，约 2 分钟；--force 全量刷新）
python fetch_data.py
# 2. 启动（自动开浏览器）
python app.py
```

依赖：Python 3.10+，`flask`、`requests`、`pyinstaller`（仅打包需要）。

## 每弹的发售规格（依据官方公告自动适配）

程序按弹代码把各弹映射到商品线（见 `config.py` 的 `product_group`），
**仅补充包 / 宝石包 / 对战派对奖赏包开放拆卡**，其余商品只保留分类与卡表浏览：

| 弹族 | 代表弹 | 开包规格 |
| --- | --- | --- |
| 太阳&月亮 主弹 | 横空出世 赫/苍/泽、交相辉映、对战精英、炫奇争胜 | 5张装（必出1闪）· 25张装（5闪） |
| 剑&盾 主弹 | 极巨争锋 雷/焰 … 胜象星引 | 5张装（必出1闪）· 25张装（5闪） |
| 朱&紫 主弹 | 亘古开来 … 星彩晶璃、共逐荣光 | 5张装（瘦包，4平+1闪）· 20张装（肥包，6闪） |
| 收集啦151（四弹） | 收集啦151 旅/望/惊/聚（同一卡表的四个再版弹，各有独占插画卡） | 5张装（瘦包）· 20张装（肥包） |
| 特殊弹 | 太晶盛聚（CSV9.5C） | 10张装：7平+3闪 或 6平+4闪（每包随机） |
| 宝石包 | CBB VOL.1-6 | 4张装全闪：3张●/◆ + 1张★及以上 |
| 对战派对奖赏包 | 对战派对 耀梦/共梦 奖赏包 | 1张装（高稀有度） |
| 嗨皮系列 / 大师战略卡组 / 起始卡组 / 专题包 / 对战派对（盒装） / 礼盒·套装 / 特典卡 | CSVH*、CSVM*、CS*DC、CSVL*、CSMPaC… 等 | **不开放拆卡**：无公开随机包规格，仅提供分类与卡表浏览 |

依据来源：[太晶盛聚发售公告](https://www.pokemon.cn/tcg/product/21997.html)、
[亘古开来发售公告](https://www.pokemon.cn/tcg/product/15585.html)、
[剑&盾系列页](https://www.pokemon.cn/special-tcg-sword_shield)、
[太阳&月亮系列页](https://www.pokemon.cn/special-tcg-sun_moon)、
[宝石包公告](https://www.pokemon.cn/tcg/product/15582.html)、
[星彩晶璃公告](https://www.pokemon.cn/tcg/product/21409.html)、
[共逐荣光公告](https://www.pokemon.cn/tcg/product/20012.html)、
[收集啦151公告](https://www.pokemon.cn/tcg/product/15486.html)、
[神奇宝贝百科](https://wiki.52poke.com/wiki/%E5%AE%9D%E5%8F%AF%E6%A2%A6%E9%9B%86%E6%8D%A2%E5%BC%8F%E5%8D%A1%E7%89%8C%E6%B8%B8%E6%88%8F)。

## 概率模型

官方从未公布每张卡的精确出货率，槽位内部各稀有度的概率为**划档模型**（`config.py`：
`NORMAL_WEIGHTS` 平卡位 C/U 分配、`HOLO_WEIGHTS` 闪卡位 R+ 分配、
`SET_SPEC_OVERRIDES` 按弹覆盖），页面「概率公示」完整展示每个槽位的概率与卡池大小。

## 功能一览

- **按商品线分类**：分组、可搜索弹名/弹代码；有随机包规格的弹按官方规格动态生成拆卡按钮，无规格的商品仅浏览。
- **开包 / 十连**：卡包撕开动画、逐张 3D 翻卡、高稀有度光效；十连为 10 包连开、逐包翻看。
- **概率公示**：每弹每个规格、每个槽位（平卡位/闪卡位）的概率与池大小，含封入变体（太晶盛聚）。
- **卡牌详情**：点击任意卡查看简中效果文本、HP/属性/招式/画师等。
- **收藏册与统计**：拆卡记录、每弹统计（包数/张数/RR+ 计数/最高稀有度）、收藏册可导出 JSON（浏览器本地保存）。
- **卡值与回本**：开包结果显示卡值与回本率，收藏册显示卡牌总价（集换社行情快照，见 `pricetool/README.md`）。
- **卡表浏览**：完整卡表 + 稀有度筛选 + 卡名搜索。

## 数据来源

- 卡表 / 卡牌详情 / 卡图：[Cryst's Cards Database（tcg.mik.moe）](https://tcg.mik.moe/)公开数据
  （由 `fetch_data.py` 同步卡表到本地；卡图经 `/img` 代理按需下载缓存）。
- 选择原因：简中官方卡表仅在微信小程序内（接口加密）；TCGdex 简中只有弹级元数据、
  无卡级数据与卡图；mik.moe 为简中社区维护的公开数据库（含简中卡图）。

## 目录结构

```
PTCG/
├─ app.py              # 服务入口（API + 图片代理 + 冻结 exe 路径适配）
├─ gacha.py            # Python 拆卡引擎（服务端用；与 shared/gacha.js 同种子对拍）
├─ shared/gacha.js     # JS 拆卡引擎（唯一权威实现：exe / APK / 小程序三端共用）
├─ config.py           # 各弹规格映射与划档概率配置
├─ fetch_data.py       # 从 mik.moe 同步各弹卡表 + 生成数据清单 manifest.json
├─ build_exe.bat       # 一键打包 exe
├─ tests/              # 引擎一致性测试（Python↔JS 同种子对拍 + 统计落位）
├─ static/             # 前端（index.html / style.css / app.js）
├─ data/
│  ├─ sets_index.json  # 弹索引
│  ├─ manifest.json    # 数据清单（热更新增量比对用）
│  ├─ cards/           # 每弹卡牌列表
│  └─ *_cache/         # 运行时缓存（图片/图标/详情，图片缓存带 LRU 上限）
└─ dist/PTCG拆卡模拟器.exe
```

## API 一览

| 路由 | 说明 |
| --- | --- |
| `GET /api/sets` | 弹列表（含每弹可用包规格 specs） |
| `GET /api/sets/<id>/cards` | 某弹完整卡表 |
| `GET /api/sets/<id>/probabilities` | 某弹全部规格的概率表 |
| `POST /api/draw` | 开包 `{set, spec, packs}` |
| `GET /api/card/<弹>/<编号>` | 卡牌详情（代理缓存 mik 详情接口） |
| `GET /img/<弹>/<编号>` · `GET /thumb/<弹>/<编号>` · `GET /icon/<弹>` | 图片/缩略图/弹图标代理（磁盘缓存，webp 缩略图缺 Pillow 时回退原图） |
| `GET /api/health` | 健康检查 `{"ok":true,"time":…}` |
| `GET /api/version` | 应用版本 `{"version":…}` |
| `GET /api/data-manifest` | 内置数据清单（各弹 md5，供前端「卡表数据更新」做增量比对） |
| `GET /api/prices` | 内置卡价静态快照（pricetool sync 生成，无快照时返回空表） |
| `GET /api/store/get` · `POST /api/store/set` | 抽卡记录/收藏册磁盘镜像（整包 `{"data":{…}}`，只补缺失键） |
| `GET /api/cache/info` · `POST /api/cache/clear` | 图片缓存占用查询 / 清空 |
| `GET /static/gacha.js` | shared/gacha.js 同源分发（与 Python 引擎同种子对拍的 JS 拆卡引擎） |

## 更新记录

<details open>
<summary><b>v1.3.3</b></summary>

**卡图按弹预缓存（exe / APK）**
- 拆卡页新增「离线缓存本弹卡图」：一键预取当前弹全部卡图（默认缩略图，可选含原图，并发 4、失败重试一次），进度弹窗可随时中止；完成后入口显示「已于 X月X日缓存 N 张」，断网也能完整浏览该弹
- APK 端经原生拦截缓存同通道预热（XHR 与卡图加载同源），合并 dev 后由构建脚本整目录带入；小程序端组件缓存不可控，不放该入口

</details>

<details>
<summary><b>v1.3.2</b></summary>

**多目标集齐期望与缺卡清单导出**
- 目标卡期望计算升级为「单卡 / 集齐」两页签：集齐支持按稀有度全部、RR+ 及以上（闭式公式 n·H_n/λ）与收藏册缺卡（固定种子蒙特卡洛，给出期望/中位/P90 包数与完成率，重复计算逐位可复现）；顺带修复 web 模式期望弹窗报错（FE-019）
- 收藏册「只看缺卡」新增一键导出：缺卡图（对齐战报布局，每页 60 张自动分页、逐格标注编号/卡名/稀有度，存相册或下载）与文本清单（复制到剪贴板，双端格式逐字一致）

</details>

<details>
<summary><b>v1.3.1</b></summary>

**整盒理论期望与实测概率对照**
- 概率公示弹窗每规格新增「整盒理论」折叠块：一盒平均该出什么（各稀有度期望张数/盒与出现率）；开整盒后的汇总条新增理论参照行（RR+ 期望张数 · 最高期望稀有度出现率 · 理论回本），"这盒出的东西"可对照"一盒平均该出什么"；奖赏包等无盒规规格不显示
- 拆卡统计新增「实测对照」：各稀有度实测占比 vs 划档模型期望占比的偏差（正绿负红），开满 30 包自动展开、不足折叠仅供参考，让概率公示可被亲眼验证；小程序出货分布叠加理论值灰色基准条与同款对照表

</details>

<details>
<summary><b>v1.3.0</b></summary>

**卡价快照与每周自动更新**
- 拆卡结果新增「卡值 / 回本」：单包小结与十连/整盒汇总条显示卡值与回本率（≥100% 绿色、不足红色），未计价规格（奖赏包）只显示卡值
- 收藏册新增「卡牌总价」与「按价格」排序（仅列出有价格的卡、单价降序，其余排序不显示价格）
- 设置页新增「卡价数据」栏：显示快照统计（共 X 张卡有价 · 覆盖 N 弹），注明「X年X月X日静态数据，仅供参考」
- 每周自动更新，**已安装的客户端无需重新打包**：GitHub Actions 每周一 03:00（北京时间）运行 `python -m pricetool sync --min-cny 5` 把最新行情提交到仓库；客户端启动时静默检查、设置页可手动「检查更新」，发现更新的快照自动应用（本地持久化，随记录镜像磁盘）。生效链路：源站（Kyo Cards/集换社行情，人民币口径）→ 仓库 master → jsDelivr/raw → 客户端（workflow 合并到 master 后生效）
- pricetool：sync 新增 `--min-cny`（只保留人民币价高于阈值的卡，如 `--min-cny 5`）与 `reindex` 子命令；快照落盘 `data/prices/index.json`，经 `/api/prices` 提供前端

**工程重构（界面与拆卡行为不变）**
- 后端 app.py 按职责拆分 server/ 包（api/media/store/httpcache/paths），前端 app.js 按关注点拆分为 10 个模块文件
- 边界修复：/api/draw packs 非数字由 500 改为 400、文件加载异常防御、缓存 .part 临时文件清理、pricetool 文件句柄等
- 测试与工程：新增 API golden 快照测试、跨实现一致性守卫、边界异常矩阵，引擎对拍扩至 20 种子×5 规格；新增 requirements.txt、CI 接入 pricetool 测试；README API 清单补全至 17 路由

</details>

<details>
<summary><b>v1.2.3</b></summary>

- 开包面板重做：全宽规格行点击展开 单包/十连/整盒（手机端各占一行，PC 为分段式按钮组）；十连与整盒对所有规格开放，整盒按真实盒规抽数（瘦包 30 包/盒、肥包与 25张装 6 包/盒）；太晶盛聚/30周年/宝石包暂无可确认盒规，不提供整盒
- 多包连开：汇总条与「再来一次」仅在最后一包显示；"第 X/Y 包"进度条改定宽、稀有度统计移到第二行；汇总条不透明底色（三端）
- 开包页码严格单行：省略号与 ‹ › 均为与页码同尺寸的正方框（此前 30 包会折成多行）
- 高稀有度光效明显增强：双层光晕、透明度提升，覆盖全部高稀有度档位（含 HR/RRR/SSR 等旧弹稀有度与 FUR/RGB）
- 修复多包连开时切回已翻过的包需要重新翻卡的问题（现在直接展示卡面）
- 设置页精简：外观去掉当前模式文字、消费统计去掉平均每包与定价说明、卡表数据更新去掉附加说明；致谢/关于分行精简；页脚改为"数据来源公开网络，仅供学习交流"
- 修复：多包连开时切回已翻过的包需要重新翻卡的问题（现在直接展示卡面）

</details>

<details>
<summary><b>v1.2.2</b></summary>

- 修复卡图加载：并发首载不再互相冲突导致缺图；加载失败自动重试 2 次后显示卡背占位，点击可重试（exe / APK / 小程序三端）
- 新增稀有度可达性守卫测试，修复太阳&月亮时代 30 个弹 HR/RRR/SSR/S/CSR/CHR/K/A/PR 稀有度卡永远抽不到、收藏无法 100% 的问题（划档概率公示同步更新）
- 小程序端：整盒/十连汇总条（RR+ 统计/最高稀有度/合计花费）、包号横滑页签、自动翻卡开关、高稀有度光效、规格选中态
- 小程序端收藏存储改为按弹分键，规避微信单键 1MB 上限导致的收藏静默丢失（自动迁移旧数据）；空间用量超 80% 预警
- 收藏册新增「导入 JSON」（Web 文件导入 / 小程序剪贴板导入，与导出格式互通，合并式写入）
- 拆卡页新增稀有度出货分布图（exe / APK / 小程序）
- 数据同步健壮性：分页完整性断言、原子写、`--only` 按弹增量；完整性校验改为与上次提交对比（消除自比循环论证）

</details>

<details>
<summary><b>v1.2.1</b></summary>

- 新弹开放拆卡：补充包「30周年庆典」（6张装全闪、每包必出1张30周年特款皮卡丘，18元/包）；新增 FUR / RGB 稀有度展示
- 卡表热更新改为增量比对：以内置数据指纹 + 已应用记录为基线，只下载有差异的弹（此前首次检查会全量下载）；下载失败的弹保留待重试状态，不再被误记为"已最新"
- 数据同步适配 mik.moe 接口改版（新版参数结构），全量同步恢复可用
- 设置页新增致谢：数据来源与支持方

</details>

<details>
<summary><b>v1.2.0</b></summary>

- 收藏册完成度与缺卡清单：每弹显示"已收集 X/Y 种（百分比）"进度条，新增「只看缺卡」模式直击缺口
- 目标卡期望成本计算：基于划档概率模型计算"抽到指定某张卡"的期望包数与期望花费（每规格每稀有度）
- 整盒模拟：主弹系列一键 30 包连开，汇总条统计 RR+ 数量、最高稀有度与合计花费
- 拆卡战报图：canvas 生成当前卡包战报（卡图网格 + 稀有度统计），APK 保存到相册目录、PC 直接下载
- 卡表数据热更新：设置页可从远程 manifest 按弹增量更新卡表（无需等新版本），「恢复内置」一键回退
- 数据自动同步：GitHub Actions 每周全量同步 mik.moe 卡表并生成 data/manifest.json
- 引擎统一：拆卡引擎抽取为 `shared/gacha.js` 唯一权威实现（exe 服务端复用 / APK 内嵌 / 小程序共用），
  新增 Python↔JS 同种子逐卡对拍 + 统计落位测试（`tests/`），CI 每次推送自动回归
- 性能与健壮性：大弹卡表增量渲染（滚动续载）、服务端图片缓存 LRU 上限（默认 600MB，`PTCG_IMG_CACHE_MB` 可调）、
  APK 原生图缓 500MB 最旧淘汰、代理接口限流与出站超时收紧

</details>

<details>
<summary><b>v1.1.0</b></summary>

- 消费统计：按官方建议零售价记账（全局生效）——5张装 10 元、20张/25张装 50 元、太晶盛聚 10张装 30 元、宝石包 10 元/包；奖赏包无官方单包定价不计入
  - 拆卡页统计新增「本弹花费」，拆卡记录逐条显示金额
  - 设置页新增消费总览：总花费、总包数、平均每包成本、按弹明细，支持一键清零与记账开关
- 应用内确认弹窗与 toast 提示：替代原生 confirm/alert，exe/安卓弹窗不再显示源地址前缀，样式与整体 UI 统一
- PC 端应用窗口式布局：顶栏与底部状态栏固定、内容区独立滚动（细滚动条），状态栏显示版本与当前弹包，告别"网页感"
- 修复：浅色模式十连页码指示器白字白底不可见

</details>

<details>
<summary><b>v1.0.2</b></summary>

- 自动检查更新：启动静默检查 GitHub 最新版本，发现新版在设置页提示并提供当前平台安装包直链（支持手动检查，带 toast 反馈）
- 浅色模式修复：手机底部导航黑色投影、开包稀有度统计透明底、卡牌详情/概率公示弹窗改为不透明面板
- APK 系统栏（状态栏/导航栏）颜色跟随深浅色主题，全屏色彩统一，切换实时生效

</details>

<details>
<summary><b>v1.0.1（2026-09-09）</b></summary>

- APK 卡图原生磁盘缓存：看过的卡落盘保存，二次浏览免联网；设置页新增缓存占用显示与一键清除（exe 同步支持）
- 新增设置页：深色/浅色模式切换（记忆保存），缓存管理
- 抽卡记录、统计与收藏册持久化：重启不再丢失（记录实时镜像到本机文件）
- 修复：收藏册/卡表空提示折行；浅色模式按钮对比度；卡表稀有度配色；安卓端弹窗来源提示
- 手机端底部导航新增「设置」页，界面按手机比例优化

</details>

<details>
<summary><b>v1.0.0</b></summary>

- 首个公开版本：131 弹简中卡表、商品线分类、官方规格拆卡与划档概率公示、收藏册/卡表、Windows exe 与安卓 APK 双端

</details>
## 声明

卡表数据与卡图来自公开网络，仅供学习交流与个人娱乐。
宝可梦及相关名称为 Nintendo / Creatures / GAME FREAK / The Pokémon Company 的商标。

## 微信小程序（wechat-miniapp 分支）

在本分支上，同一套引擎与卡表被移植为微信小程序（`miniprogram/`，原生 WXML，无第三方框架）：

- **零后端**：卡表裁剪为最小字段后全量内嵌（cards.js 约 1MB，主包 2MB 限制内，无需分包），
  拆卡引擎 `shared/gacha.js` 以 CommonJS 引入，与 exe / APK 完全同源。
- **图源直连**：卡图经 `<image>` 组件直连 mik.moe（image 组件不占域名白名单）；
  卡牌详情文本走 `wx.request`（需在 mp 后台配置 request 合法域名，未配置时自动降级为基础信息）。
- **功能**：弹包分类选择、官方规格拆卡/十连/整盒、翻卡与稀有度特效、概率公示、目标卡期望计算、
  收藏册（完成度 + 缺卡模式）、卡表浏览（增量渲染）、消费统计、深浅色主题。
- 本地存储键名与 exe / APK 一致，收藏册 JSON 导出互通。

```bash
python tools/build_miniprogram.py   # 从 data/ 生成 miniprogram/data/ 与卡背 WebP
# 微信开发者工具导入 miniprogram/ 目录即可预览
```

**上线前必读**：[docs/MINIPROGRAM-LAUNCH.md](https://github.com/zsjy947/PTCG-gacha-simulator/blob/wechat-miniapp/docs/MINIPROGRAM-LAUNCH.md)（wechat-miniapp 分支）——
类目选择（工具类，勿选游戏）、小程序 ICP 备案、商标词规避、域名白名单、隐私保护指引等完整清单。

## 安卓 APK（android-apk 分支）

在 `android-apk` 分支上，同一套前端被改造成纯资产模式（无 Python 后端）：
卡表/弹索引内嵌进 APK，拆卡引擎（规格/变体/划档概率）移植为 JS 本地运行，
卡牌牌面由 WebView 直连 mik.moe 图源在线加载。

```bash
git checkout android-apk
python android/build_assets.py    # 生成 android/app/src/main/assets/www/
python android/build_apk.py       # 产出 dist/PTCG拆卡模拟器.apk
```

- 构建链：aapt2 → javac → d8 → zipalign → apksigner（不依赖 Gradle/AGP）。
- 工具链用系统级安装：脚本读取 `JAVA_HOME`（JDK 17，缺省 `D:\Tools\jdk-17`）
  与 `ANDROID_HOME`（Android SDK，缺省 `D:\Tools\android-sdk`），取其中的
  build-tools 34 / platform-34；环境变量未设置时自动回退到缺省路径。
- 签名密钥 `android/gacha.keystore` 首次构建时自动生成在本地（连同口令文件
  `keystore.properties`），两者均被 .gitignore 排除、永不入库；也可用环境变量
  `PTCG_KEYSTORE_PASS` 指定口令。注意：更换密钥后已安装的旧 APK 需卸载重装。
- 系统要求：Android 7.0+（WebView 内核，建议系统 WebView 保持更新）。
