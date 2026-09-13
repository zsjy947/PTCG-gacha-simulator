/* 卡牌拆卡模拟器（小程序端）—— 全局状态与主题 */
const store = require("./utils/store.js");

App({
  globalData: {
    theme: "dark",
    version: "",
  },

  onLaunch() {
    this.globalData.theme = store.get("ptcg_theme", "dark");
    this.globalData.version = require("./data/index.js").appVersion || "";
  },

  setTheme(theme) {
    this.globalData.theme = theme;
    store.set("ptcg_theme", theme);
  },
});
