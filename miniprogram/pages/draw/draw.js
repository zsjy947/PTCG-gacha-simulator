const store = require("../../utils/store.js");
const ui = require("../../utils/ui.js");
const data = require("../../utils/data.js");
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
    this.setData({
      stats: {
        packs: s.packs, cards: s.cards, rrUp,
        best: best || "—", bestColor: best ? ui.rarColor(best) : "",
        spend: ui.fmtMoney(spend),
      },
      distRows: rows.map((r) => ({
        rarity: r, count: s.rarities[r],
        color: ui.rarColor(r), pct: Math.round((s.rarities[r] / max) * 100),
      })),
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
      return {
        label: sp.label, price: sp.price, note: sp.note,
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
    const expectSpecs = (cur.specs || []).map((sp) => ({
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
    this.setData({ expectShow: true, expectSpecs });
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
