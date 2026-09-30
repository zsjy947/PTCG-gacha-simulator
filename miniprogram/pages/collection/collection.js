const store = require("../../utils/store.js");
const ui = require("../../utils/ui.js");
const data = require("../../utils/data.js");
const img = require("../../utils/img.js");

const MISSING_PAGE_SIZE = 60; // 缺卡图每页上限（与 exe 端一致）

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
    missingCount: 0,
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
    let missingCount = 0;
    this._missing = [];
    if (this.data.missingOnly) {
      if (totalDistinct) {
        const have = new Set(Object.keys(box));
        const missing = all.filter((c) => !have.has(`${c.setCode}__${c.cardIndex}`));
        summary = `缺卡 ${missing.length} 张 · 已收 ${entries.length}/${totalDistinct} 种`;
        view = missing.map((c) => this.viewCard(c, true));
        this._missing = missing;
        missingCount = missing.length;
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
      missingCount,
      cards: view,
    });
  },

  /* ---------------- 缺卡清单导出（图 / 文本，T4） ---------------- */
  currentSetName() {
    const s = data.allSets().find((x) => x.id === this.data.setIds[this.data.setIdx]);
    return s ? s.name : "";
  },

  /* 缺卡文本清单：utils/ui.missingListText 与 exe 端逐字一致 */
  copyMissingList() {
    const missing = this._missing || [];
    if (!this.data.missingOnly || !missing.length) {
      return wx.showToast({ title: "开启「只看缺卡」后可用", icon: "none" });
    }
    const total = data.cards(this.data.setIds[this.data.setIdx]).length;
    wx.setClipboardData({
      data: ui.missingListText(this.currentSetName(), missing, total),
      success: () => wx.showToast({ title: "缺卡清单已复制", icon: "none" }),
      fail: () => wx.showToast({ title: "复制失败", icon: "none", duration: 3000 }),
    });
  },

  /* 导出缺卡图：canvas 2d 逐页绘制（复用战报图布局）→ 相册（wx.saveImageToPhotosAlbum） */
  async exportMissingImage() {
    const missing = this._missing || [];
    if (!this.data.missingOnly || !missing.length) {
      return wx.showToast({ title: "开启「只看缺卡」后可用", icon: "none" });
    }
    if (this._exporting) return;
    this._exporting = true;
    wx.showLoading({ title: "生成缺卡图…", mask: true });
    const setName = this.currentSetName();
    const total = data.cards(this.data.setIds[this.data.setIdx]).length;
    const pages = Math.ceil(missing.length / MISSING_PAGE_SIZE);
    let fail = 0;
    for (let p = 1; p <= pages; p++) {
      const ok = await this.exportMissingPage(setName, missing, total, p, pages);
      if (!ok) fail++;
    }
    wx.hideLoading();
    this._exporting = false;
    if (fail === pages) wx.showToast({ title: "生成失败（未获相册权限？）", icon: "none", duration: 3000 });
    else if (fail) wx.showToast({ title: `已保存 ${pages - fail}/${pages} 页`, icon: "none", duration: 3000 });
    else wx.showToast({ title: pages > 1 ? `已保存 ${pages} 页到相册` : "已保存到相册", icon: "none" });
  },

  exportMissingPage(setName, missing, total, pageNo, pageTotal) {
    const page = missing.slice(MISSING_PAGE_SIZE * (pageNo - 1), MISSING_PAGE_SIZE * pageNo);
    return new Promise((resolve) => {
      wx.createSelectorQuery().in(this)
        .select("#missingCanvas").fields({ node: true })
        .exec(async (res) => {
          if (!res || !res[0] || !res[0].node) return resolve(false);
          const canvas = res[0].node;
          try {
            await this.drawMissingCanvas(canvas, page, {
              name: setName, missingTotal: missing.length, total, pageNo, pageTotal,
            });
            wx.canvasToTempFilePath({
              canvas,
              success: (r) => wx.saveImageToPhotosAlbum({
                filePath: r.tempFilePath,
                success: () => resolve(true),
                fail: () => resolve(false),
              }),
              fail: () => resolve(false),
            });
          } catch {
            resolve(false);
          }
        });
    });
  },

  /* 画布绘制（布局对齐 exe 端 buildMissingImage；图片直连图源，失败画占位底色） */
  async drawMissingCanvas(canvas, page, meta) {
    const W = 900;
    const cols = page.length <= 4 ? 2 : page.length <= 9 ? 3 : page.length <= 16 ? 4 : page.length <= 30 ? 5 : 6;
    const rows = Math.ceil(Math.max(page.length, 1) / cols);
    const gap = 12, headH = 170, footH = 84;
    const cellW = Math.floor((W - gap * (cols + 1)) / cols);
    const thumbH = Math.floor(cellW * 1.32);
    const capH = 44;
    const H = headH + rows * (thumbH + capH + gap) + footH;
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d");
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#101528"); bg.addColorStop(1, "#0a0e18");
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#e3350d"; ctx.fillRect(0, 0, W, 8);
    ctx.textAlign = "center";
    ctx.fillStyle = "#f5f6f8";
    ctx.font = "bold 40px sans-serif";
    ctx.fillText("缺卡清单", W / 2, 86);
    ctx.font = "24px sans-serif";
    ctx.fillStyle = "#9aa5b1";
    ctx.fillText(`${String(meta.name).slice(0, 24)} · 缺 ${meta.missingTotal}/${meta.total} 张 · 第 ${meta.pageNo}/${meta.pageTotal} 页`, W / 2, 128);
    let k = 0;
    for (const c of page) {
      const col = k % cols, row = Math.floor(k / cols);
      const x = gap + col * (cellW + gap), y = headH + row * (thumbH + capH + gap);
      ctx.fillStyle = "#1a2032";
      ctx.fillRect(x, y, cellW, thumbH);
      try {
        const im = await new Promise((res, rej) => {
          const ig = canvas.createImage();
          ig.onload = () => res(ig);
          ig.onerror = rej;
          ig.src = data.imgURL(c.setCode, c.cardIndex);
        });
        ctx.drawImage(im, x, y, cellW, thumbH);
      } catch { /* 占位底色兜底 */ }
      ctx.textAlign = "left";
      ctx.fillStyle = ui.rarColor(c.rarity || "N");
      ctx.font = "bold 17px sans-serif";
      ctx.fillText(this.clipText(ctx, `${c.cardIndex} ${c.cardName}`, cellW - 10), x + 5, y + thumbH + 20);
      ctx.fillStyle = "#9aa5b1";
      ctx.font = "15px sans-serif";
      ctx.fillText(String(c.rarity || "N"), x + 5, y + thumbH + 39);
      k++;
    }
    ctx.textAlign = "center";
    ctx.fillStyle = "#6b7688";
    ctx.font = "20px sans-serif";
    ctx.fillText(`${new Date().toLocaleDateString("zh-CN")} · PTCG拆卡模拟器 v${getApp().globalData.version || ""} · 数据来源公开网络，仅供学习交流`, W / 2, H - 30);
  },

  clipText(ctx, text, maxW) {
    if (ctx.measureText(text).width <= maxW) return text;
    let s = text;
    while (s.length > 1 && ctx.measureText(s + "…").width > maxW) s = s.slice(0, -1);
    return s + "…";
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
