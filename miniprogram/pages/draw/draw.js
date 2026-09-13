const store = require("../../utils/store.js");
const ui = require("../../utils/ui.js");
const data = require("../../utils/data.js");

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
    specButtons: [],
    /* 统计 */
    stats: { packs: 0, cards: 0, rrUp: 0, best: "—", bestColor: "", spend: "0" },
    /* 拆卡记录 */
    history: [],
    /* 开包流程 */
    drawState: null, // {specLabel, packs, packIdx, flipped: [[bool]], stage, packSummary, boxSummary}
    /* 弹窗 */
    probShow: false,
    probSpecs: [],
    expectShow: false,
    expectSpecs: [],
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
      cards: (r.flat || []).map((c) => ({ ...c, image: data.imgURL(c.setCode, c.cardIndex) })),
    }));

    this.setData({
      theme: app.globalData.theme,
      version: app.globalData.version,
      groups,
      history,
    });
    const lastId = store.get("ptcg_current_set", "");
    const last = sets.find((s) => s.id === lastId);
    if (last) this.selectSet(last.id, true);
  },

  onShow() {
    this.setData({ theme: getApp().globalData.theme });
  },

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
    const specButtons = [];
    for (const sp of s.specs || []) {
      specButtons.push({ key: sp.key, label: `开包 · ${sp.short}`, sub: sp.note || sp.label, kind: this.specKind(sp) });
    }
    const dflt = (s.specs || []).find((x) => x.default) || (s.specs || [])[0];
    if (dflt) {
      specButtons.push({ key: "__ten", label: "十连", sub: `10 包 · ${dflt.short}`, kind: "ten" });
      if (["sm5", "sm25", "sv5", "sv20"].includes(dflt.key)) {
        specButtons.push({ key: "__box", label: "整盒", sub: `30 包 · ${dflt.short} · 汇总`, kind: "box" });
      }
    }
    specButtons.push({ key: "__calc", label: "目标卡计算", sub: "期望包数/花费", kind: "ghost" });
    specButtons.push({ key: "__prob", label: "概率公示", sub: "划档概率透明", kind: "ghost" });
    this.setData({
      showPicker: false,
      current: s,
      heroSpecs: (s.specs || []).map((sp) => `${sp.label}${sp.price ? " · " + sp.price : ""}`),
      specButtons,
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

  /* ---------------- 统计 / 消费 ---------------- */
  renderStats() {
    const cur = this.data.current;
    if (!cur) return;
    const all = store.get("ptcg_stats", {});
    const s = all[cur.id] || { packs: 0, cards: 0, rarities: {} };
    const rrUp = ui.RARITY_ORDER.slice(0, ui.RARITY_ORDER.indexOf("RR") + 1)
      .reduce((a, r) => a + (s.rarities[r] || 0), 0);
    const best = ui.bestRarity(s.rarities);
    const spend = (store.get("ptcg_spend", {})[cur.id] || {}).money || 0;
    this.setData({
      stats: {
        packs: s.packs, cards: s.cards, rrUp,
        best: best || "—", bestColor: best ? ui.rarColor(best) : "",
        spend: ui.fmtMoney(spend),
      },
    });
  },

  addStats(setId, cards_, packCount) {
    const all = store.get("ptcg_stats", {});
    const s = all[setId] || { packs: 0, cards: 0, rarities: {} };
    s.packs += packCount;
    s.cards += cards_.length;
    for (const c of cards_) s.rarities[c.rarity || "N"] = (s.rarities[c.rarity || "N"] || 0) + 1;
    all[setId] = s;
    store.set("ptcg_stats", all);
  },

  addSpend(setId, spec, packCount) {
    if (store.get("ptcg_spend_enabled", true) !== true) return;
    if (!spec || !spec.priceCny) return;
    const all = store.get("ptcg_spend", {});
    const s = all[setId] || { money: 0, packs: 0 };
    s.money += spec.priceCny * packCount;
    s.packs += packCount;
    all[setId] = s;
    store.set("ptcg_spend", all);
  },

  addColl(setId, cards_) {
    const coll = store.get("ptcg_coll", {});
    const box = coll[setId] || {};
    for (const c of cards_) {
      const k = `${c.setCode}__${c.cardIndex}`;
      const e = box[k] || { name: c.cardName, rarity: c.rarity || "N", setCode: c.setCode, cardIndex: c.cardIndex, count: 0 };
      e.count += 1;
      box[k] = e;
    }
    coll[setId] = box;
    store.set("ptcg_coll", coll);
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
    store.set("ptcg_history", history.map((h) => ({ ...h, cards: undefined, flat: h.flat })));
  },

  /* ---------------- 开包 ---------------- */
  onSpecTap(e) {
    const key = e.currentTarget.dataset.key;
    const cur = this.data.current;
    if (!cur || !cur.specs || !cur.specs.length) return;
    if (key === "__prob") return this.openProbabilities();
    if (key === "__calc") return this.openExpectedCost();
    if (key === "__ten") return this.startDraw(cur.specs.find((x) => x.default) || cur.specs[0], 10);
    if (key === "__box") return this.startDraw(cur.specs.find((x) => x.default) || cur.specs[0], BOX_SIZE);
    const sp = cur.specs.find((x) => x.key === key);
    if (sp) this.startDraw(sp, 1);
  },

  startDraw(spec, packs) {
    const cur = this.data.current;
    if (!cur || !spec) return;
    wx.vibrateShort({ type: "medium", fail: () => {} });
    const packsOut = data.drawPacks(cur.id, spec, packs);
    this.setData({
      drawState: {
        spec,
        stage: "pack",
        view: packsOut[0],
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
    setTimeout(() => this.renderPackRow(), 200);
  },

  renderPackRow() {
    const ds = this.data.drawState;
    if (!ds) return;
    this.setData({ "drawState.view": ds.packs[ds.packIdx] });
  },

  tapCard(e) {
    const { pi, i } = e.currentTarget.dataset;
    const ds = this.data.drawState;
    if (!ds || ds.flipped[pi][i]) return;
    ds.flipped[pi][i] = true;
    this.setData({ [`drawState.flipped[${pi}][${i}]`]: true });
    wx.vibrateShort({ type: "light", fail: () => {} });
    const pack = ds.packs[pi];
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
    this.addHistory(ds.spec, 1, cards_.map(({ image, ...c }) => c));
    this.addStats(this.data.current.id, cards_, 1);
    this.addSpend(this.data.current.id, ds.spec, 1);
    this.addColl(this.data.current.id, cards_.map(({ image, ...c }) => c));
    this.renderStats();
  },

  recordUnfinished() {
    const ds = this.data.drawState;
    if (!ds) return;
    ds.recorded.forEach((done, pi) => {
      if (!done) {
        ds.recorded[pi] = true;
        const cards_ = ds.packs[pi];
        this.addHistory(ds.spec, 1, cards_.map(({ image, ...c }) => c));
        this.addStats(this.data.current.id, cards_, 1);
        this.addSpend(this.data.current.id, ds.spec, 1);
        this.addColl(this.data.current.id, cards_.map(({ image, ...c }) => c));
      }
    });
    this.renderStats();
  },

  navPack(e) {
    const d = Number(e.currentTarget.dataset.d);
    const ds = this.data.drawState;
    const next = ds.packIdx + d;
    if (next < 0 || next >= ds.packs.length) return;
    ds.packIdx = next;
    this.setData({ "drawState.packIdx": next });
    this.renderPackRow();
  },

  closeDraw() {
    this.recordUnfinished();
    this.setData({ drawState: null });
  },

  againDraw() {
    const ds = this.data.drawState;
    const spec = ds && ds.spec;
    const n = ds ? ds.packs.length : 1;
    this.recordUnfinished();
    this.setData({ drawState: null });
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
