/* PTCG 简中拆卡引擎 —— 唯一权威实现。
 *
 * 浏览器（exe / 安卓 APK）/ Node / 微信小程序通用：
 *   - 浏览器：window.PTCGGacha
 *   - Node / 小程序：module.exports
 *
 * 约定：规格（spec）由 config.py 导出的元数据提供（含 slots / variants / weights），
 *       本引擎不内嵌任何弹配置，保证 Python 与 JS 概率行为同源。
 *       所有随机入口都接受可选 rng（返回 [0,1) 浮点的函数），默认 Math.random；
 *       注入同种子 rng 即可做 Python↔JS 逐卡对拍（见 tests/）。
 */
"use strict";

(function (root, factory) {
  if (typeof module === "object" && typeof module.exports === "object") {
    module.exports = factory();
  } else {
    root.PTCGGacha = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  /* 宝石包等商品的符号稀有度 → 标准稀有度（仅用于卡池归类与概率计算） */
  const RARITY_ALIAS = {
    "●": "C", "○": "C",
    "◆": "U", "◇": "U",
    "★": "R", "★★": "RR", "★★★": "SAR",
  };

  /* 可复现随机源（与 tests/mulberry.py 实现逐位一致，用于跨引擎对拍） */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* 按稀有度分池；符号稀有度先映射为标准稀有度（卡面展示仍保留原始记号） */
  function buildPools(cards) {
    const pools = {};
    for (const c of cards) {
      const r = c.rarity || "N";
      const k = RARITY_ALIAS[r] || r;
      (pools[k] = pools[k] || []).push(c);
    }
    return pools;
  }

  /* 仅保留池中存在的稀有度并归一化；全部缺失返回 null（槽位退化为整弹均匀抽） */
  function normalizeWeights(weights, available) {
    const w = Object.entries(weights).filter(([r, v]) => available.includes(r) && v > 0);
    if (!w.length) return null;
    const total = w.reduce((a, [, v]) => a + v, 0);
    return Object.fromEntries(w.map(([r, v]) => [r, v / total]));
  }

  function pickRarity(probs, rng) {
    let roll = (rng || Math.random)(), acc = 0;
    for (const [r, p] of Object.entries(probs)) { acc += p; if (roll <= acc) return r; }
    return Object.keys(probs).pop();
  }

  function cardKey(c) { return `${c.setCode}__${c.cardIndex}`; }

  /* 按稀有度池均匀抽卡；包内已出现的卡不再出现（同稀有度池去重，池耗尽退回整弹去重） */
  function pickCard(pools, rarity, cards, used, rng) {
    const rand = rng || Math.random;
    let src = rarity ? (pools[rarity] && pools[rarity].length ? pools[rarity] : cards) : cards;
    if (used) {
      let fresh = src.filter((c) => !used.has(cardKey(c)));
      if (!fresh.length) fresh = cards.filter((c) => !used.has(cardKey(c)));
      if (fresh.length) src = fresh;
    }
    return { ...src[Math.floor(rand() * src.length)] };
  }

  /* 开一包：规格含多个封入变体时（如太晶盛聚 7+3/6+4），每包随机落位 */
  function drawPack(cards, pools, spec, rng) {
    const variants = spec.variants || [{ note: spec.note || "", slots: spec.slots }];
    const v = variants[Math.floor((rng || Math.random)() * variants.length)];
    const available = Object.keys(pools);
    const used = new Set();
    return v.slots.map((slot) => {
      const probs = normalizeWeights(slot.weights, available);
      const card = pickCard(pools, probs ? pickRarity(probs, rng) : null, cards, used, rng);
      used.add(cardKey(card));
      card.slotName = slot.name;
      card.slotKind = slot.kind;
      return card;
    });
  }

  /* 开 packs 包（pools 未传时内部构建） */
  function drawPacks(cards, spec, packs, rng) {
    const pools = buildPools(cards);
    const out = [];
    for (let i = 0; i < packs; i++) out.push(drawPack(cards, pools, spec, rng));
    return out;
  }

  /* 某规格的概率表（含封入变体，供「概率公示」展示） */
  function specProbabilities(spec, pools) {
    const slotTable = (slots) => slots.map((slot) => {
      const probs = normalizeWeights(slot.weights, Object.keys(pools)) || {};
      return {
        name: slot.name, kind: slot.kind, fallback: !probs,
        probabilities: Object.entries(probs)
          .map(([r, p]) => ({ rarity: r, p, pool: (pools[r] || []).length }))
          .sort((a, b) => b.p - a.p),
      };
    });
    const variants = spec.variants || [{ note: spec.note || "", slots: spec.slots }];
    return {
      id: spec.id, label: spec.label, note: spec.note, price: spec.price,
      packSize: variants[0].slots.length,
      variants: variants.map((v) => ({ note: v.note, slots: slotTable(v.slots) })),
    };
  }

  /* 某规格每个稀有度的期望成本（目标卡计算器）：
   * pPack  = 单包至少出 1 张该稀有度的概率（变体按等概率平均）
   * anyPacks = 抽到任意一张该稀有度的期望包数 = 1 / pPack
   * cardPacks = 抽到「指定某一张卡」的期望包数 ≈ anyPacks × 该稀有度池大小
   * 包内去重对期望的影响在包远小于池时忽略不计。 */
  function expectedCost(spec, pools) {
    const variants = spec.variants || [{ note: spec.note || "", slots: spec.slots }];
    const available = Object.keys(pools);
    const total = Object.values(pools).reduce((a, l) => a + l.length, 0);
    return Object.keys(pools).map((r) => {
      let hit = 0;
      for (const v of variants) {
        let miss = 1;
        for (const slot of v.slots) {
          const probs = normalizeWeights(slot.weights, available);
          // 兜底槽位（权重稀有度全部缺失）退化为整弹均匀抽
          const p = probs ? (probs[r] || 0) : total ? ((pools[r] || []).length / total) : 0;
          miss *= 1 - p;
        }
        hit += 1 - miss;
      }
      const pPack = hit / variants.length;
      const anyPacks = pPack > 0 ? 1 / pPack : Infinity;
      const pool = (pools[r] || []).length;
      return {
        rarity: r,
        pPack, pool,
        anyPacks,
        cardPacks: pool ? anyPacks * pool : Infinity,
      };
    }).sort((a, b) => b.pPack - a.pPack);
  }

  return {
    RARITY_ALIAS, mulberry32,
    buildPools, normalizeWeights, pickRarity, pickCard,
    drawPack, drawPacks, specProbabilities, expectedCost,
  };
});
