# 重构问题台账

> 初始登记 = 计划附录 A；执行原则：必修=崩溃级，可做=无感加固（当前卡池数据下输出逐字节不变），
> 其余仅记录不改。每条闭环时填「状态 / 验证 / 备注」，可单独回滚。
> 状态取值：`待处理 → 进行中 → 已闭环` 或 `保留（理由）`。

## 前端（FE）

| ID | 位置（基线） | 问题 | 维度 | 处置 | 状态 | 验证 |
|---|---|---|---|---|---|---|
| FE-001 | app.js 876-1011 | renderCollection 三个近似重复渲染循环 | 重复逻辑 | 抽 collectionTile()（DOM 结构/属性/文本逐字节一致，元素间空白归一） | 已闭环 | 浏览器实测 22 tile 渲染正常 + 公式对照 |
| FE-002 | app.js 765-791 | maybeRecordPack/recordUnfinished 重复四连调用 | 重复逻辑 | 合并 recordPackResult() | 已闭环 | 开包/收起入账链路冒烟正常 |
| FE-003 | app.js 637-663/722-742/848 | 盒装/单包汇总重复 + RR+ 表达式两处 | 重复逻辑 | 抽 rarityCounts()/renderChips()/rrUpTo()/activeSpec()（战报图计数一并复用） | 已闭环 | 页面内与原公式逐字节对照通过 + 十连汇总条实测 |
| FE-004 | app.js 8-15、style.css 25-34/346-358 | 稀有度色板三副本（小程序第四份，范围外） | 可维护性 | 保留三处（契约），加一致性注释与测试 | 已闭环 | tests/test_consistency.py：style.css --r-* 与 core.js RARITY_COLOR 全等 |
| FE-005 | app.js 25/60-62/1502 | 死代码 BOX_SIZE、cardImage()、#themeInfo | 工程规范 | 台账后删除 | 已闭环 | 全仓 grep 无残留引用；typeof 校验已不存在 |
| FE-006 | app.js 695-697 等 | 时序魔法数散布 | 魔法数 | 命名化（R4 常量块 + specBtnClass 阈值）；值逐一核对不变。回修：AGAIN_DELAY_MS 漏定义（维度1/2/6 抓获）已补 core.js 并复测「再来一次」链路 | 已闭环 | 复测 stats 13→14 + 三维度交叉确认 |
| FE-007 | app.js 28-39/588 | state.pending 未声明 | 规范 | 显式声明 | 已闭环 | state 含 pending: null，开包链路正常 |
| FE-008 | app.js 655 | state.packs[0][0] 空包假设 | 崩溃级 | 加守卫（renderBoxSummary firstCard 守卫 + renderPackSummary pack.length 守卫，同类同修） | 已闭环 | 当前数据输出不变；开包/汇总冒烟正常 |
| FE-009 | app.js 1188/1198/1200-1203 | showDetail 字段未转义 | 安全 | 无感加固（弱点值/HP/属性/撤退 4 处 escapeHtml） | 已闭环 | 当前数据渲染逐字节不变（浏览器回归） |
| FE-010 | app.js 1127 | fillRarityFilter value 未转义 | 安全 | 无感加固（option value 与文本均转义） | 已闭环 | 卡表筛选冒烟正常 |
| FE-011 | app.js 653 等 8 处 | RARITY_COLOR 注入 style 属性 | 安全 | 无感加固（9 处色值 escapeHtml；hex 无可转义字符→逐字节不变） | 已闭环 | chips/dist/badge 渲染回归逐字节一致 |
| FE-012 | app.js 749 | 未知稀有度 indexOf=-1 触发爆闪 | 逻辑 | 仅记录不改（行为） | 保留（用户可见行为） | |
| FE-013 | app.js 454-456 | filterSets 用 style.display 与 hidden 模式不一致 | 规范 | 仅记录不改 | 保留（行为等价、改动无收益） | |
| FE-014 | style.css 686-693/726-737 | 重复 .pack-tab 规则 | 工程规范 | 合并两处 720px 媒体查询块（重复选择器取级联后生效值，合并块置于原后块位置保持层叠顺序） | 已闭环 | 400px 窄视口实测：单列下拉/28px 页码/ellipsis 28px 与基线一致 |
| FE-015 | app.js 799 | 历史 30 条静默截断 | 行为 | 仅记录不改 | 保留（产品行为） | |
| FE-016 | app.js 内联 onerror | 依赖全局 __imgFail、CSP 不兼容 | 安全 | 仅记录不改（契约 R3） | 保留（契约） | |

## 后端（BE）

