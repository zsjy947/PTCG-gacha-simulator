/* 卡价快照（pricetool 离线数据）：价格表/卡值与回本、热更新与统计 —— 自 static/app.js 拆分 */
"use strict";

/* ---------------- 卡价（内置快照 + 数据源热更新；无数据时相关栏自动隐藏） ---------------- */
let PRICE_MAP = null;      // {setCode__cardIndex: 人民币价}
let priceGenerated = null; // 当前生效快照的 generated 时间（ISO +08:00）
const PRICE_SETS = new Set();
const PRICE_SNAPSHOT_KEY = "ptcg_prices_data"; // 热更新快照（ptcg_ 前缀 → 随镜像持久化到磁盘）

/* 生效快照：内置（exe 走 /api/prices；APK 无内置）与已应用的热更新快照取 generated 较新者 */
async function loadPrices() {
  let bundled = null;
  if (!ASSET) {
    try {
      const d = await api("/api/prices");
      if (d && d.generated && d.prices) bundled = d;
    } catch { /* 无内置快照（旧版本数据/离线），交由热更新兜底 */ }
  }
  const stored = store.get(PRICE_SNAPSHOT_KEY, null);
  const best = (!bundled || (stored && stored.generated > bundled.generated)) ? stored : bundled;
  if (best && best.generated && best.prices) applyPriceSnapshot(best);
  else PRICE_MAP = null;
  renderPriceStats();
  checkPriceUpdate(false); // 启动静默检查数据源上的每周快照（有更新则应用，失败不打扰）
}

function applyPriceSnapshot(snap) {
  PRICE_MAP = snap.prices || {};
  priceGenerated = snap.generated || null;
  PRICE_SETS.clear();
  for (const k of Object.keys(PRICE_MAP)) PRICE_SETS.add(k.split("__", 1)[0]);
  // 快照晚于首屏渲染到达时，刷新正在显示的收藏册（卡牌总价/价格排序）
  if (document.querySelector(".tab.active")?.dataset.tab === "collection") renderCollection();
  renderPriceStats();
}

/* 数据源上的每周快照（.github/workflows/update-prices.yml 同步）：逐源取 prices/index.json，
 * 比 generated 新则应用。manual=true 由按钮触发（有提示文案），false 为启动静默自检。 */
async function checkPriceUpdate(manual) {
  const btn = manual ? $("#btnCheckPrice") : null;
  if (manual) {
    toast("正在检查卡价更新…");
    if (btn) btn.disabled = true;
  }
  try {
    let snap = null, saw404 = false;
    for (const base of dataSrcList()) {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), DATASRC_TIMEOUT_MS);
      try {
        const r = await fetch(`${base}/prices/index.json`, { signal: ctl.signal });
        clearTimeout(timer);
        if (r.ok) {
          const parsed = await r.json();
          if (parsed && parsed.generated && parsed.prices) { snap = parsed; break; }
        } else if (r.status === 404) saw404 = true;
      } catch { clearTimeout(timer); }
    }
    if (!snap) {
      if (manual) {
        toast(saw404
          ? "数据源暂无卡价快照（更新尚未发布，稍后再试）"
          : "暂时连不上数据源，请稍后重试", 3600);
      }
      return;
    }
    if (priceGenerated && snap.generated <= priceGenerated) {
      if (manual) toast("卡价已是最新");
      return;
    }
    store.set(PRICE_SNAPSHOT_KEY, snap);
    applyPriceSnapshot(snap);
    if (manual) toast(`卡价已更新：${priceDateZh(snap.generated)}（${Object.keys(snap.prices).length} 张）`);
  } finally {
    if (manual && btn) btn.disabled = false;
  }
}

/* 设置页「卡价统计」栏：像消费统计一样汇总已拆出（收藏册内）全部卡牌的价值 */
function priceDateZh(generated) {
  const [y, m, d] = String(generated || "").slice(0, 10).split("-");
  return y ? `${y}年${parseInt(m, 10)}月${parseInt(d, 10)}日` : "未知日期";
}
function renderPriceStats() {
  const info = $("#priceDataInfo"), list = $("#priceList"), note = $("#priceNote");
  if (!info) return;
  if (note) note.textContent = priceGenerated ? `${priceDateZh(priceGenerated)}静态数据，仅供参考` : "";
  let total = 0;
  const rows = [];
  if (PRICE_MAP) {
    for (const [setId, box] of Object.entries(getColl())) {
      let value = 0, cards = 0;
      for (const e of Object.values(box)) {
        cards += e.count || 1;
        const p = priceOf(e.setCode, e.cardIndex);
        if (p != null) value += p * (e.count || 1);
      }
      if (cards) {
        total += value;
        if (value > 0) rows.push({ setId, value: Math.round(value * 100) / 100, cards });
      }
    }
  }
  info.textContent = `总卡值 ¥${fmtMoney(Math.round(total * 100) / 100)}`;
  rows.sort((a, b) => b.value - a.value);
  if (list) {
    list.innerHTML = rows.map((r) => {
      const s = state.sets ? state.sets.find((x) => x.id === r.setId) : null;
      return `<div class="spend-row"><span class="sr-name">${escapeHtml(s ? s.name : r.setId)}</span>`
        + `<b>¥${fmtMoney(r.value)}<i>（${r.cards} 张）</i></b></div>`;
    }).join("");
  }
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
