const store = require("../../utils/store.js");
const ui = require("../../utils/ui.js");
const data = require("../../utils/data.js");
const img = require("../../utils/img.js");

Page({
  data: {
    theme: "dark",
    setNames: [],
    setIds: [],
    setIdx: 0,
    sortNames: ["按稀有度", "按卡牌编号", "按卡牌名称", "按获得张数"],
    sortKeys: ["rarity", "index", "name", "count"],
    sortIdx: 0,
    missingOnly: false,
    progress: { show: false, pct: 0, text: "" },
    summary: "",
    cards: [],       // 视图渲染条目（owned 或 missing）
    isMissing: false,
    failMap: {}, bustMap: {},
    /* 详情 */
    detailShow: false, detailSet: "", detailIdx: "", detailName: "", detailRarity: "",
  },

  onImgError(e) { img.onError(this, e); },
  onImgRetry(e) { img.retry(this, e); },

  onLoad() {
    const sets = data.allSets();
    const cur = store.get("ptcg_current_set", "");
    const startIdx = Math.max(0, sets.findIndex((s) => s.id === cur));
    this.setData({
      theme: getApp().globalData.theme,
      setIds: sets.map((s) => s.id),
      setNames: sets.map((s) => `${s.name}（${s.code}）`),
      setIdx: startIdx,
    });
    this.render();
  },

  onShow() { this.setData({ theme: getApp().globalData.theme }); },

  /* 收藏按弹分键存储（与拆卡页 addColl 一致） */
  collOf(setId) { return store.get(`ptcg_coll_${setId}`, {}) || {}; },

  onPickSet(e) { this.setData({ setIdx: Number(e.detail.value) }); this.render(); },
  onPickSort(e) { this.setData({ sortIdx: Number(e.detail.value) }); this.render(); },
  toggleMissing(e) { this.setData({ missingOnly: e.detail.value }); this.render(); },

  render() {
    const setId = this.data.setIds[this.data.setIdx];
    if (!setId) return;
    const all = data.cards(setId);
    const box = this.collOf(setId);
    const entries = Object.values(box);
    const sortKey = this.data.sortKeys[this.data.sortIdx];
    entries.sort((a, b) => {
      if (sortKey === "index") return a.cardIndex.localeCompare(b.cardIndex, undefined, { numeric: true });
      if (sortKey === "name") return a.name.localeCompare(b.name, "zh-Hans-CN");
      if (sortKey === "count") return b.count - a.count || ui.RARITY_ORDER.indexOf(a.rarity) - ui.RARITY_ORDER.indexOf(b.rarity);
      return ui.RARITY_ORDER.indexOf(a.rarity) - ui.RARITY_ORDER.indexOf(b.rarity) || a.cardIndex.localeCompare(b.cardIndex);
    });
    const totalCards = entries.reduce((a, e) => a + e.count, 0);
    const best = ui.bestRarity(Object.fromEntries(entries.map((e) => [e.rarity, 1])));

    const totalDistinct = all.length;
    const progress = { show: !!totalDistinct };
    if (totalDistinct) {
      progress.pct = Math.min(100, (entries.length / totalDistinct) * 100);
      progress.text = `已收集 ${entries.length} / ${totalDistinct} 种（${progress.pct.toFixed(1)}%）`;
    }

    let view = [];
    let summary = "";
    if (this.data.missingOnly) {
      if (totalDistinct) {
        const have = new Set(Object.keys(box));
        const missing = all.filter((c) => !have.has(`${c.setCode}__${c.cardIndex}`));
        summary = `缺卡 ${missing.length} 张 · 已收 ${entries.length}/${totalDistinct} 种`;
        view = missing.map((c) => this.viewCard(c, true));
      } else {
        summary = "该弹暂无卡表数据";
      }
    } else {
      summary = entries.length
        ? `${entries.length} 种卡牌 · ${totalCards} 张总计 · 最高 ${best || "—"}`
        : "该弹还没有收藏记录";
      view = entries.map((e) => this.viewCard(e, false));
    }
    this.setData({
      progress,
      summary,
      isMissing: this.data.missingOnly,
      cards: view,
    });
  },

  viewCard(c, missing) {
    const src = missing ? c : { name: c.name, rarity: c.rarity, setCode: c.setCode, cardIndex: c.cardIndex };
    return {
      key: `${src.setCode}__${src.cardIndex}`,
      setCode: src.setCode, cardIndex: src.cardIndex,
      name: src.name, rarity: src.rarity || "N",
      count: missing ? 0 : c.count,
      image: data.imgURL(src.setCode, src.cardIndex),
      color: ui.rarColor(src.rarity),
      badgeBg: ui.rarColor(src.rarity),
      missing,
    };
  },

  onCardTap(e) {
    const { set, idx, name, rarity } = e.currentTarget.dataset;
    this.setData({
      detailShow: true, detailSet: set, detailIdx: idx,
      detailName: name || "", detailRarity: rarity || "N",
    });
  },
  closeDetail() { this.setData({ detailShow: false }); },

  exportColl() {
    const all = {};
    for (const setId of this.data.setIds) {
      const box = this.collOf(setId);
      if (Object.keys(box).length) all[setId] = box;
    }
    wx.setClipboardData({
      data: JSON.stringify(all, null, 1),
      success: () => wx.showToast({ title: "JSON 已复制到剪贴板", icon: "none" }),
    });
  },

  /* 导入：从剪贴板读取导出格式 JSON，校验后合并（同卡数量相加） */
  importColl() {
    wx.getClipboardData({
      success: async (res) => {
        let parsed;
        try { parsed = JSON.parse(res.data); } catch { return this.failImport("剪贴板内容不是合法 JSON"); }
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          return this.failImport("结构不符合导出格式");
        }
        let sets = 0, entries = 0, total = 0;
        const valid = {};
        for (const [setId, box] of Object.entries(parsed)) {
          if (!box || typeof box !== "object" || Array.isArray(box)) continue;
          const clean = {};
          for (const e of Object.values(box)) {
            if (!e || !e.setCode || !e.cardIndex || !e.name) continue;
            clean[`${e.setCode}__${e.cardIndex}`] = {
              name: String(e.name), rarity: e.rarity || "N",
              setCode: String(e.setCode), cardIndex: String(e.cardIndex),
              count: Math.max(1, Math.floor(Number(e.count) || 1)),
            };
            entries++; total += clean[`${e.setCode}__${e.cardIndex}`].count;
          }
          if (Object.keys(clean).length) { valid[setId] = clean; sets++; }
        }
        if (!sets) return this.failImport("没有有效的收藏记录");
        const conf = await new Promise((resolve) => {
          wx.showModal({
            title: "导入收藏",
            content: `导入 ${sets} 弹共 ${entries} 种（${total} 张），与现有收藏合并（同卡数量相加）`,
            success: (r) => resolve(r.confirm),
          });
        });
        if (!conf) return;
        for (const [setId, box] of Object.entries(valid)) {
          const key = `ptcg_coll_${setId}`;
          const target = store.get(key, {}) || {};
          for (const [k, e] of Object.entries(box)) {
            if (target[k]) target[k].count += e.count;
            else target[k] = e;
          }
          if (!store.set(key, target)) return this.failImport("本地空间不足，写入失败");
        }
        this.render();
        wx.showToast({ title: `已导入 ${sets} 弹`, icon: "success" });
      },
    });
  },

  failImport(msg) {
    wx.showToast({ title: `导入失败：${msg}`, icon: "none", duration: 3000 });
  },

  clearColl() {
    wx.showModal({
      title: "清空收藏",
      content: "清空全部弹的收藏记录？该操作不可恢复。",
      confirmColor: "#e3350d",
      success: (res) => {
        if (!res.confirm) return;
        for (const k of store.keys()) {
          if (k.startsWith("ptcg_coll_")) store.remove(k);
        }
        this.render();
      },
    });
  },
});