| ID | 位置（基线） | 问题 | 维度 | 处置 | 状态 | 验证 |
|---|---|---|---|---|---|---|
| BE-001 | app.py 359 | /api/draw packs 非数字 → 500 | 崩溃级 | 加守卫 → 400 {"error":"非法参数"}；浮点沿用 int 截断 | 已闭环 | golden 测试：abc/列表/字典 → 400；1.5 → 1 包 200 |
| BE-002 | app.py 267-271/453/469 | 文件加载无异常保护 | 崩溃级 | load_index 防御→[]；data-manifest/prices 读取失败→各自缺文件形态 | 已闭环 | 全套 golden 回归全绿 |
| BE-003 | app.py 125-133/507-515 | _dir_bytes/_dir_size 重复 | 重复逻辑 | 合并（_dir_bytes 保留 LRU 内部用，cache_info 用 _dir_size，并存至 BE-003 修复提交合并） | 已闭环 | 阶段1 合并提交：仅保留 _dir_size，_lru_enforce/cache_info 共用；golden 全绿 |
| BE-004 | app.py 530-544 | cache_clear 与在途下载竞态 | 并发 | 仅记录不改（修复需改锁时序） | 保留（时序契约） | |
| BE-005 | app.py 101 | X-Forwarded-For 可伪造 | 安全 | 仅记录不改（仅绑定 127.0.0.1） | 保留（威胁模型不成立） | |
| BE-006 | config.py 全文 | 配置与逻辑混杂、魔法数 | 可维护性 | 内部整理（四节归组+文档去重；签名/逻辑/值不动） | 已闭环 | 公共符号取值快照比对一致 + golden/对拍全绿 |
| BE-007 | fetch_data.py 130-244 | main() 115 行 | 拆分 | 拆 split_151/expand_sets/insert_151_entries/write_manifest；print 与退出码逐字保留 | 已闭环 | 本地干跑输出与基线逐行一致（索引/清单重写后与 git 版本字节一致） |
| BE-008 | store.py 14-19 / fetch_data.py 93-97 | atomic_write_json/_md5 双实现 | 重复逻辑 | 不合并，加一致性测试 | 已闭环 | tests/test_consistency.py：双实现同输入字节一致 |
| BE-009 | app.py 280-294 等 | spec_brief 三平台三实现 | 重复逻辑 | 不合并，加等价测试 | 已闭环 | tests/test_consistency.py：全可拆弹公共字段逐一等价 |
| BE-010 | kyo.py 10/78 | docstring 0.4s 与实现 0.6s 不符 | 文档 | 修正注释（无感） | 已闭环 | kyo.py 文档改为 0.6s，与 KyoClient 默认一致 |
| BE-011 | sync.py 23 / cli.py 230 | DEFAULT_BUDGET 120 vs CLI 600 | 文档 | 只在文档/注释说明，不改默认值 | 已闭环 | DEFAULT_BUDGET 注释说明两处默认值刻意不同、均未改动 |
| BE-012 | cli.py 148 | 文件句柄未关闭 | 崩溃级 | 改 with-open | 已闭环 | pricetool 单测全绿 + value 命令冒烟 |
| BE-013 | app.py _cached_fetch | .part 残留文件 | 资源 | 补清理（finally：成功替换后 no-op，异常/中断即删） | 已闭环 | 代码审查 + golden/单测全绿（网络路径不进自动化） |
| BE-014 | .github/workflows/ci.yml | pricetool 测试未接入 CI | 测试闭环 | 接入 | 待处理 | |
| BE-015 | 仓库根 | 无 requirements.txt | 工程规范 | 新增 | 待处理 | |
| BE-016 | README API 清单 | 缺 6 个路由文档 | 文档 | 补全 | 待处理 | |
| BE-017 | kyo.py 79 / app.py 85 | Session 不关闭 | 资源 | 仅记录（进程生命周期） | 保留（进程级单例） | |
| BE-018 | 三处 normIdx 镜像 | 键规范三实现 | 兼容 | 加一致性测试 | 已闭环 | tests/test_consistency.py：前端 normIdx（node 执行真实源码）↔ norm_index ↔ zfill 全值一致 |

## pricetool（PR）

| ID | 位置（基线） | 问题 | 维度 | 处置 | 状态 | 验证 |
|---|---|---|---|---|---|---|
| PR-001 | sync.py 107-311 | sync() 205 行 | 拆分 | 拆 _load_name_cache/_set_entries/_topup_by_name/_build_price_cards/_refine_expensive/_sync_one_set；日志逐字保留 | 已闭环 | pricetool 31 测全绿 + 离线 CLI 冒烟（query/value）输出一致 |
| PR-002 | sync.py/cli.py | print 日志无 logging 模块 | 日志 | 仅记录不改（输出格式契约 R7） | 保留（格式契约） | |

