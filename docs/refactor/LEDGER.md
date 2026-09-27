# 重构问题台账

> 初始登记 = 计划附录 A；执行原则：必修=崩溃级，可做=无感加固（当前卡池数据下输出逐字节不变），
> 其余仅记录不改。每条闭环时填「状态 / 验证 / 备注」，可单独回滚。
> 状态取值：`待处理 → 进行中 → 已闭环` 或 `保留（理由）`。

## 前端（FE）

| ID | 位置（基线） | 问题 | 维度 | 处置 | 状态 | 验证 |
|---|---|---|---|---|---|---|
| FE-001 | app.js 876-1011 | renderCollection 三个近似重复渲染循环 | 重复逻辑 | 抽 collectionTile() | 待处理 | |
| FE-002 | app.js 765-791 | maybeRecordPack/recordUnfinished 重复四连调用 | 重复逻辑 | 合并 recordPackResult() | 待处理 | |
| FE-003 | app.js 637-663/722-742/848 | 盒装/单包汇总重复 + RR+ 表达式两处 | 重复逻辑 | 抽 helper（rarityCounts/renderChips/rrUpTo） | 待处理 | |
| FE-004 | app.js 8-15、style.css 25-34/346-358 | 稀有度色板三副本（小程序第四份，范围外） | 可维护性 | 保留三处（契约），加一致性注释与测试 | 待处理 | |
| FE-005 | app.js 25/60-62/1502 | 死代码 BOX_SIZE、cardImage()、#themeInfo | 工程规范 | 台账后删除 | 待处理 | |
| FE-006 | app.js 695-697 等 | 时序魔法数散布 | 魔法数 | 命名化（值不变，R4 表） | 待处理 | |
| FE-007 | app.js 28-39/588 | state.pending 未声明 | 规范 | 显式声明（无感） | 待处理 | |
| FE-008 | app.js 655 | state.packs[0][0] 空包假设 | 崩溃级 | 加守卫（无感） | 待处理 | |
| FE-009 | app.js 1188/1198/1200-1203 | showDetail 字段未转义 | 安全 | 无感加固（转义） | 待处理 | |
| FE-010 | app.js 1127 | fillRarityFilter value 未转义 | 安全 | 无感加固 | 待处理 | |
| FE-011 | app.js 653 等 8 处 | RARITY_COLOR 注入 style 属性 | 安全 | 无感加固（色值白名单来源） | 待处理 | |
| FE-012 | app.js 749 | 未知稀有度 indexOf=-1 触发爆闪 | 逻辑 | 仅记录不改（行为） | 保留（用户可见行为） | |
| FE-013 | app.js 454-456 | filterSets 用 style.display 与 hidden 模式不一致 | 规范 | 仅记录不改 | 保留（行为等价、改动无收益） | |
| FE-014 | style.css 686-693/726-737 | 重复 .pack-tab 规则 | 工程规范 | 合并（计算结果不变） | 待处理 | |
| FE-015 | app.js 799 | 历史 30 条静默截断 | 行为 | 仅记录不改 | 保留（产品行为） | |
| FE-016 | app.js 内联 onerror | 依赖全局 __imgFail、CSP 不兼容 | 安全 | 仅记录不改（契约 R3） | 保留（契约） | |

## 后端（BE）

| ID | 位置（基线） | 问题 | 维度 | 处置 | 状态 | 验证 |
|---|---|---|---|---|---|---|
| BE-001 | app.py 359 | /api/draw packs 非数字 → 500 | 崩溃级 | 加守卫 → 400 | 待处理 | |
| BE-002 | app.py 267-271/453/469 | 文件加载无异常保护 | 崩溃级 | 加 (OSError, ValueError) 防御 | 待处理 | |
| BE-003 | app.py 125-133/507-515 | _dir_bytes/_dir_size 重复 | 重复逻辑 | 合并（_dir_bytes 保留 LRU 内部用，cache_info 用 _dir_size，并存至 BE-003 修复提交合并） | 已闭环 | 阶段1 合并提交：仅保留 _dir_size，_lru_enforce/cache_info 共用；golden 全绿 |
| BE-004 | app.py 530-544 | cache_clear 与在途下载竞态 | 并发 | 仅记录不改（修复需改锁时序） | 保留（时序契约） | |
| BE-005 | app.py 101 | X-Forwarded-For 可伪造 | 安全 | 仅记录不改（仅绑定 127.0.0.1） | 保留（威胁模型不成立） | |
| BE-006 | config.py 全文 | 配置与逻辑混杂、魔法数 | 可维护性 | 内部整理（四节归组+文档去重；签名/逻辑/值不动） | 已闭环 | 公共符号取值快照比对一致 + golden/对拍全绿 |
| BE-007 | fetch_data.py 130-244 | main() 115 行 | 拆分 | 拆 split_151/expand_sets/insert_151_entries/write_manifest；print 与退出码逐字保留 | 已闭环 | 本地干跑输出与基线逐行一致（索引/清单重写后与 git 版本字节一致） |
| BE-008 | store.py 14-19 / fetch_data.py 93-97 | atomic_write_json/_md5 双实现 | 重复逻辑 | 不合并，加一致性测试 | 待处理 | |
| BE-009 | app.py 280-294 等 | spec_brief 三平台三实现 | 重复逻辑 | 不合并，加等价测试 | 待处理 | |
| BE-010 | kyo.py 10/78 | docstring 0.4s 与实现 0.6s 不符 | 文档 | 修正注释（无感） | 待处理 | |
| BE-011 | sync.py 23 / cli.py 230 | DEFAULT_BUDGET 120 vs CLI 600 | 文档 | 只在文档/注释说明，不改默认值 | 已闭环 | DEFAULT_BUDGET 注释说明两处默认值刻意不同、均未改动 |
| BE-012 | cli.py 148 | 文件句柄未关闭 | 崩溃级 | 改 with-open | 待处理 | |
| BE-013 | app.py _cached_fetch | .part 残留文件 | 资源 | 补清理（try/finally） | 待处理 | |
| BE-014 | .github/workflows/ci.yml | pricetool 测试未接入 CI | 测试闭环 | 接入 | 待处理 | |
| BE-015 | 仓库根 | 无 requirements.txt | 工程规范 | 新增 | 待处理 | |
| BE-016 | README API 清单 | 缺 6 个路由文档 | 文档 | 补全 | 待处理 | |
| BE-017 | kyo.py 79 / app.py 85 | Session 不关闭 | 资源 | 仅记录（进程生命周期） | 保留（进程级单例） | |
| BE-018 | 三处 normIdx 镜像 | 键规范三实现 | 兼容 | 加一致性测试 | 待处理 | |

## pricetool（PR）

| ID | 位置（基线） | 问题 | 维度 | 处置 | 状态 | 验证 |
|---|---|---|---|---|---|---|
| PR-001 | sync.py 107-311 | sync() 205 行 | 拆分 | 拆 _load_name_cache/_set_entries/_topup_by_name/_build_price_cards/_refine_expensive/_sync_one_set；日志逐字保留 | 已闭环 | pricetool 31 测全绿 + 离线 CLI 冒烟（query/value）输出一致 |
| PR-002 | sync.py/cli.py | print 日志无 logging 模块 | 日志 | 仅记录不改（输出格式契约 R7） | 保留（格式契约） | |

## 执行期新增（动态登记）

| ID | 位置 | 问题 | 维度 | 处置 | 状态 | 验证 |
|---|---|---|---|---|---|---|
| — | | | | | | |
