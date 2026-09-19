/* 本地存储封装（键名与 exe / APK 端一致，导出互通）。
 * 微信限制：单键 1MB、总量 10MB —— set 失败（如超限）会返回 false，调用方应提示，
 * 避免收藏/统计被静默丢弃。 */
module.exports = {
  get(key, dflt) {
    try {
      const v = wx.getStorageSync(key);
      return v === "" || v === null || v === undefined ? dflt : v;
    } catch (e) {
      return dflt;
    }
  },
  /** @returns {boolean} 是否写入成功 */
  set(key, value) {
    try {
      wx.setStorageSync(key, value);
      return true;
    } catch (e) {
      return false;
    }
  },
  remove(key) {
    try { wx.removeStorageSync(key); } catch (e) { /* ignore */ }
  },
  keys() {
    try { return wx.getStorageInfoSync().keys || []; } catch (e) { return []; }
  },
  /** 已用空间（KB）与上限（KB） */
  info() {
    try {
      const i = wx.getStorageInfoSync();
      return { currentSize: i.currentSize || 0, limitSize: i.limitSize || 10240 };
    } catch (e) {
      return { currentSize: 0, limitSize: 10240 };
    }
  },
};
