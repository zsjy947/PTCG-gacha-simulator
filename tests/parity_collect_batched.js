#!/usr/bin/env node
/* 分步集齐模拟对拍 JS 侧：node tests/parity_collect_batched.js <cards.json> <spec.json> <targets.json> [opts.json]
 * 输出 {"batched": 分批跑完的 result, "oneshot": collectExpectation 结果}
 * —— tests/test_consistency.py 断言两者完全相等，且与 Python collect_sim_batched 逐步结果相等。 */
"use strict";
const path = require("path");
const engine = require(path.join(__dirname, "..", "shared", "gacha.js"));

const [cardsPath, specPath, targetsArg, optsArg] = process.argv.slice(2);
const cards = JSON.parse(require("fs").readFileSync(cardsPath, "utf8"));
const spec = JSON.parse(require("fs").readFileSync(specPath, "utf8"));
const targets = JSON.parse(targetsArg);
const opts = optsArg ? JSON.parse(optsArg) : undefined;
const pools = engine.buildPools(cards);
const runner = engine.collectSimBatched(spec, pools, targets, opts);
let st = null;
for (let i = 0; i < 100000; i++) {
  st = runner.next();
  if (st.finished) break;
}
if (!st || !st.finished) throw new Error("分批运行器未在预期步数内完成（空目标守卫失效？）");
const oneshot = engine.collectExpectation(spec, pools, targets, opts);
process.stdout.write(JSON.stringify({ batched: st.result, oneshot }));
