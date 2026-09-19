/* 卡图加载失败统一处理：失败显示卡背占位，点击占位强制刷新重试。
 * 页面 data 需含 failMap: {}, bustMap: {}；绑定 onImgError / onImgRetry 两个方法。
 * WXML 用法（ikey 需在列表内唯一）：
 *   <image wx:if="{{!failMap[ikey]}}" src="{{bustMap[ikey] ? url + '?r=' + bustMap[ikey] : url}}"
 *          data-ikey="{{ikey}}" binderror="onImgError" />
 *   <image wx:else src="/images/cardback.webp" data-ikey="{{ikey}}" data-url="{{url}}" bindtap="onImgRetry" />
 */
module.exports = {
  CARD_BACK: "/images/cardback.webp",

  onError(page, e) {
    const key = e.currentTarget.dataset.ikey;
    if (!key) return;
    page.setData({ [`failMap[${JSON.stringify(key)}]`]: true });
  },

  retry(page, e) {
    const key = e.currentTarget.dataset.ikey;
    const url = e.currentTarget.dataset.url;
    if (!key || !url) return;
    const bustMap = page.data.bustMap || {};
    page.setData({
      [`failMap[${JSON.stringify(key)}]`]: false,
      [`bustMap[${JSON.stringify(key)}]`]: (bustMap[key] || 0) + 1,
    });
  },
};