| BE-019 | server/httpcache.py _lru_enforce | 扫描推导式 p.stat() 无防御，与 cache_clear 并发可抛 OSError→500（维度3 S5） | 崩溃级（同类） | 逐文件 try/except OSError 跳过 | 已闭环 | py_compile+37 测全绿 |
| BE-020 | server/httpcache.py _fetch_detail | 直写缓存非原子，中断残留截断 JSON 永久当有效缓存（维度3 S7） | 资源 | tmp+replace 原子写（按文件锁建议保留不加，避免改并发时序） | 已闭环 | 代码审查+回归全绿；锁部分保留 |
| BE-021 | server/httpcache.py _lru_size=-1 哨兵 | 初始 -1 期间增量记账跳过、淘汰不可达，直至首次全量扫描/清缓存（维度5 M-03，基线继承） | 性能陷阱 | 仅记录+注释说明初始化协议，不改行为 | 保留（基线行为，修复属行为变更） | 维度5 报告 M-03 |
| BE-022 | server/store.py store_set | 写失败残留 .json.tmp（与 BE-013 不对称，维度5 M-05） | 资源 | 补 finally 等价清理 | 已闭环 | 回归全绿 |
| BE-023 | app.py/httpcache.py | 缓存路由在 app.py 手工挂载，与其余模块 register() 模式不一致（维度5 M-02） | 可维护性 | httpcache.register(app) 统一装配 | 已闭环 | golden 路由表回归全绿 |
| BE-024 | android/build_assets.py | 前端拆分伴随改动未及时登记（维度2 F-2） | 台账 | 本条补录：按 index.html 脚本序逐文件复制+注入，产物清单干跑核对等价 | 已闭环 | 干跑清单 + 维度6 R8 核对 |
| BE-025 | fetch_data.py split_151 | 删除基线死代码 appear=Counter(...)（维度2 F-3） | 台账 | 本条补录：零行为影响 | 已闭环 | 维度2 对照确认 |
| BE-026 | static/data.js order 数组 | GROUP_ORDER 前端硬编码副本无守卫（维度5 M-04） | 兼容 | tests/test_consistency.py 增 TestGroupOrderMirror | 已闭环 | 37 测全绿 |
| BE-027 | fetch_data.py/server/__init__.py/app.py/tests | 工程卫生：未用 import urllib.error、__init__ 描述措辞、重导出注释过宽、import math 位置（维度1 #2-#5） | 工程规范 | 逐一修正 | 已闭环 | py_compile+测试全绿 |
| BE-028 | media 路由 | _cached_fetch 二次重试网络异常 raise→500 HTML（维度3 S6，基线行为） | 错误契约 | 仅记录不改（改 404 属错误契约变更） | 保留（基线行为） | 维度3 报告 S6 |
| BE-029 | _locks 只增不删；_fetch_detail 无按文件锁；收藏导入无字符白名单；无 CSP（维度3 S7锁部分/S8/S2建议/S9） | 安全加固建议 | 安全 | 仅记录（CSP 与内联 onerror 契约冲突同 FE-016；白名单会改导入行为） | 保留（记录） | 维度3 报告 |
| FE-017 | ui-modals/ui-draw/ui-sets | showDetail 稀有度回退、概率/期望 rarity、小结 label、hero 图 URL 未转义（维度3 S1/S3/S4 + S2 部分） | 安全 | 无感加固 escapeHtml | 已闭环 | 渲染回归逐字节不变 |
| FE-018 | collectionTile/cl-card/gcard/mini-card/detail 等 6 处 | thumbURL/imgURL/iconURL 拼接进 innerHTML 未转义，恶意收藏导入可注入（维度3 S2） | 安全 | 模板内 escapeHtml(URL)（当前数据字符集下逐字节不变）；导入白名单建议见 BE-029 | 已闭环 | 回归全绿 |
| FE-019 | ui-modals.js showExpectedCost | web 服务模式 _spec_brief 不含 slots/variants，G().expectedCost 报 "v.slots is not iterable"——基线即如此（APK 全量规格下正常） | 逻辑 | 仅记录不改（修复需改接口形状，超本轮范围） | 保留（基线行为，E2E 实证） | E2E 记录 + dev 对照 |

## 执行期新增（动态登记）

| ID | 位置 | 问题 | 维度 | 处置 | 状态 | 验证 |
|---|---|---|---|---|---|---|
| — | | | | | | |
