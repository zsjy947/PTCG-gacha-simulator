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

  /* 每包稀有度画像（确定性，无随机数）。变体规格（如太晶盛聚 7+3/6+4）逐变体返回。
   * p(slot=r) 复用 normalizeWeights；权重稀有度全部缺失的兜底槽位退化为整弹均匀抽
   * （与 specProbabilities 的 fallback 口径一致；Python 侧经 _slot_probs 套用按弹覆盖，
   *   SET_SPEC_OVERRIDES 目前为空，两端同源）。浮点累加顺序两端逐行一致（对拍逐位断言）。 */
  function rarityProfile(spec, pools) {
    const available = Object.keys(pools);
    const total = Object.values(pools).reduce((a, l) => a + l.length, 0);
    const variants = spec.variants || [{ note: spec.note || "", slots: spec.slots }];
    return variants.map((v) => {
      const expectedCount = {}, pAppear = {};
      for (const r of available) { expectedCount[r] = 0; pAppear[r] = 0; }
      for (const slot of v.slots) {
        const probs = normalizeWeights(slot.weights, available);
        for (const r of available) {
          const p = probs ? (probs[r] || 0) : (total ? pools[r].length / total : 0);
          expectedCount[r] = expectedCount[r] + p;
          pAppear[r] = 1 - (1 - pAppear[r]) * (1 - p);
        }
      }
      return { note: v.note || "", expectedCount, pAppear };
    });
  }

  /* 整盒理论画像：boxPacks 缺省视为无整盒商品 → 返回 []（概率公示/汇总条据此不渲染）。
   * pAtLeastOne 用连乘而非 pow，保证与 Python 镜像逐位一致。 */
  function boxProfile(spec, pools) {
    if (!spec.boxPacks) return [];
    const n = spec.boxPacks;
    return rarityProfile(spec, pools).map((v) => {
      const expectedCount = {}, pAtLeastOne = {};
      for (const r of Object.keys(v.expectedCount)) {
        let miss = 1;
        for (let i = 0; i < n; i++) miss = miss * (1 - v.pAppear[r]);
        expectedCount[r] = v.expectedCount[r] * n;
        pAtLeastOne[r] = 1 - miss;
      }
      return { note: v.note, boxPacks: n, expectedCount, pAtLeastOne };
    });
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

  /* 调和数 H_n（闭式集齐期望用；累加顺序与 Python 镜像逐行一致） */
  function harmonicNumber(n) {
    let h = 0;
    for (let k = 1; k <= n; k++) h += 1 / k;
    return h;
  }

  /* 多目标「集齐期望」：目标只认显式集合（"RR+"等口径由前端解析后传入）。
   * - { kind:"rarity", rarities:[...] } 集齐这些稀有度池的全部卡 → 闭式公式 n·H_n/λ
   *   （λ = 单包期望目标张数；变体规格每包等概率落位 → 对变体取平均，包内去重影响忽略，
   *    与 expectedCost 同一口径）
   * - { kind:"cards", keys:[...] } 集齐指定卡（cardKey 格式）→ 固定种子蒙特卡洛：
   *   mulberry32(seed) 逐试验顺序模拟，每试验复用 drawPack 逐包开、集齐即止并记录包数，
   *   超 packCap 记未完成；期望/中位/P90 仅统计已完成试验（note 注明口径）。
   *   卡列表由 pools 按 key 序展开（两端实现逐行一致，保证同种子逐位对拍）。
   * opts: { trials=300, packCap=3000, seed=0xC011EC7 } */
  function collectExpectation(spec, pools, targets, opts) {
    const o = Object.assign({ trials: 300, packCap: 3000, seed: 0xC011EC7 }, opts || {});
    const variants = spec.variants || [{ note: spec.note || "", slots: spec.slots }];

    if (targets && targets.kind === "rarity") {
      const wanted = (targets.rarities || []).filter((r) => pools[r] && pools[r].length);
      const n = wanted.reduce((a, r) => a + pools[r].length, 0);
      const available = Object.keys(pools);
      const total = Object.values(pools).reduce((a, l) => a + l.length, 0);
      let lambda = 0;
      for (const v of variants) {
        for (const slot of v.slots) {
          const probs = normalizeWeights(slot.weights, available);
          for (const r of wanted) {
            lambda += probs ? (probs[r] || 0) : (total ? pools[r].length / total : 0);
          }
        }
      }
      if (variants.length > 1) lambda /= variants.length;
      const h = harmonicNumber(n);
      const expectedPacks = n && lambda > 0 ? (n * h) / lambda : null;
      return {
        mode: "closed",
        expectedPacks,
        expectedSpend: expectedPacks != null && spec.priceCny ? expectedPacks * spec.priceCny : null,
        formula: "nHn/lambda",
      };
    }

    const cardList = [];
    for (const r of Object.keys(pools)) for (const c of pools[r]) cardList.push(c);
    const keySet = new Set(cardList.map(cardKey));
    const rawKeys = (targets && targets.keys) || [];
    const wantedKeys = rawKeys.filter((k) => keySet.has(k));
    const out = {
      mode: "sim",
      expectedPacks: null, medianPacks: null, p90Packs: null,
      completedRatio: 0,
      packCap: o.packCap,
      expectedSpend: null,
      note: `仅统计 ${o.packCap} 包内集齐的试验，完成率 0.0%`,
      filtered: rawKeys.length - wantedKeys.length,
    };
    if (!wantedKeys.length) return out;

    const rng = mulberry32(o.seed);
    const done = [];
    for (let t = 0; t < o.trials; t++) {
      const remaining = new Set(wantedKeys);
      for (let p = 1; p <= o.packCap; p++) {
        const pack = drawPack(cardList, pools, spec, rng);
        for (const c of pack) remaining.delete(cardKey(c));
        if (!remaining.size) { done.push(p); break; }
      }
    }
    const completed = done.length;
    out.completedRatio = completed / o.trials;
    if (completed) {
      done.sort((a, b) => a - b);
      out.expectedPacks = done.reduce((a, b) => a + b, 0) / completed;
      out.medianPacks = done[Math.floor((completed - 1) / 2)];
      out.p90Packs = done[Math.floor((completed - 1) * 0.9)];
      out.expectedSpend = spec.priceCny ? out.expectedPacks * spec.priceCny : null;
      out.note = `仅统计 ${o.packCap} 包内集齐的试验，完成率 ${(out.completedRatio * 100).toFixed(1)}%`;
    }
    return out;
  }

  return {
    RARITY_ALIAS, mulberry32,
    buildPools, normalizeWeights, pickRarity, pickCard,
    drawPack, drawPacks, specProbabilities, expectedCost,
    rarityProfile, boxProfile, collectExpectation,
  };
});
