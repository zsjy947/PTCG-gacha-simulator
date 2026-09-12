# PTCG拆卡模拟器（宝可梦卡牌 · 简中）

一个按**弹（扩展系列）**分类的简体中文宝可梦卡牌拆卡模拟器：
选择弹包 → 按该弹**官方发售规格**开包（5张瘦包 / 20张肥包 / 25张装 / 10张装 / 宝石包 4张全闪等）→
3D 翻卡看牌面（卡图从网络实时获取并缓存）。内置概率公示、收藏册与完整卡表浏览。

## 快速开始（exe，免安装）

双击 `dist\宝可梦卡牌模拟拆卡.exe` 即可 —— 程序会自动启动本地服务并打开浏览器。

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
├─ gacha.py            # 拆卡引擎（规格/变体槽位 + 稀有度卡池）
├─ config.py           # 各弹规格映射与划档概率配置
├─ fetch_data.py       # 从 mik.moe 同步各弹卡表
├─ build_exe.bat       # 一键打包 exe
├─ static/             # 前端（index.html / style.css / app.js）
├─ data/
│  ├─ sets_index.json  # 弹索引
│  ├─ cards/           # 每弹卡牌列表
│  └─ *_cache/         # 运行时缓存（图片/图标/详情）
└─ dist/宝可梦卡牌模拟拆卡.exe
```

## API 一览

| 路由 | 说明 |
| --- | --- |
| `GET /api/sets` | 弹列表（含每弹可用包规格 specs） |
| `GET /api/sets/<id>/cards` | 某弹完整卡表 |
| `GET /api/sets/<id>/probabilities` | 某弹全部规格的概率表 |
| `POST /api/draw` | 开包 `{set, spec, packs}` |
| `GET /api/card/<弹>/<编号>` | 卡牌详情（代理缓存） |
| `GET /img/<弹>/<编号>` · `GET /icon/<弹>` | 图片代理（磁盘缓存） |

## 更新记录

### v1.1.0

- 消费统计：按官方建议零售价记账（全局生效）——5张装 10 元、20张/25张装 50 元、太晶盛聚 10张装 30 元、宝石包 10 元/包；奖赏包无官方单包定价不计入
  - 拆卡页统计新增「本弹花费」，拆卡记录逐条显示金额
  - 设置页新增消费总览：总花费、总包数、平均每包成本、按弹明细，支持一键清零与记账开关
- 应用内确认弹窗与 toast 提示：替代原生 confirm/alert，exe/安卓弹窗不再显示源地址前缀，样式与整体 UI 统一
- PC 端应用窗口式布局：顶栏与底部状态栏固定、内容区独立滚动（细滚动条），状态栏显示版本与当前弹包，告别"网页感"
- 修复：浅色模式十连页码指示器白字白底不可见

### v1.0.2

- 自动检查更新：启动静默检查 GitHub 最新版本，发现新版在设置页提示并提供当前平台安装包直链（支持手动检查，带 toast 反馈）
- 浅色模式修复：手机底部导航黑色投影、开包稀有度统计透明底、卡牌详情/概率公示弹窗改为不透明面板
- APK 系统栏（状态栏/导航栏）颜色跟随深浅色主题，全屏色彩统一，切换实时生效

### v1.0.1（2026-09-09）

- APK 卡图原生磁盘缓存：看过的卡落盘保存，二次浏览免联网；设置页新增缓存占用显示与一键清除（exe 同步支持）
- 新增设置页：深色/浅色模式切换（记忆保存），缓存管理
- 抽卡记录、统计与收藏册持久化：重启不再丢失（记录实时镜像到本机文件）
- 修复：收藏册/卡表空提示折行；浅色模式按钮对比度；卡表稀有度配色；安卓端弹窗来源提示
- 手机端底部导航新增「设置」页，界面按手机比例优化

### v1.0.0

- 首个公开版本：131 弹简中卡表、商品线分类、官方规格拆卡与划档概率公示、收藏册/卡表、Windows exe 与安卓 APK 双端

## 声明

卡表数据与卡图来自公开网络，仅供学习交流与个人娱乐。
宝可梦及相关名称为 Nintendo / Creatures / GAME FREAK / The Pokémon Company 的商标。

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
- JDK 17 / build-tools 34 / platform-34 需预先解压到 `android/sdk/`
  （下载脚本见 sdk-dl/ 中三个 zip 的来源 URL，详见构建脚本头部说明）。
- 签名密钥 `android/gacha.keystore` 首次构建时自动生成在本地（连同口令文件
  `keystore.properties`），两者均被 .gitignore 排除、永不入库；也可用环境变量
  `PTCG_KEYSTORE_PASS` 指定口令。注意：更换密钥后已安装的旧 APK 需卸载重装。
- 系统要求：Android 7.0+（WebView 内核，建议系统 WebView 保持更新）。
