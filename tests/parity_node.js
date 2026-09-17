#!/usr/bin/env node
/* 跨引擎对拍 JS 侧：node tests/parity_node.js <fixture.json> <spec.json> <seed> <packs>
 * 输出与 Python 侧相同投影的 JSON：[[{i,r,s,k}, ...], ...]
 * （i=cardIndex, s=slotName, k=slotKind；r=rarity 归一前的原始记号） */
"use strict";
const path = require("path");
const engine = require(path.join(__dirname, "..", "shared", "gacha.js"));

const [fixturePath, specPath, seedArg, packsArg] = process.argv.slice(2);
const cards = JSON.parse(require("fs").readFileSync(fixturePath, "utf8"));
const spec = JSON.parse(require("fs").readFileSync(specPath, "utf8"));
const rng = engine.mulberry32(Number(seedArg));
const pools = engine.buildPools(cards);

const packs = [];
for (let i = 0; i < Number(packsArg || 25); i++) {
  packs.push(engine.drawPack(cards, pools, spec, rng).map((c) => ({
    i: c.cardIndex, r: c.rarity, s: c.slotName, k: c.slotKind,
  })));
}
process.stdout.write(JSON.stringify(packs));
