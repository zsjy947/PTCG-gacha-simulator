#!/usr/bin/env node
/* 集齐期望对拍 JS 侧：node tests/parity_collect.js <cards.json> <spec.json> <targets.json> [opts.json]
 * 输出 JSON.stringify(collectExpectation(...))，与 Python 镜像（gacha.collect_expectation）
 * 在 tests/test_consistency.py 断言 closed 完全相等 / sim 同种子数值逐位相等。 */
"use strict";
const path = require("path");
const engine = require(path.join(__dirname, "..", "shared", "gacha.js"));

const [cardsPath, specPath, targetsArg, optsArg] = process.argv.slice(2);
const cards = JSON.parse(require("fs").readFileSync(cardsPath, "utf8"));
const spec = JSON.parse(require("fs").readFileSync(specPath, "utf8"));
const targets = JSON.parse(targetsArg);
const opts = optsArg ? JSON.parse(optsArg) : undefined;
const pools = engine.buildPools(cards);
process.stdout.write(JSON.stringify(engine.collectExpectation(spec, pools, targets, opts)));
