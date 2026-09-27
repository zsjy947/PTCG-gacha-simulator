/* 卡价快照（pricetool 离线数据）：价格表/卡值与回本 —— 自 static/app.js 拆分（语义等价，见 docs/refactor/） */
"use strict";

/* ---------------- 卡价（pricetool 离线快照，随包内置；无数据时相关栏自动隐藏） ---------------- */
let PRICE_MAP = null;      // {setCode__cardIndex: 人民币价}
const PRICE_SETS = new Set();

async function loadPrices() {
  if (ASSET) return;
  try {
    const d = await api("/api/prices");
    PRICE_MAP = d.prices || {};
    for (const k of Object.keys(PRICE_MAP)) PRICE_SETS.add(k.split("__", 1)[0]);
    // 快照晚于首屏渲染到达时，刷新正在显示的收藏册（卡牌总价/价格排序）
    if (document.querySelector(".tab.active")?.dataset.tab === "collection") renderCollection();
  } catch { PRICE_MAP = null; }
}
function priceOf(setCode, cardIndex) {
  if (!PRICE_MAP) return null;
  return PRICE_MAP[`${setCode}__${normIdx(cardIndex)}`] ?? null;
}
function packValue(cards) {
  let v = 0;
  for (const c of cards) v += priceOf(c.setCode, c.cardIndex) || 0;
  return Math.round(v * 100) / 100;
}
function setPriced(setCode) { return PRICE_SETS.has(setCode); }

/* 卡值 + 回本率片段（money 为该次开包花费，未计价规格不显示回本） */
function valueLineHtml(value, money) {
  let s = `卡值 <b class="bv">¥${fmtMoney(value)}</b>`;
  if (money > 0) {
    const rate = Math.round((value / money) * 100);
    s += ` · 回本 <b class="bv ${rate >= 100 ? "val-up" : "val-down"}">${rate}%</b>`;
  }
  return s;
}
