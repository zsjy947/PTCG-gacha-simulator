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
    this.migrateCollPerSet();
  },

  setTheme(theme) {
    this.globalData.theme = theme;
    store.set("ptcg_theme", theme);
  },

  /* 旧版把全部弹的收藏存在单键 ptcg_coll（微信单键上限 1MB，收集量大时会
   * 写入失败且被静默丢弃）；迁移为按弹分键 ptcg_coll_<setId>。 */
  migrateCollPerSet() {
    const legacy = store.get("ptcg_coll", null);
    if (!legacy || typeof legacy !== "object") return;
    for (const [setId, box] of Object.entries(legacy)) {
      const key = `ptcg_coll_${setId}`;
      if (store.get(key, null)) continue; // 已有分键数据，不覆盖
      store.set(key, box);
    }
    store.remove("ptcg_coll");
  },
});
