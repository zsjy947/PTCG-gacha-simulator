#!/usr/bin/env node
/* 跨引擎对拍 JS 侧：node tests/parity_node.js <fixture.json> <spec.json> <seeds> [packs]
 * seeds 为逗号分隔的种子列表（如 "42,7,99"），对每个种子注入同种子 mulberry32
 * 连续抽 packs 包，输出 [[{i,r,s,k}, ...], ...] 的数组的数组（外层按 seeds 顺序）。
 * （i=cardIndex, s=slotName, k=slotKind；r=rarity 归一前的原始记号）
 * 兼容旧调用：单个种子等价单元素列表。 */
"use strict";
const path = require("path");
const engine = require(path.join(__dirname, "..", "shared", "gacha.js"));

const [fixturePath, specPath, seedsArg, packsArg] = process.argv.slice(2);
const cards = JSON.parse(require("fs").readFileSync(fixturePath, "utf8"));
const spec = JSON.parse(require("fs").readFileSync(specPath, "utf8"));
const seeds = String(seedsArg).split(",").map(Number);
const nPacks = Number(packsArg || 25);

/* 池构建一次、多种子复用（池内容与种子无关，逐位对拍不受影响） */
let _pools = null;
function poolsCache(cards) {
  if (!_pools) _pools = engine.buildPools(cards);
  return _pools;
}

const all = seeds.map((seed) => {
  const rng = engine.mulberry32(seed);
  const packs = [];
  for (let i = 0; i < nPacks; i++) {
    packs.push(engine.drawPack(cards, poolsCache(cards), spec, rng).map((c) => ({
      i: c.cardIndex, r: c.rarity, s: c.slotName, k: c.slotKind,
    })));
  }
  return packs;
});
process.stdout.write(JSON.stringify(all));
