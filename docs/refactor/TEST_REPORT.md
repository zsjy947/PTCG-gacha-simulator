# 动态测试报告（阶段 0 基线 + 阶段 4 闭环）

## 阶段 0 · 基线（重构前，dev @ b4b080b）

- 单元测试：`python -m unittest discover -s tests` → 4 个用例全绿（引擎对拍 2 种子×4 规格、统计落位、包内去重、稀有度可达性）。
- golden 快照：`tests/test_api_golden.py` 新建并生成基线快照（`tests/golden/`）。
- 稳定性/性能基线：见下方「性能基线数据」（重构后阶段 4 复测对照，不得退化）。

### 性能基线数据

测量环境：Windows 11（本机）、Python 3.10.11、Flask 3.1.3，Flask test_client 进程内；
内存口径 tracemalloc Python 堆峰值。原始数据：`docs/refactor/baseline_perf.jsonl`。

| 指标 | dev @ b4b080b（重构前，2026-09-28） |
|---|---|
| 500 次连续 POST /api/draw（CSV1C sv5） | 2.052 s ｜ 243.7 req/s ｜ 均值 4.10 ms ｜ 峰值堆 0.51 MB |
| 200 次 GET /img（缓存命中路径） | 0.729 s ｜ 274.2 req/s ｜ 均值 3.65 ms ｜ 峰值堆 0.20 MB |

阶段 4 复测对照标准：耗时不超过基线 1.5×、无偶现报错（含测试期 stderr 无未捕获异常）。

## 阶段 2.1 · app.js 拆分中间验证

- `node --check` 全部 10 个前端文件通过；行区间重组与原文件逐行一致（1651 非空行全等）。
- 浏览器冒烟（Flask 本地 :5020 + 应用内浏览器）：拆分前后 `Object.getOwnPropertyNames(window)`
  对比——拆分后 **0 个页面符号丢失、0 个新增**（基线侧多出的 4 个为浏览器环境注入物）；
  页面渲染 132 弹/10 分组，选弹→单包→撕包→全部翻开→小结/战报按钮全链路正常。

## 阶段 4 · 闭环（重构后）

（待阶段 4 执行后填写：用例矩阵 × 结果 × 关联台账 ID）
