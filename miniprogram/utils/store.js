/* 本地存储封装（键名与 exe / APK 端一致，导出互通） */
module.exports = {
  get(key, dflt) {
    try {
      const v = wx.getStorageSync(key);
      return v === "" || v === null || v === undefined ? dflt : v;
    } catch (e) {
      return dflt;
    }
  },
  set(key, value) {
    try { wx.setStorageSync(key, value); } catch (e) { /* 空间满等异常静默 */ }
  },
  remove(key) {
    try { wx.removeStorageSync(key); } catch (e) { /* ignore */ }
  },
  keys() {
    try { return wx.getStorageInfoSync().keys || []; } catch (e) { return []; }
  },
};
