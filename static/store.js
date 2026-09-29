/* 持久化：localStorage 镜像磁盘、统计/消费/收藏册 —— 自 static/app.js 拆分（语义等价，见 docs/ARCHITECTURE.md） */
"use strict";

/* 本地存储 */
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { localStorage.setItem(k, JSON.stringify(v)); persistStore(); },
};

/* ---- 抽卡记录/收藏册持久化：镜像 ptcg_* 键到磁盘（exe→/api/store/*，APK→JS 桥），
        WebView 的 localStorage 重启后不保证保留 ---- */
let storeRev = 0; // 服务端存储版本号（F24）：每次上传递增，旧快照乱序后到会被服务端跳过

function snapshotStore() {
  const out = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith("ptcg_")) out[k] = localStorage.getItem(k);
  }
  return out;
}
function persistStore() {
  try {
    const data = snapshotStore();
    if (nativeBridge && nativeBridge.saveStore) nativeBridge.saveStore(JSON.stringify(data));
    else if (!ASSET) {
      storeRev += 1;
      api("/api/store/set", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data, rev: storeRev }),
      }).then((r) => { if (r && Number.isInteger(r.rev) && r.rev > storeRev) storeRev = r.rev; })
        .catch(() => {});
    }
  } catch {}
}
async function restoreStore() {
  try {
    let raw = null;
    if (nativeBridge && nativeBridge.loadStore) raw = nativeBridge.loadStore();
    else if (!ASSET) {
      const r = await api("/api/store/get");
      raw = JSON.stringify(r.data || {});
      if (Number.isInteger(r.rev)) storeRev = r.rev; // 旧格式响应无 rev → 维持 0
    }
    if (!raw) return;
    const data = JSON.parse(raw);
    for (const [k, v] of Object.entries(data.data || data)) {
      // 只补缺失的键：本地已有（可能更新）时不覆盖
      if (localStorage.getItem(k) === null && typeof v === "string") localStorage.setItem(k, v);
    }
  } catch {}
}
const statsKey = () => "ptcg_stats";
const collKey = () => "ptcg_coll";

function getStats(setId) {
  const all = store.get(statsKey(), {});
  return all[setId] || { packs: 0, cards: 0, rarities: {} };
}
function addStats(setId, cards, packCount) {
  const all = store.get(statsKey(), {});
  const s = all[setId] || { packs: 0, cards: 0, rarities: {} };
  s.packs += packCount;
  s.cards += cards.length;
  for (const c of cards) {
    const r = c.rarity || "N";
    s.rarities[r] = (s.rarities[r] || 0) + 1;
  }
  all[setId] = s;
  store.set(statsKey(), all);
  renderStats();
}
function clearStatsAll() {
  /* 清空全部统计：各弹统计 + 拆卡记录；收藏册与消费统计各自单独清理，不受影响 */
  store.set(statsKey(), {});
  state.history = [];
  store.set("ptcg_history", state.history);
  renderHistory();
  renderStats();
}

/* ---------------- 消费统计（按官方建议零售价记账，全局生效） ---------------- */
const spendKey = () => "ptcg_spend";
const spendEnabled = () => store.get("ptcg_spend_enabled", true);

function getSpend(setId) {
  const all = store.get(spendKey(), {});
  return all[setId] || { money: 0, packs: 0 };
}
function addSpend(setId, spec, packCount) {
  if (!spendEnabled() || !spec || !spec.priceCny) return;
  const all = store.get(spendKey(), {});
  const s = all[setId] || { money: 0, packs: 0 };
  s.money += spec.priceCny * packCount;
  s.packs += packCount;
  all[setId] = s;
  store.set(spendKey(), all);
  renderSpend();
  renderStats(); // 拆卡页"本弹花费"与入账同帧刷新
}
function clearSpendAll() {
  store.set(spendKey(), {});
  renderSpend();
  renderStats();
}

function renderSpend() {
  const info = $("#spendInfo"), list = $("#spendList"), toggle = $("#spendToggle");
  if (!info) return;
  toggle.checked = spendEnabled();
  const all = store.get(spendKey(), {});
  let money = 0, packs = 0;
  const rows = [];
  for (const [id, s] of Object.entries(all)) {
    money += s.money;
    packs += s.packs;
    const set = state.sets ? state.sets.find((x) => x.id === id) : null;
    rows.push({ name: set ? set.name : id, money: s.money, packs: s.packs });
  }
  info.textContent = spendEnabled()
    ? `总花费 ¥${fmtMoney(money)} · 共 ${packs} 包`
    : `记账已关闭 · 历史累计 ¥${fmtMoney(money)}（${packs} 包）`;
  rows.sort((a, b) => b.money - a.money);
  list.innerHTML = rows.map((r) =>
    `<div class="spend-row"><span class="sr-name">${escapeHtml(r.name)}</span><b>¥${fmtMoney(r.money)}<i>（${r.packs} 包）</i></b></div>`
  ).join("");
}

function getColl() { return store.get(collKey(), {}); }

function addColl(setId, cards) {
  const coll = getColl();
  const box = coll[setId] || {};
  for (const c of cards) {
    const k = `${c.setCode}__${c.cardIndex}`;
    const e = box[k] || { name: c.cardName, rarity: c.rarity || "N", setCode: c.setCode, cardIndex: c.cardIndex, count: 0 };
    e.count += 1;
    box[k] = e;
  }
  coll[setId] = box;
  store.set(collKey(), coll);
  renderPriceStats();
}
