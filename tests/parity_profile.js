#!/usr/bin/env node
/* 确定性画像对拍 JS 侧：node tests/parity_profile.js <cards.json> <spec.json>
 * 输出 JSON.stringify({ rarityProfile, boxProfile })，与 Python 镜像
 * （gacha.rarity_profile / gacha.box_profile）断言完全相等（tests/test_consistency.py）。 */
"use strict";
const path = require("path");
const engine = require(path.join(__dirname, "..", "shared", "gacha.js"));

const [cardsPath, specPath] = process.argv.slice(2);
const cards = JSON.parse(require("fs").readFileSync(cardsPath, "utf8"));
const spec = JSON.parse(require("fs").readFileSync(specPath, "utf8"));
const pools = engine.buildPools(cards);
process.stdout.write(JSON.stringify({
  rarityProfile: engine.rarityProfile(spec, pools),
  boxProfile: engine.boxProfile(spec, pools),
}));
