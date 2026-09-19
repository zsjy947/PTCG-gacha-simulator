const store = require("../../utils/store.js");
const ui = require("../../utils/ui.js");
const data = require("../../utils/data.js");
const img = require("../../utils/img.js");

const CHUNK = 60; // 增量渲染分片

Page({
  data: {
    theme: "dark",
    setNames: [], setIds: [], setIdx: 0,
    rarityNames: ["全部稀有度"], rarityKeys: [""], rarityIdx: 0,
    searchText: "",
    view: [], shown: 0, total: 0,
    failMap: {}, bustMap: {},
    /* 详情 */
    detailShow: false, detailSet: "", detailIdx: "", detailName: "", detailRarity: "",
  },

  onImgError(e) { img.onError(this, e); },
  onImgRetry(e) { img.retry(this, e); },
  onLoad() {
    const sets = data.allSets();
    const cur = store.get("ptcg_current_set", "");
    this.all = [];
    this.setData({
      theme: getApp().globalData.theme,
      setIds: sets.map((s) => s.id),
      setNames: sets.map((s) => `${s.name}（${s.code}）`),
      setIdx: Math.max(0, sets.findIndex((s) => s.id === cur)),
    });
    this.loadSet();
  },

  onShow() { this.setData({ theme: getApp().globalData.theme }); },

  loadSet() {
    const setId = this.data.setIds[this.data.setIdx];
    this.all = data.cards(setId);
    // 稀有度筛选重建
    const rs = [...new Set(this.all.map((c) => c.rarity || "N"))]
      .sort((a, b) => ui.RARITY_ORDER.indexOf(a) - ui.RARITY_ORDER.indexOf(b));
    this.setData({
      rarityKeys: ["", ...rs],
      rarityNames: ["全部稀有度", ...rs.map((r) => ui.rarLabel(r))],
      rarityIdx: 0,
    });
    this.applyFilter();
  },

  onPickSet(e) {
    const idx = Number(e.detail.value);
    this.setData({ setIdx: idx });
    store.set("ptcg_current_set", this.data.setIds[idx]);
    this.loadSet();
  },
  onPickRarity(e) { this.setData({ rarityIdx: Number(e.detail.value) }); this.applyFilter(); },
  onSearch(e) { this.setData({ searchText: e.detail.value }); this.applyFilter(); },

  applyFilter() {
    const kw = this.data.searchText.trim().toLowerCase();
    const rar = this.data.rarityKeys[this.data.rarityIdx];
    this.filtered = this.all.filter((c) =>
      (!rar || (c.rarity || "N") === rar) && (!kw || (c.cardName || "").toLowerCase().includes(kw)));
    this.setData({ view: [], shown: 0, total: this.filtered.length });
    this.append();
  },

  append() {
    const cur = this.data.shown;
    if (cur >= this.filtered.length) return;
    const chunk = this.filtered.slice(cur, cur + CHUNK).map((c) => ({
      ...c,
      image: data.imgURL(c.setCode, c.cardIndex),
      color: ui.rarColor(c.rarity || "N"),
    }));
    this.setData({
      view: this.data.view.concat(chunk),
      shown: cur + chunk.length,
    });
  },

  onReachBottom() { this.append(); },

  onCardTap(e) {
    const { set, idx, name, rarity } = e.currentTarget.dataset;
    this.setData({
      detailShow: true, detailSet: set, detailIdx: idx,
      detailName: name || "", detailRarity: rarity || "N",
    });
  },
  closeDetail() { this.setData({ detailShow: false }); },
});
