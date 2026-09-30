const store = require("../../utils/store.js");
const ui = require("../../utils/ui.js");
const data = require("../../utils/data.js");
const gacha = require("../../utils/gacha.js");
const img = require("../../utils/img.js");

const BOX_SIZE = 30;

Page({
  data: {
    theme: "dark",
    version: "",
    /* 弹包选择抽屉 */
    showPicker: false,
    searchText: "",
    groups: [],
    /* 当前弹 */
    current: null,
    heroSpecs: [],
    specRows: [],
    expandSpec: "",
    specKey: "",
    drawable: false,
    /* 统计 */
    stats: { packs: 0, cards: 0, rrUp: 0, best: "—", bestColor: "", spend: "0" },
    distRows: [],
    /* 拆卡记录 */
    history: [],
    autoflip: false,
    /* 开包流程 */
    drawState: null, // {spec, stage, packs, packIdx, flipped: [[bool]], recorded: [bool], view, glow: [bool]}
    boxSummary: null,
    packPages: [],
    /* 弹窗 */
    probShow: false,
    probSpecs: [],
    expectShow: false,
    expectSpecs: [],
    expectTab: "single",
    collect: { inited: false, kind: "rarity", rarityIdx: 0, rarityOpts: [] },
    collectRunning: false,
    collectRarityNames: [],
    collectLabel: "",
    collectHead: [],
    collectSpecs: [],
    collectNote: "",
    /* 图片失败占位（utils/img） */
    failMap: {},
    bustMap: {},
    /* 详情组件 */
    detailShow: false,
    detailSet: "",
    detailIdx: "",
    detailName: "",
    detailRarity: "",
  },

  onLoad() {
    const app = getApp();
    const sets = data.allSets();
    const order = ["补充包", "收集啦151", "宝石包", "嗨皮系列", "对战派对",
      "大师战略卡组", "起始卡组", "专题包", "礼盒·套装", "特典卡"];
    const byGroup = {};
    for (const s of sets) (byGroup[s.group] = byGroup[s.group] || []).push(s);
    const groups = [];
    for (const g of order) if (byGroup[g]) groups.push({ group: g, sets: byGroup[g] });
    for (const g of Object.keys(byGroup)) if (!order.includes(g)) groups.push({ group: g, sets: byGroup[g] });
    for (const g of groups) for (const s of g.sets) s.icon = data.iconURL(s.code);

    const history = (store.get("ptcg_history", []) || []).map((r) => ({
      ...r,
      timeText: new Date(r.time).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }),
      cards: (r.flat || []).map((c) => ({
        ...c,
        image: data.imgURL(c.setCode, c.cardIndex),
        rarityColor: ui.rarColor(c.rarity),
      })),
    }));

    this.setData({
      theme: app.globalData.theme,
      version: app.globalData.version,
      groups,
      history,
      autoflip: store.get("ptcg_autoflip", false) === true,
    });
    const lastId = store.get("ptcg_current_set", "");
    const last = sets.find((s) => s.id === lastId);
    if (last) this.selectSet(last.id, true);
  },

  onShow() {
    this.setData({ theme: getApp().globalData.theme });
  },

  onUnload() { this.clearFlipTimers(); },

  clearFlipTimers() {
    (this._flipTimers || []).forEach(clearTimeout);
    this._flipTimers = [];
  },

  /* ---------------- 图片失败占位 ---------------- */
  onImgError(e) { img.onError(this, e); },
  onImgRetry(e) { img.retry(this, e); },

  /* ---------------- 弹包选择 ---------------- */
  togglePicker() { this.setData({ showPicker: !this.data.showPicker }); },
  onSearch(e) {
    const kw = e.detail.value.trim().toLowerCase();
    this.setData({ searchText: kw });
    const groups = this.data.groups.map((g) => {
      const sets = g.sets.map((s) => {
        const hit = !kw || s.name.toLowerCase().includes(kw) || s.code.toLowerCase().includes(kw);
        return { ...s, hidden: !hit };
      });
      return { ...g, sets, allHidden: sets.every((s) => s.hidden) };
    });
    this.setData({ groups });
  },

  selectSet(id, silent) {
    const s = data.allSets().find((x) => x.id === id);
    if (!s) return;
    store.set("ptcg_current_set", id);
    const dflt = (s.specs || []).find((x) => x.default) || (s.specs || [])[0];
    // 下拉手风琴：全宽规格行，展开后 单包/十连/整盒（整盒按真实盒规抽数，无盒规不提供）
    const specRows = [];
    for (const sp of s.specs || []) {
      const l = sp.label || "";
      const rowLabel = l.includes("瘦包") ? "瘦包" : l.includes("肥包") ? "肥包" : l;
      specRows.push({
        key: sp.key,
        label: rowLabel,
        note: sp.note || sp.label,
        price: sp.price || "",
        kind: this.specKind(sp),
        boxPacks: sp.boxPacks || 0,
      });
    }
    this.setData({
      showPicker: false,
      current: s,
      specKey: dflt ? dflt.key : "",
      expandSpec: "",
      heroSpecs: (s.specs || []).map((sp) => `${sp.label}${sp.price ? " " + sp.price : ""}`),
      specRows,
      drawable: !!(s.specs || []).length,
    });
    this.renderStats();
    if (!silent) wx.vibrateShort({ type: "light", fail: () => {} });
  },

  specKind(sp) {
    if (sp.packSize >= 20) return "fat";
    if (sp.packSize >= 10) return "pack";
    if (sp.packSize <= 1) return "reward";
    if ((sp.note || "").includes("全闪") || (sp.label || "").includes("宝石")) return "gem";
    return "single";
  },

  /* ---------------- 统计 / 消费 / 分布 ---------------- */
  renderStats() {
    const cur = this.data.current;
    if (!cur) return;
    const all = store.get("ptcg_stats", {});
    const s = all[cur.id] || { packs: 0, cards: 0, rarities: {} };
    const rrUp = ui.RARITY_ORDER.slice(0, ui.RARITY_ORDER.indexOf("RR") + 1)
      .reduce((a, r) => a + (s.rarities[r] || 0), 0);
    const best = ui.bestRarity(s.rarities);
    const spend = (store.get("ptcg_spend", {})[cur.id] || {}).money || 0;
    const rows = ui.RARITY_ORDER.filter((r) => s.rarities[r]);
    const max = Math.max(1, ...rows.map((r) => s.rarities[r]));

    /* 实测对照（T2）：出货分布叠加理论值灰色基准条 + 对照表（与 exe 端文案一致） */
    const cmp = { show: s.packs > 0, enough: s.packs >= 30, rows: [], note: "" };
    const sp = (cur.specs || []).find((x) => x.key === this.data.specKey) || (cur.specs || [])[0];
    let markOf = () => 0;
    if (cmp.show && sp) {
      const profiles = data.rarityProfile(cur.id, sp);
      const p0 = profiles[0];
      const eTotal = Object.values(p0.expectedCount).reduce((a, b) => a + b, 0);
      markOf = (r) => Math.round((p0.expectedCount[r] / eTotal * s.cards) / max * 100);
      if (cmp.enough) {
        cmp.rows = Object.keys(p0.expectedCount)
          .sort((a, b) => ui.RARITY_ORDER.indexOf(a) - ui.RARITY_ORDER.indexOf(b))
          .map((r) => {
            const act = s.rarities[r] || 0;
            const actShare = s.cards ? act / s.cards : 0;
            const expShare = p0.expectedCount[r] / eTotal;
            const dev = actShare - expShare;
            return {
              rarity: r, color: ui.rarColor(r), count: act,
              actPct: (actShare * 100).toFixed(2) + "%",
              expPct: (expShare * 100).toFixed(2) + "%",
              devText: (dev >= 0 ? "+" : "−") + (Math.abs(dev) * 100).toFixed(2) + "%",
              up: dev >= 0,
            };
          });
        cmp.note = "偏差来自随机波动与划档模型近似，不构成概率修正依据。";
        if (profiles.length > 1) cmp.note += "多变体规格按首变体口径。";
      }
    }
    const distRows = rows.map((r) => ({
      rarity: r, count: s.rarities[r],
      color: ui.rarColor(r), pct: Math.round((s.rarities[r] / max) * 100),
      mark: markOf(r),
    }));
    this.setData({
      stats: {
        packs: s.packs, cards: s.cards, rrUp,
        best: best || "—", bestColor: best ? ui.rarColor(best) : "",
        spend: ui.fmtMoney(spend),
      },
      distRows,
      cmp,
    });
  },

  addStats(setId, cards_, packCount) {
    const all = store.get("ptcg_stats", {});
    const s = all[setId] || { packs: 0, cards: 0, rarities: {} };
    s.packs += packCount;
    s.cards += cards_.length;
    for (const c of cards_) s.rarities[c.rarity || "N"] = (s.rarities[c.rarity || "N"] || 0) + 1;
    all[setId] = s;
    if (!store.set("ptcg_stats", all)) this.warnStorage();
  },

  addSpend(setId, spec, packCount) {
    if (store.get("ptcg_spend_enabled", true) !== true) return;
    if (!spec || !spec.priceCny) return;
    const all = store.get("ptcg_spend", {});
    const s = all[setId] || { money: 0, packs: 0 };
    s.money += spec.priceCny * packCount;
    s.packs += packCount;
    all[setId] = s;
    if (!store.set("ptcg_spend", all)) this.warnStorage();
  },

  /* 收藏按弹分键（ptcg_coll_<setId>）：微信单键 1MB 上限，全弹单键必然超限丢数据 */
  addColl(setId, cards_) {
    const key = `ptcg_coll_${setId}`;
    const box = store.get(key, {}) || {};
    for (const c of cards_) {
      const k = `${c.setCode}__${c.cardIndex}`;
      const e = box[k] || { name: c.cardName, rarity: c.rarity || "N", setCode: c.setCode, cardIndex: c.cardIndex, count: 0 };
      e.count += 1;
      box[k] = e;
    }
    if (!store.set(key, box)) this.warnStorage();
  },

  warnStorage() {
    wx.showToast({ title: "本地空间不足，数据可能未保存", icon: "none", duration: 3000 });
  },

  addHistory(spec, packs, flat) {
    const rec = {
      time: Date.now(), packs,
      setName: this.data.current ? this.data.current.name : "",
      specLabel: spec.label,
      money: spec && spec.priceCny ? spec.priceCny * packs : 0,
      flat,
    };
    const history = this.data.history;
    history.unshift({
      ...rec,
      timeText: new Date(rec.time).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }),
      cards: flat.map((c) => ({ ...c, image: data.imgURL(c.setCode, c.cardIndex), rarityColor: ui.rarColor(c.rarity) })),
    });
    if (history.length > 30) history.pop();
    this.setData({ history });
    if (!store.set("ptcg_history", history.map((h) => ({ ...h, cards: undefined, flat: h.flat })))) this.warnStorage();
  },

  /* ---------------- 开包 ---------------- */
  onSpecTap(e) {
    const key = e.currentTarget.dataset.key;
    const cur = this.data.current;
    if (!cur || !cur.specs || !cur.specs.length) return;
    if (key === "__prob") return this.openProbabilities();
    if (key === "__calc") return this.openExpectedCost();
    if (key.startsWith("__ten_")) {
      const sp = cur.specs.find((x) => x.key === key.slice(6));
      if (sp) this.startDraw(sp, 10);
      return;
    }
    if (key.startsWith("__box_")) {
      const sp = cur.specs.find((x) => x.key === key.slice(6));
      if (sp) this.startDraw(sp, sp.boxPacks || BOX_SIZE);
      return;
    }
    const sp = cur.specs.find((x) => x.key === key);
    if (sp) this.startDraw(sp, 1);
  },

  toggleSpec(e) {
    const key = e.currentTarget.dataset.key;
    this.setData({ expandSpec: this.data.expandSpec === key ? "" : key });
  },

  /* 页码分页：严格单行。≤7 包全显；更多时 1 … P-1 P P+1 … N 窗口 */
  buildPackPages(n, cur) {
    let nums;
    if (n <= 7) nums = Array.from({ length: n }, (_, i) => i + 1);
    else if (cur <= 3) nums = [1, 2, 3, 4, 5, "…", n];
    else if (cur >= n - 2) nums = [1, "…", n - 4, n - 3, n - 2, n - 1, n];
    else nums = [1, "…", cur - 1, cur, cur + 1, "…", n];
    return nums.map((p, i) => ({ t: p, k: (p === "…" ? "e" : "p") + i }));
  },

  updatePackPages() {
    const ds = this.data.drawState;
    if (!ds) return;
    this.setData({ packPages: this.buildPackPages(ds.packs.length, ds.packIdx + 1) });
  },

  /* 高稀有度光效：RR+ 与特款（无标记）发光 */
  rarClass(rarity) {
    const r = rarity || "N";
    const high = ui.RARITY_ORDER.indexOf(r) !== -1
      && ui.RARITY_ORDER.indexOf(r) <= ui.RARITY_ORDER.indexOf("RR");
    if (!high && r !== "无标记") return "";
    const safe = { "无标记": "sp", "●": "d1", "◆": "d2", "★": "d3", "★★": "d4", "★★★": "d5" }[r] || String(r).replace(/[^A-Za-z0-9]/g, "");
    return `rc-${safe}`;
  },

  decorate(pack) {
    return pack.map((c) => ({ ...c, rarClass: this.rarClass(c.rarity) }));
  },

  startDraw(spec, packs) {
    const cur = this.data.current;
    if (!cur || !spec) return;
    wx.vibrateShort({ type: "medium", fail: () => {} });
    const packsOut = data.drawPacks(cur.id, spec, packs);
    this.clearFlipTimers();
    let boxSummary = null;
    if (packsOut.length > 1) {
      const cnt = {};
      for (const p of packsOut) for (const c of p) cnt[c.rarity || "N"] = (cnt[c.rarity || "N"] || 0) + 1;
      const rrUp = ui.RARITY_ORDER.slice(0, ui.RARITY_ORDER.indexOf("RR") + 1)
        .reduce((a, r) => a + (cnt[r] || 0), 0);
      boxSummary = {
        count: packsOut.length,
        rrUp,
        best: ui.bestRarity(cnt) || "—",
        bestColor: ui.rarColor(ui.bestRarity(cnt) || ""),
        money: spec.priceCny ? ui.fmtMoney(spec.priceCny * packsOut.length) : "0",
        chips: ui.RARITY_ORDER.filter((r) => cnt[r]).map((r) => ({ r, n: cnt[r], color: ui.rarColor(r) })),
        theory: packsOut.length === (spec.boxPacks || 0) ? this.boxTheoryText(spec) : "",
      };
    }
    this.setData({
      boxSummary,
      specKey: spec.key,
      drawState: {
        spec,
        stage: "pack",
        view: this.decorate(packsOut[0]),
        packs: packsOut,
        packIdx: 0,
        flipped: packsOut.map((p) => p.map(() => false)),
        recorded: packsOut.map(() => false),
      },
    });
  },

  /* 整盒理论参照行（与 exe 端逐字一致；小程序端无卡价快照，不含回本段） */
  boxTheoryText(spec) {
    const profiles = data.boxProfile(this.data.current.id, spec);
    if (!profiles.length) return "";
    const eAvg = {}, pAvg = {};
    for (const p of profiles) {
      for (const [r, e] of Object.entries(p.expectedCount)) eAvg[r] = (eAvg[r] || 0) + e / profiles.length;
      for (const [r, q] of Object.entries(p.pAtLeastOne)) pAvg[r] = (pAvg[r] || 0) + q / profiles.length;
    }
    const keys = Object.keys(eAvg);
    const rrUpSet = ui.RARITY_ORDER.slice(0, ui.RARITY_ORDER.indexOf("RR") + 1);
    const rr = keys.reduce((a, r) => a + (rrUpSet.includes(r) ? eAvg[r] : 0), 0);
    let line = `理论：RR+ 期望 ${rr.toFixed(1)} 张`;
    /* 「最高期望稀有度」候选排除低展示档（与 exe 端 BOX_THEORY_LOW 一致） */
    const low = { C: 1, U: 1, N: 1, "●": 1, "◆": 1, "★": 1, "★★": 1, "★★★": 1, "无标记": 1 };
    const top = ui.RARITY_ORDER.find((r) => r in eAvg && eAvg[r] >= 0.05 && !low[r]);
    if (top) line += ` · ${top} 出现率 ${(pAvg[top] * 100).toFixed(1)}%`;
    return line;
  },

  burstPack() {
    const ds = this.data.drawState;
    if (!ds || ds.stage !== "pack") return;
    ds.stage = "cards";
    this.setData({ "drawState.stage": "cards" });
    setTimeout(() => { this.renderPackRow(); this.updatePackPages(); this.maybeAutoFlip(); }, 200);
  },

  renderPackRow() {
    const ds = this.data.drawState;
    if (!ds) return;
    this.setData({ "drawState.view": this.decorate(ds.packs[ds.packIdx]) });
  },

  maybeAutoFlip() {
    if (this.data.autoflip !== true) return;
    const ds = this.data.drawState;
    if (!ds) return;
    const pi = ds.packIdx;
    ds.packs[pi].forEach((_, i) => {
      const t = setTimeout(() => this.flipIndex(pi, i), 420 + i * 90);
      this._flipTimers.push(t);
    });
  },

  toggleAutoflip(e) {
    store.set("ptcg_autoflip", e.detail.value);
    this.setData({ autoflip: e.detail.value });
  },

  tapCard(e) {
    const { pi, i } = e.currentTarget.dataset;
    wx.vibrateShort({ type: "light", fail: () => {} });
    this.flipIndex(Number(pi), Number(i));
  },

  flipIndex(pi, i) {
    const ds = this.data.drawState;
    if (!ds || ds.packIdx !== pi || ds.flipped[pi][i]) return;
    ds.flipped[pi][i] = true;
    this.setData({ [`drawState.flipped[${pi}][${i}]`]: true });
    if (ds.flipped[pi].every(Boolean)) this.recordPack(pi);
  },

  flipAll() {
    const ds = this.data.drawState;
    if (!ds) return;
    const pi = ds.packIdx;
    const flips = {};
    ds.flipped[pi].forEach((v, i) => {
      if (!v) { ds.flipped[pi][i] = true; flips[`drawState.flipped[${pi}][${i}]`] = true; }
    });
    this.setData(flips);
    setTimeout(() => { if (ds.flipped[pi].every(Boolean)) this.recordPack(pi); }, 400);
  },

  recordPack(pi) {
    const ds = this.data.drawState;
    if (!ds || ds.recorded[pi]) return;
    ds.recorded[pi] = true;
    const cards_ = ds.packs[pi];
    this.addHistory(ds.spec, 1, cards_.map(({ image, rarClass, ...c }) => c));
    this.addStats(this.data.current.id, cards_, 1);
    this.addSpend(this.data.current.id, ds.spec, 1);
    this.addColl(this.data.current.id, cards_.map(({ image, rarClass, ...c }) => c));
    this.renderStats();
  },

  recordUnfinished() {
    const ds = this.data.drawState;
    if (!ds) return;
    ds.recorded.forEach((done, pi) => {
      if (!done) {
        ds.recorded[pi] = true;
        const cards_ = ds.packs[pi];
        this.addHistory(ds.spec, 1, cards_.map(({ image, rarClass, ...c }) => c));
        this.addStats(this.data.current.id, cards_, 1);
        this.addSpend(this.data.current.id, ds.spec, 1);
        this.addColl(this.data.current.id, cards_.map(({ image, rarClass, ...c }) => c));
      }
    });
    this.renderStats();
  },

  navPack(e) {
    this.jumpTo(this.data.drawState.packIdx + Number(e.currentTarget.dataset.d));
  },
  jumpPack(e) {
    this.jumpTo(Number(e.currentTarget.dataset.i));
  },
  jumpTo(idx) {
    const ds = this.data.drawState;
    if (!ds) return;
    this.clearFlipTimers();
    if (idx < 0 || idx >= ds.packs.length || idx === ds.packIdx) return;
    // 未翻完的包静默入账，保证统计不失真
    if (!ds.recorded[ds.packIdx]) this.recordPack(ds.packIdx);
    ds.packIdx = idx;
    this.setData({ "drawState.packIdx": idx });
    this.renderPackRow();
    this.updatePackPages();
    this.maybeAutoFlip();
  },

  closeDraw() {
    this.clearFlipTimers();
    this.recordUnfinished();
    this.setData({ drawState: null, boxSummary: null, packPages: [] });
  },

  againDraw() {
    const ds = this.data.drawState;
    const spec = ds && ds.spec;
    const n = ds ? ds.packs.length : 1;
    this.clearFlipTimers();
    this.recordUnfinished();
    this.setData({ drawState: null, boxSummary: null, packPages: [] });
    setTimeout(() => this.startDraw(spec, n), 200);
  },

  /* ---------------- 概率公示 / 期望计算 ---------------- */
  openProbabilities() {
    const cur = this.data.current;
    if (!cur) return;
    const probSpecs = (cur.specs || []).map((sp) => {
      const full = data.specProbabilities(cur.id, sp);
      const box = data.boxProfile(cur.id, sp).map((p) => ({
        note: p.note,
        rows: Object.keys(p.expectedCount)
          .sort((a, b) => ui.RARITY_ORDER.indexOf(a) - ui.RARITY_ORDER.indexOf(b))
          .map((r) => ({
            rarity: r, color: ui.rarColor(r),
            exp: p.expectedCount[r].toFixed(1),
            appear: (p.pAtLeastOne[r] * 100).toFixed(1) + "%",
          })),
      }));
      return {
        label: sp.label, price: sp.price, note: sp.note,
        box,
        variants: full.variants.map((v) => ({
          note: v.note,
          slots: v.slots.map((slot) => ({
            name: slot.name,
            kind: slot.kind,
            fallback: slot.fallback,
            lines: slot.probabilities.map((p) => ({
              rarity: p.rarity, color: ui.rarColor(p.rarity),
              pct: ui.probPct(p.p), pool: p.pool, width: (p.p * 100).toFixed(2) + "%",
            })),
          })),
        })),
      };
    });
    this.setData({ probShow: true, probSpecs });
  },

  openExpectedCost() {
    const cur = this.data.current;
    if (!cur) return;
    this.setData({
      expectShow: true, expectTab: "single",
      expectSpecs: this.buildExpectSingleRows(cur),
      collect: { inited: false, kind: "rarity", rarityIdx: 0, rarityOpts: [] },
      collectRunning: false,
      collectRarityNames: [], collectLabel: "", collectHead: [], collectSpecs: [], collectNote: "",
    });
  },

  /* 「单卡」页签：现有期望成本表 */
  buildExpectSingleRows(cur) {
    return (cur.specs || []).map((sp) => ({
      label: sp.label, price: sp.price, priceCny: sp.priceCny,
      rows: data.expectedCost(cur.id, sp).map((r) => ({
        ...r,
        color: ui.rarColor(r.rarity),
        pPackText: ui.probPct(r.pPack),
        anyText: Number.isFinite(r.anyPacks) ? Math.ceil(r.anyPacks) + " 包" : "—",
        cardText: Number.isFinite(r.cardPacks) ? Math.ceil(r.cardPacks) + " 包" : "—",
        moneyText: sp.priceCny && Number.isFinite(r.cardPacks)
          ? "¥" + ui.fmtMoney(Math.round(r.cardPacks * sp.priceCny)) : "—",
      })),
    }));
  },

  /* 「集齐」页签：目标三选一 → 逐规格期望包数/花费（与 exe 端文案一致） */
  onExpectTab(e) {
    const t = e.currentTarget.dataset.t;
    this.setData({ expectTab: t });
    if (t === "collect") this.initCollectPane();
  },

  initCollectPane() {
    const cur = this.data.current;
    if (!cur || this.data.collect.inited) return;
    const rarityOpts = data.poolRarities(cur.id)
      .sort((a, b) => ui.RARITY_ORDER.indexOf(a) - ui.RARITY_ORDER.indexOf(b));
    const collect = { inited: true, kind: this.data.collect.kind, rarityIdx: 0, rarityOpts };
    this.setData({
      collect,
      collectRarityNames: rarityOpts.map((x) => `${ui.rarLabel(x.rarity)}（${x.size} 张）`),
    });
    this.runCollect();
  },

  onCollectKind(e) {
    const collect = { ...this.data.collect, kind: e.detail.value };
    this.setData({ collect });
    this.runCollect();
  },

  onCollectRarity(e) {
    const collect = { ...this.data.collect, rarityIdx: Number(e.detail.value) };
    this.setData({ collect });
    if (collect.kind === "rarity") this.runCollect();
  },

  applyCollectResult(label, results, simMode, extra = "") {
    const specs = this.data.current.specs || [];
    this.setData({
      collectRunning: false,
      collectLabel: label,
      collectHead: simMode ? ["规格", "期望包数", "期望花费", "中位 / P90"] : ["规格", "期望包数", "期望花费"],
      collectSpecs: results.map((res, i) => ({
        label: specs[i] ? specs[i].label : "",
        packs: res.expectedPacks != null ? res.expectedPacks.toFixed(1) + " 包" : "—",
        money: res.expectedSpend != null ? "¥" + ui.fmtMoney(Math.round(res.expectedSpend)) : "—",
        extra: simMode ? (res.expectedPacks != null ? `中位 ${res.medianPacks} · P90 ${res.p90Packs} 包` : "—") : "",
      })),
      collectNote: results[0] && results[0].note ? results[0].note + extra : "",
    });
  },

  cancelCollect() {
    this._ctRun = (this._ctRun || 0) + 1;
    this.setData({
      collectRunning: false,
      collectLabel: "已取消计算，可重新选择目标再算。",
      collectSpecs: [], collectNote: "",
    });
  },

  /* 缺卡目标可能极大：按闭式估计（各目标稀有度 Tier 集齐期望包数取最大）把试验数压进
   * 固定包数预算（只依赖目标构成、不看墙钟，同种子重复计算仍逐位一致；与 exe 端
   * collectSimPlan 同参数）。下限 12 次保证中位/P90 可读，上限 300 保持小目标精度。 */
  collectSimPlan(spec, targets) {
    const BUDGET_PACKS = 8000, MIN_TRIALS = 12, MAX_TRIALS = 300;
    let est = 0;
    try {
      const perRarity = {};
      const byKey = new Map();
      for (const c of data.cards(this.data.current.id)) byKey.set(`${c.setCode}__${c.cardIndex}`, c);
      for (const k of (targets.keys || [])) {
        const cd = byKey.get(k);
        if (cd) perRarity[cd.rarity || "N"] = (perRarity[cd.rarity || "N"] || 0) + 1;
      }
      const sizes = Object.fromEntries(data.poolRarities(this.data.current.id).map((x) => [x.rarity, x.size]));
      const profile = data.rarityProfile(this.data.current.id, spec)[0] || { expectedCount: {} };
      for (const [r, n] of Object.entries(perRarity)) {
        const poolSize = sizes[r] || 0;
        const lambda = profile.expectedCount[r] || 0;
        if (lambda <= 0 || !poolSize) return { trials: MIN_TRIALS, batch: 1 };
        let h = 0;
        for (let k = 1; k <= n; k++) h += 1 / k;
        est = Math.max(est, (poolSize * h) / lambda);
      }
    } catch (e) { est = 0; }
    const trials = est > 0
      ? Math.max(MIN_TRIALS, Math.min(MAX_TRIALS, Math.round(BUDGET_PACKS / est)))
      : MAX_TRIALS;
    return { trials, batch: est > 300 ? 1 : 3 };
  },

  runCollect() {
    const cur = this.data.current;
    if (!cur || !this.data.collect.inited) return;
    const c = this.data.collect;
    let targets, label, empty = "";
    if (c.kind === "rrup") {
      const rs = ui.RARITY_ORDER.slice(0, ui.RARITY_ORDER.indexOf("RR") + 1)
        .filter((r) => c.rarityOpts.some((x) => x.rarity === r));
      targets = { kind: "rarity", rarities: rs };
      label = `集齐 RR+ 及以上（${rs.length} 档全部卡）`;
    } else if (c.kind === "missing") {
      const box = store.get(`ptcg_coll_${cur.id}`, {}) || {};
      const keys = data.cards(cur.id)
        .filter((x) => !box[`${x.setCode}__${x.cardIndex}`])
        .map((x) => `${x.setCode}__${x.cardIndex}`);
      if (!keys.length) {
        empty = "收藏册该弹暂无缺卡（可能还没收藏记录，先去拆卡吧）";
      } else {
        targets = { kind: "cards", keys };
        label = `集齐收藏册缺卡（${keys.length} 张）`;
      }
    } else {
      const opt = c.rarityOpts[c.rarityIdx];
      if (!opt) { empty = "请选择目标稀有度"; } else {
        targets = { kind: "rarity", rarities: [opt.rarity] };
        label = `集齐 ${opt.rarity} 全部（${opt.size} 张）`;
      }
    }
    if (empty) {
      this.setData({ collectRunning: false, collectLabel: empty, collectHead: [], collectSpecs: [], collectNote: "" });
      return;
    }
    const simMode = targets.kind === "cards";
    if (!simMode) {
      // 闭式公式：毫秒级，同步算完
      wx.showLoading({ title: "计算中…", mask: true });
      setTimeout(() => {
        const results = (cur.specs || []).map((sp) =>
          data.collectExpectation(cur.id, sp, targets, { trials: 300, packCap: 3000 }));
        wx.hideLoading();
        this.applyCollectResult(label, results, false);
      }, 50);
      return;
    }
    /* 卡集合目标（蒙特卡洛）：引擎分批执行（collectSimBatched，与 exe 端同款），
     * 批间让出主线程——页面不卡死；点提示文字或关闭弹窗即取消；试验数逐规格自适应 */
    this._ctRun = (this._ctRun || 0) + 1;
    const runId = this._ctRun;
    const plans = (cur.specs || []).map((sp) => this.collectSimPlan(sp, targets));
    const pools = gacha.buildPools(data.cards(cur.id));
    const runners = (cur.specs || []).map((sp, i) =>
      gacha.collectSimBatched(sp, pools, targets, { trials: plans[i].trials, packCap: 3000, batch: plans[i].batch }));
    const total = runners.reduce((a, r) => a + r.trials, 0);
    const results = [];
    this.setData({
      collectRunning: true,
      collectLabel: `计算中：已算 0/${total} 次试验（点此取消）`,
      collectHead: [], collectSpecs: [], collectNote: "",
    });
    const step = () => {
      if (runId !== this._ctRun || !this.data.expectShow) return; // 已取消或弹窗已关
      const i = results.length;
      const r = runners[i];
      const st = r.next();
      if (!st.finished) {
        const doneBase = plans.slice(0, i).reduce((a, p) => a + p.trials, 0);
        this.setData({ collectLabel: `计算中：已算 ${doneBase + st.done}/${total} 次试验（点此取消）` });
        setTimeout(step, 0);
        return;
      }
      results.push(st.result);
      if (results.length < runners.length) { setTimeout(step, 0); return; }
      const parts = [`各规格模拟 ${plans.map((p) => p.trials).join("/")} 次试验`];
      if (runners[0].filtered) parts.push(`${runners[0].filtered} 张不在本弹卡表已忽略`);
      this.applyCollectResult(label, results, true, `（${parts.join("；")}）`);
    };
    setTimeout(step, 0);
  },

  closeProb() { this.setData({ probShow: false }); },
  closeExpect() { this.setData({ expectShow: false }); },
  noop() {},

  /* ---------------- 详情 / 记录 ---------------- */
  showDetail(e) {
    const { set, idx, name, rarity } = e.currentTarget.dataset;
    this.setData({
      detailShow: true, detailSet: set, detailIdx: idx,
      detailName: name || "", detailRarity: rarity || "N",
    });
  },
  closeDetail() { this.setData({ detailShow: false }); },
});
