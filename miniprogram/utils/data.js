/* 数据访问层：卡表/规格内嵌（构建脚本生成），图源直连 mik.moe，
 * 拆卡走 shared 引擎（与 exe / APK / Python 同源同拍）。 */
const index = require("../data/index.js");
const cardsDB = require("../data/cards.js");
const gacha = require("./gacha.js");

const MIK_STATIC = "https://tcg.mik.moe/static";
const MIK_API = "https://tcg.mik.moe/api/v3";

function allSets() {
  return index.sets.map((s) => ({ ...s, ...(index.meta[s.id] || {}) }));
}

function drawableSets() {
  return allSets().filter((s) => s.drawable && s.specs && s.specs.length);
}

function cards(setId) {
  return cardsDB[setId] || [];
}

function imgURL(setCode, cardIndex) {
  return `${MIK_STATIC}/img/${setCode}/${cardIndex}.png`;
}

function iconURL(code) {
  return `${MIK_STATIC}/setCode/${code}.png`;
}

function drawPack(setId, spec) {
  const cards_ = cards(setId);
  const pools = gacha.buildPools(cards_);
  return gacha.drawPack(cards_, pools, spec).map((c) => ({
    ...c,
    image: imgURL(c.setCode, c.cardIndex),
  }));
}

function drawPacks(setId, spec, packs) {
  const out = [];
  for (let i = 0; i < packs; i++) out.push(drawPack(setId, spec));
  return out;
}

/* 概率公示 + 期望成本共用 */
function specProbabilities(setId, spec) {
  const pools = gacha.buildPools(cards(setId));
  return gacha.specProbabilities(spec, pools);
}

function expectedCost(setId, spec) {
  const pools = gacha.buildPools(cards(setId));
  return gacha.expectedCost(spec, pools);
}

/* 卡牌详情（mik 详情接口为 POST；域名需在小程序后台配置 request 合法域名，
 * 未配置/网络失败时降级为卡表基础信息） */
function fetchDetail(setCode, cardIndex) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${MIK_API}/card/card-detail`,
      method: "POST",
      timeout: 10000,
      header: { "Content-Type": "application/json" },
      data: { setCode, cardIndex },
      success(res) {
        if (res.statusCode === 200 && res.data && res.data.data) resolve(res.data.data);
        else reject(new Error("无详情数据"));
      },
      fail: () => reject(new Error("详情接口不可用（需在后台配置 request 合法域名 tcg.mik.moe）")),
    });
  });
}

module.exports = {
  appVersion: index.appVersion, MIK_STATIC, MIK_API,
  allSets, drawableSets, cards, imgURL, iconURL,
  drawPack, drawPacks, specProbabilities, expectedCost, fetchDetail,
};
