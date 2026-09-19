const store = require("../../utils/store.js");
const ui = require("../../utils/ui.js");
const data = require("../../utils/data.js");

Page({
  data: {
    theme: "dark",
    version: "",
    spendEnabled: true,
    spendTotal: "0",
    spendPacks: 0,
    spendAvg: "—",
    spendRows: [],
    storageLabel: "",
    storageWarn: false,
    /* 消费说明与官方一致（与 exe / APK 端同源） */
    priceNote: "按官方建议零售价记账：5张装 10 元、20张/25张装 50 元、太晶盛聚 10张装 30 元、宝石包 10 元/包；奖赏包无官方单包定价，不计入。",
  },

  onLoad() {
    const app = getApp();
    this.setData({ theme: app.globalData.theme, version: app.globalData.version });
    this.renderSpend();
    this.renderStorage();
  },

  onShow() { this.setData({ theme: getApp().globalData.theme }); },

  renderSpend() {
    const all = store.get("ptcg_spend", {});
    const names = {};
    for (const s of data.allSets()) names[s.id] = s.name;
    let money = 0, packs = 0;
    const rows = [];
    for (const [id, s] of Object.entries(all)) {
      money += s.money;
      packs += s.packs;
      rows.push({ id, name: names[id] || id, money: s.money, text: `¥${ui.fmtMoney(s.money)}（${s.packs} 包）` });
    }
    rows.sort((a, b) => b.money - a.money);
    this.setData({
      spendEnabled: store.get("ptcg_spend_enabled", true),
      spendTotal: ui.fmtMoney(money),
      spendPacks: packs,
      spendAvg: packs ? "¥" + ui.fmtMoney(Math.round((money / packs) * 100) / 100) : "—",
      spendRows: rows,
    });
  },

  toggleSpend(e) {
    store.set("ptcg_spend_enabled", e.detail.value);
    this.renderSpend();
  },

  clearSpend() {
    wx.showModal({
      title: "清零消费统计",
      content: "清零全部消费统计？（拆卡记录不受影响）",
      confirmColor: "#e3350d",
      success: (res) => {
        if (res.confirm) { store.set("ptcg_spend", {}); this.renderSpend(); }
      },
    });
  },

  toggleTheme(e) {
    const theme = e.detail.value ? "light" : "dark";
    getApp().setTheme(theme);
    this.setData({ theme });
  },

  renderStorage() {
    const info = store.info();
    this.setData({
      storageLabel: `${info.currentSize} KB / ${info.limitSize} KB`,
      storageWarn: info.currentSize > info.limitSize * 0.8,
    });
  },

  clearStats() {
    wx.showModal({
      title: "清空统计",
      content: "清空全部拆卡统计与拆卡记录？（收藏册与消费统计不受影响）",
      confirmColor: "#e3350d",
      success: (res) => {
        if (!res.confirm) return;
        store.set("ptcg_stats", {});
        store.set("ptcg_history", []);
        wx.showToast({ title: "已清空", icon: "success" });
      },
    });
  },
});
