/* 宝可梦卡牌 · 简中拆卡模拟 —— 前端逻辑 */
"use strict";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const RARITY_ORDER = ["UR", "SAR", "SR", "ACE", "AR", "RR", "R", "U", "C", "N", "★★★", "★★", "★", "◆", "●", "无标记"];
const RARITY_COLOR = {
  C: "#9aa5b1", U: "#58c470", R: "#4aa8ff", RR: "#ffd75e", AR: "#7ee8fa",
  SR: "#ff7edb", SAR: "#b28dff", UR: "#ffc82e", ACE: "#8f7bff", TR: "#f6a5c0", N: "#6b7688",
  "●": "#9aa5b1", "◆": "#58c470", "★": "#4aa8ff", "★★": "#ffd75e", "★★★": "#b28dff", "无标记": "#6b7688",
};
const RARITY_LABEL = {
  C: "普通 C", U: "非普通 U", R: "稀有 R", RR: "双稀有 RR", AR: "艺术稀有 AR",
  SR: "超级稀有 SR", SAR: "特艺术 SAR", UR: "究极稀有 UR", ACE: "ACE SPEC", TR: "双星 TR", N: "其他",
  "●": "普通 ●", "◆": "非普通 ◆", "★": "稀有 ★", "★★": "双稀有 ★★", "★★★": "特艺术 ★★★", "无标记": "无标记",
};
const ENERGY_ZH = { G: "草", R: "火", W: "水", L: "雷", P: "超", F: "斗", D: "恶", M: "钢", Y: "妖", N: "无", C: "无色" };

const state = {
  sets: [],           // 全部弹（扁平）
  current: null,      // 当前弹 {id, code, name, specs, ...}
  cards: new Map(),   // setId -> 卡列表
  drawing: false,
  spec: null,         // 当前选择的包规格 {id, key, label, ...}
  packs: [],          // 本次开包结果
  packIdx: 0,
  flipped: [],        // 每包已翻开的卡索引
  history: [],
};

/* ---------------- 工具 ---------------- */
async function api(url, opts) {
  const r = await fetch(url, opts);
  const body = await r.json().catch(() => ({}));
  if (!r.ok || body.error) throw new Error(body.error || `HTTP ${r.status}`);
  return body;
}

/* 资产模式（安卓 APK）：无后端，数据内嵌、JS 本地抽卡、卡图直连图源 */
const ASSET = !!window.__ASSET_MODE__;
const MIK_STATIC = window.__ASSET_BASE__ || "https://tcg.mik.moe/static";
const MIK_API = "https://tcg.mik.moe/api/v3";
const RARITY_ALIAS = { "●": "C", "○": "C", "◆": "U", "◇": "U", "★": "R", "★★": "RR", "★★★": "SAR" };

function imgURL(code, idx) {
  return ASSET ? `${MIK_STATIC}/img/${code}/${idx}.png` : `/img/${code}/${idx}`;
}
function thumbURL(c) {
  return ASSET ? imgURL(c.setCode, c.cardIndex) : `/thumb/${c.setCode}/${c.cardIndex}`;
}
function cardImage(c) {
  return c.image || imgURL(c.setCode, c.cardIndex);
}
function iconURL(code) {
  return ASSET ? `${MIK_STATIC}/setCode/${code}.png` : `/icon/${code}`;
}

/* 资产模式下远程图片经 XHR 转 Blob 显示（file:// 页面 img 直连远程可能被拦截） */
const imgBlobCache = new Map();
function upgradeRemoteImages(root) {
  if (!ASSET) return;
  root.querySelectorAll("img[src^='http']").forEach((img) => {
    const url = img.getAttribute("src");
    if (!url || img.dataset.blobbed) return;
    img.dataset.blobbed = "1";
    let p = imgBlobCache.get(url);
    if (!p) {
      p = new Promise((resolve) => {
        try {
          const x = new XMLHttpRequest();
          x.open("GET", url, true);
          x.responseType = "arraybuffer";
          x.onload = () => {
            if (x.status !== 200 || !x.response) { resolve(null); return; }
            const type = x.getResponseHeader("Content-Type") || "image/png";
            resolve(URL.createObjectURL(new Blob([x.response], { type })));
          };
          x.onerror = () => resolve(null);
          x.send();
        } catch { resolve(null); }
      });
      imgBlobCache.set(url, p);
    }
    p.then((u) => { if (u) img.src = u; });
  });
}

/* ---- 本地抽卡引擎（资产模式） ---- */
function buildPools(cards) {
  const pools = {};
  for (const c of cards) {
    const r = c.rarity || "N";
    const k = RARITY_ALIAS[r] || r;
    (pools[k] = pools[k] || []).push(c);
  }
  return pools;
}
function normalizeWeights(weights, available) {
  const w = Object.entries(weights).filter(([r, v]) => available.includes(r) && v > 0);
  if (!w.length) return null;
  const total = w.reduce((a, [, v]) => a + v, 0);
  return Object.fromEntries(w.map(([r, v]) => [r, v / total]));
}
function pickRarity(probs) {
  let roll = Math.random(), acc = 0;
  for (const [r, p] of Object.entries(probs)) { acc += p; if (roll <= acc) return r; }
  return Object.keys(probs).pop();
}
function cardKey(c) { return `${c.setCode}__${c.cardIndex}`; }
function pickCard(pools, rarity, cards, used) {
  // 包内已出现的卡不再出现：同稀有度池去重，池耗尽退回整弹去重
  let src = rarity ? (pools[rarity] && pools[rarity].length ? pools[rarity] : cards) : cards;
  if (used) {
    let fresh = src.filter((c) => !used.has(cardKey(c)));
    if (!fresh.length) fresh = cards.filter((c) => !used.has(cardKey(c)));
    if (fresh.length) src = fresh;
  }
  return { ...src[Math.floor(Math.random() * src.length)] };
}
function jsDrawPack(pools, cards, spec) {
  const variants = spec.variants || [{ note: spec.note || "", slots: spec.slots }];
  const v = variants[Math.floor(Math.random() * variants.length)];
  const available = Object.keys(pools);
  const used = new Set();
  return v.slots.map((slot) => {
    const probs = normalizeWeights(slot.weights, available);
    const card = pickCard(pools, probs ? pickRarity(probs) : null, cards, used);
    used.add(cardKey(card));
    card.slotName = slot.name;
    card.slotKind = slot.kind;
    return card;
  });
}
function jsSpecProbabilities(spec, pools) {
  const slotTable = (slots) => slots.map((slot) => {
    const probs = normalizeWeights(slot.weights, Object.keys(pools)) || {};
    return {
      name: slot.name, kind: slot.kind, fallback: !probs,
      probabilities: Object.entries(probs)
        .map(([r, p]) => ({ rarity: r, p, pool: (pools[r] || []).length }))
        .sort((a, b) => b.p - a.p),
    };
  });
  const variants = spec.variants || [{ note: spec.note || "", slots: spec.slots }];
  return {
    id: spec.id, label: spec.label, note: spec.note, price: spec.price,
    packSize: variants[0].slots.length,
    variants: variants.map((v) => ({ note: v.note, slots: slotTable(v.slots) })),
  };
}

/* ---- 数据访问层：服务模式 / 资产模式 ---- */
const DATA = {
  async sets() {
    if (!ASSET) return api("/api/sets");
    // 数据由 build_assets 以 JS 文件内嵌（file:// 下 fetch 不可用）
    const idx = window.__SETS_INDEX__ || [];
    const meta = window.__GACHA_META__ || { sets: {} };
    state.gachaMeta = meta;
    const groups = {};
    for (const s of idx) {
      if (!s.count) continue;
      const m = meta.sets[s.id] || {};
      const entry = { ...s, specs: m.specs || [], drawable: !!m.drawable, group: m.group || "其他" };
      (groups[entry.group] = groups[entry.group] || []).push(entry);
    }
    const order = ["补充包", "收集啦151", "宝石包", "嗨皮系列", "对战派对",
                   "大师战略卡组", "起始卡组", "专题包", "礼盒·套装", "特典卡"];
    const result = [];
    for (const g of order) if (groups[g]) { result.push({ group: g, sets: groups[g] }); delete groups[g]; }
    for (const g of Object.keys(groups)) result.push({ group: g, sets: groups[g] });
    return { groups: result };
  },
  async cards(setId) {
    if (!ASSET) {
      const d = await api(`/api/sets/${encodeURIComponent(setId)}/cards`);
      return d.cards;
    }
    window.__CARD_FILES__ = window.__CARD_FILES__ || {};
    if (!window.__CARD_FILES__[setId]) {
      // 动态注入 script 标签加载该弹卡表
      await new Promise((resolve, reject) => {
        const sc = document.createElement("script");
        sc.src = `assets/cards/${setId}.js`;
        sc.onload = resolve;
        sc.onerror = () => reject(new Error(`卡表 ${setId} 加载失败`));
        document.head.appendChild(sc);
      });
    }
    const cards = window.__CARD_FILES__[setId] || [];
    for (const c of cards) c.image = imgURL(c.setCode, c.cardIndex);
    return cards;
  },
  async probabilities(setId) {
    if (!ASSET) return api(`/api/sets/${encodeURIComponent(setId)}/probabilities`);
    const cards = await DATA.cards(setId);
    const pools = buildPools(cards);
    return { specs: (state.current.specs || []).map((sp) => jsSpecProbabilities(sp, pools)) };
  },
  async draw(setId, spec, packs) {
    if (!ASSET) {
      return api("/api/draw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ set: setId, spec: spec.key, packs }),
      });
    }
    const cards = await DATA.cards(setId);
    const pools = buildPools(cards);
    const packsOut = [];
    for (let i = 0; i < packs; i++) packsOut.push(jsDrawPack(pools, cards, spec));
    return {
      packs: packsOut.map((p) => p.map((c) => ({ ...c, image: imgURL(c.setCode, c.cardIndex) }))),
    };
  },
  async detail(code, idx) {
    if (!ASSET) return api(`/api/card/${encodeURIComponent(code)}/${encodeURIComponent(idx)}`);
    // file:// 环境用 XHR（fetch 到 https 会受 CORS 限制）
    return new Promise((resolve, reject) => {
      const x = new XMLHttpRequest();
      x.open("POST", `${MIK_API}/card/card-detail`, true);
      x.setRequestHeader("Content-Type", "application/json");
      x.onload = () => { try { resolve(JSON.parse(x.responseText)); } catch (e) { reject(e); } };
      x.onerror = () => reject(new Error("详情接口网络错误"));
      x.send(JSON.stringify({ setCode: code, cardIndex: idx }));
    });
  },
};
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
}
function rarBadge(r) {
  const color = RARITY_COLOR[r] || RARITY_COLOR.N;
  return `<span class="rar-badge" style="background:${color}">${escapeHtml(r || "—")}</span>`;
}
function bestRarity(rs) {
  return RARITY_ORDER.find((r) => rs[r]) || null;
}

/* 本地存储 */
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { localStorage.setItem(k, JSON.stringify(v)); persistStore(); },
};

/* ---- 抽卡记录/收藏册持久化：镜像 ptcg_* 键到磁盘（exe→/api/store/*，APK→JS 桥），
        WebView 的 localStorage 重启后不保证保留 ---- */
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
    else if (!ASSET) api("/api/store/set", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data }),
    }).catch(() => {});
  } catch {}
}
async function restoreStore() {
  try {
    let raw = null;
    if (nativeBridge && nativeBridge.loadStore) raw = nativeBridge.loadStore();
    else if (!ASSET) {
      const r = await api("/api/store/get");
      raw = JSON.stringify(r.data || {});
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
function fmtMoney(n) { return Number.isInteger(n) ? String(n) : n.toFixed(2); }

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
  const avg = packs ? `¥${fmtMoney(Math.round((money / packs) * 100) / 100)}` : "—";
  info.textContent = spendEnabled()
    ? `总花费 ¥${fmtMoney(money)} · 共 ${packs} 包 · 平均每包 ${avg}`
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
}

/* ---------------- 应用内确认弹窗（替代原生 confirm：pywebview/WebView 原生弹窗会带源地址前缀） ---------------- */
let _confirmDone = null;
function uiConfirm(msg) {
  return new Promise((resolve) => {
    _confirmDone = resolve;
    $("#confirmText").textContent = msg;
    $("#confirmOverlay").hidden = false;
    $("#btnConfirmOk").focus();
  });
}
function settleConfirm(v) {
  if (!_confirmDone) return;
  const resolve = _confirmDone;
  _confirmDone = null;
  $("#confirmOverlay").hidden = true;
  resolve(v);
}

/* ---------------- 弹列表 ---------------- */
async function loadSets() {
  const box = $("#setGroups");
  try {
    const data = await DATA.sets();
    state.sets = data.groups.flatMap((g) => g.sets.map((s) => ({ ...s, group: g.group })));
    const frag = document.createDocumentFragment();
    for (const g of data.groups) {
      const title = document.createElement("div");
      title.className = "set-group-title";
      title.textContent = `${g.group} · ${g.sets.length} 弹`;
      frag.appendChild(title);
      for (const s of g.sets) {
        const b = document.createElement("button");
        b.className = "set-item";
        b.dataset.id = s.id;
        b.innerHTML = `
          <span class="no-icon">🎯</span>
          <span class="si-name"><b>${escapeHtml(s.name)}</b><span>${escapeHtml(s.code)}</span></span>
          <span class="si-count">${s.count}</span>`;
        const img = document.createElement("img");
        img.src = iconURL(s.code);
        img.alt = "";
        img.onload = () => b.querySelector(".no-icon").replaceWith(img);
        img.onerror = () => {};
        b.addEventListener("click", () => selectSet(s.id));
        frag.appendChild(b);
      }
    }
    box.innerHTML = "";
    box.appendChild(frag);
    upgradeRemoteImages(box);
  } catch (e) {
    box.innerHTML = `<div class="side-loading">载入失败：${escapeHtml(e.message)}<br>请先运行 <b>python fetch_data.py</b></div>`;
  }
}

function filterSets(kw) {
  kw = kw.trim().toLowerCase();
  $$(".set-item").forEach((el) => {
    const s = state.sets.find((x) => x.id === el.dataset.id);
    if (!s) return;
    const hit = !kw || s.name.toLowerCase().includes(kw) || s.code.toLowerCase().includes(kw);
    el.style.display = hit ? "" : "none";
  });
  $$(".set-group-title").forEach((t) => { t.style.display = kw ? "none" : ""; });
}

function selectSet(id) {
  const s = state.sets.find((x) => x.id === id);
  if (!s) return;
  state.current = s;
  state.spec = s.specs.find((x) => x.default) || s.specs[0];
  $$(".set-item").forEach((el) => el.classList.toggle("active", el.dataset.id === id));
  $("#hero").innerHTML = `
    <div class="hero-icon"><img src="${iconURL(s.code)}" alt="" style="max-width:64px;max-height:48px;object-fit:contain" onerror="this.outerHTML='🎯'"></div>
    <div class="hero-info">
      <h2>${escapeHtml(s.name)}</h2>
      <p>${escapeHtml(s.group)} · ${s.count} 张卡牌</p>
      <div class="hero-meta">
        <span>弹代码 ${escapeHtml(s.code)}</span>
        ${s.specs.length
          ? s.specs.map((sp) => `<span>${escapeHtml(sp.label)}${sp.price ? ` · ${escapeHtml(sp.price)}` : ""}</span>`).join("")
          : "<span>未开放拆卡 · 仅浏览卡表</span>"}
      </div>
    </div>`;
  const spIcon = document.querySelector("#setPicker .sp-icon");
  spIcon.innerHTML = `<img src="${iconURL(s.code)}" alt="" style="width:34px;height:24px;object-fit:contain" onerror="this.textContent='🎯'">`;
  upgradeRemoteImages(spIcon);
  $("#spName").textContent = s.name;
  $("#spMeta").textContent = `${s.group} · ${s.count} 张`;
  const sbSet = $("#sbSet");
  if (sbSet) sbSet.textContent = `当前弹包：${s.name}（${s.code} · ${s.count} 张）`;
  closeSidebar();
  renderSpecButtons();
  renderStats();
  loadSetCards(s.id).then(() => { if ($("#tab-cardlist").classList.contains("active")) renderCardList(); });
}

/* 手机端弹包选择抽屉 */
function openSidebar() {
  $("#sidebar").classList.add("open");
  $("#sidebarBackdrop").hidden = false;
}
function closeSidebar() {
  $("#sidebar").classList.remove("open");
  $("#sidebarBackdrop").hidden = true;
}

/* ---------------- 规格按钮 ---------------- */
function specBtnClass(sp) {
  if (sp.packSize >= 20) return "draw-fat";
  if (sp.packSize >= 10) return "draw-pack";
  if (sp.packSize <= 1) return "draw-reward";
  if ((sp.note || "").includes("全闪") || (sp.label || "").includes("宝石")) return "draw-gem";
  return "draw-single";
}

function renderSpecButtons() {
  const box = $("#drawActions");
  box.innerHTML = "";
  if (!state.current) return;
  if (!state.current.specs.length) {
    box.innerHTML = `<div class="empty-tip">该商品无公开随机包规格，未开放拆卡；可切换到「卡表」浏览全部卡牌。</div>`;
    return;
  }
  for (const sp of state.current.specs) {
    const b = document.createElement("button");
    b.className = `btn ${specBtnClass(sp)}` + (state.spec && state.spec.key === sp.key ? " spec-active" : "");
    b.innerHTML = `<span class="btn-title">开包 · ${escapeHtml(sp.short)}</span>
      <span class="btn-sub">${escapeHtml(sp.note || sp.label)}</span>`;
    b.addEventListener("click", () => { state.spec = sp; renderSpecButtons(); draw(sp, 1); });
    box.appendChild(b);
  }
  const dflt = state.current.specs.find((x) => x.default) || state.current.specs[0];
  const ten = document.createElement("button");
  ten.className = "btn draw-ten";
  ten.innerHTML = `<span class="btn-title">十连</span><span class="btn-sub">10 包 · ${escapeHtml(dflt.short)}</span>`;
  ten.addEventListener("click", () => draw(dflt, 10));
  box.appendChild(ten);
  const prob = document.createElement("button");
  prob.className = "btn btn-ghost";
  prob.innerHTML = `<span class="btn-title">概率公示</span>`;
  prob.addEventListener("click", showProbabilities);
  box.appendChild(prob);
}

async function loadSetCards(id) {
  if (state.cards.has(id)) return state.cards.get(id);
  const cards = await DATA.cards(id);
  state.cards.set(id, cards);
  fillRarityFilter(cards);
  return cards;
}

/* ---------------- 抽卡 ---------------- */
async function draw(spec, packs) {
  if (!state.current || state.drawing) return;
  state.drawing = true;
  $$(".draw-actions .btn").forEach((b) => (b.disabled = true));
  try {
    const data = await DATA.draw(state.current.id, spec, packs);
    state.packs = data.packs;
    state.packIdx = 0;
    state.flipped = data.packs.map(() => new Set());
    // 抽卡记录/统计/收藏在卡牌全部翻开后才写入（见 maybeRecordPack）
    state.pending = { spec, recorded: data.packs.map(() => false) };
    openOverlay(spec, packs);
  } catch (e) {
    toast(`拆卡失败：${e.message}`, 3000);
  } finally {
    state.drawing = false;
    $$(".draw-actions .btn").forEach((b) => (b.disabled = false));
  }
}

/* ---------------- 开包遮罩 ---------------- */
function openOverlay(spec, packs) {
  const ov = $("#overlay");
  ov.hidden = false;
  $("#packStage").hidden = false;
  $("#cardsStage").hidden = true;
  const pack = $("#pack");
  pack.classList.remove("burst");
  pack.style.display = "";
  $("#packLabel").textContent = `${state.current.name} · ${spec.label}`;
  pack.dataset.specKey = spec.key;
  pack.dataset.packs = packs;
  $("#packStage").querySelector(".pack-hint").textContent = "点击卡包 撕开！";
}

function burstPack() {
  const pack = $("#pack");
  if (pack.classList.contains("burst")) return;
  pack.classList.add("burst");
  setTimeout(showCards, 480);
}

function showCards() {
  $("#packStage").hidden = true;
  const stage = $("#cardsStage");
  stage.hidden = false;
  const multi = state.packs.length > 1;
  $("#packNav").hidden = !multi;
  if (multi) renderPackTabs();
  renderPackRow();
}

function renderPackTabs() {
  const tabs = $("#packTabs");
  tabs.innerHTML = "";
  state.packs.forEach((_, i) => {
    const b = document.createElement("button");
    b.className = "pack-tab" + (i === state.packIdx ? " active" : "");
    b.textContent = i + 1;
    b.addEventListener("click", () => { state.packIdx = i; renderPackTabs(); renderPackRow(); });
    tabs.appendChild(b);
  });
}

function renderPackRow() {
  const row = $("#cardsRow");
  row.innerHTML = "";
  const pack = state.packs[state.packIdx];
  const auto = $("#autoFlip").checked;
  const stagger = auto
    ? Math.min(36, Math.floor(600 / Math.max(pack.length, 1)))
    : Math.min(90, Math.floor(1200 / Math.max(pack.length, 1)));
  pack.forEach((c, i) => {
    const el = document.createElement("div");
    el.className = "gcard back dealt" + (auto ? " fast" : "");
    el.dataset.rarity = c.rarity || "N";
    el.style.animationDelay = `${i * stagger}ms`;
    el.innerHTML = `
      <div class="gcard-inner">
        <div class="gface back"></div>
        <div class="gface front"><img decoding="async" src="${thumbURL(c)}" alt="${escapeHtml(c.cardName)}"></div>
      </div>`;
    el.addEventListener("click", () => flipCard(el, i));
    row.appendChild(el);
  });
  $("#navPrev").disabled = state.packIdx === 0;
  $("#navNext").disabled = state.packIdx === state.packs.length - 1;
  renderPackSummary();
  if (auto) setTimeout(() => flipAll(), stagger * pack.length + 420);
}

function renderPackSummary() {
  let box = $(".pack-summary");
  if (!box) {
    box = document.createElement("div");
    box.className = "pack-summary";
    $("#cardsRow").after(box);
  }
  const pack = state.packs[state.packIdx];
  const done = state.flipped[state.packIdx].size;
  if (done < pack.length) { box.textContent = `点击卡牌翻开（${done}/${pack.length}）`; return; }
  maybeRecordPack(state.packIdx);
  const cnt = {};
  pack.forEach((c) => { const r = c.rarity || "N"; cnt[r] = (cnt[r] || 0) + 1; });
  const chips = RARITY_ORDER.filter((r) => cnt[r])
    .map((r) => `<span style="color:${RARITY_COLOR[r]};font-weight:800">${r}×${cnt[r]}</span>`).join("　");
  const specLabel = state.spec ? ` · ${state.spec.label}` : "";
  box.innerHTML = `第 ${state.packIdx + 1}/${state.packs.length} 包${specLabel}　${chips}`;
}

function flipCard(el, i) {
  if (!el.classList.contains("back")) return;
  el.classList.remove("back");
  state.flipped[state.packIdx].add(i);
  const r = el.dataset.rarity;
  if (RARITY_ORDER.indexOf(r) <= RARITY_ORDER.indexOf("RR")) {
    const burst = document.createElement("div");
    burst.className = "rarity-burst";
    el.appendChild(burst);
    setTimeout(() => burst.remove(), 1100);
  }
  renderPackSummary();
}

function flipAll() {
  const row = $$("#cardsRow .gcard");
  const gap = row[0] && row[0].classList.contains("fast") ? 22 : 60;
  row.forEach((el, i) => setTimeout(() => flipCard(el, i), i * gap));
}

/* 该包全部翻开后才写入抽卡记录、统计与收藏 */
function maybeRecordPack(pi) {
  const p = state.pending;
  if (!p || p.recorded[pi]) return;
  if (state.flipped[pi].size < state.packs[pi].length) return;
  p.recorded[pi] = true;
  const cards = state.packs[pi];
  addHistory(p.spec, 1, cards);
  addStats(state.current.id, cards, 1);
  addSpend(state.current.id, p.spec, 1);
  addColl(state.current.id, cards);
}

/* 关闭遮罩时把未翻完的包静默入账，保证统计不失真 */
function recordUnfinished() {
  const p = state.pending;
  if (!p) return;
  p.recorded.forEach((done, pi) => {
    if (done) return;
    p.recorded[pi] = true;
    const cards = state.packs[pi];
    addHistory(p.spec, 1, cards);
    addStats(state.current.id, cards, 1);
    addSpend(state.current.id, p.spec, 1);
    addColl(state.current.id, cards);
  });
  state.pending = null;
}

function closeOverlay() { recordUnfinished(); $("#overlay").hidden = true; }

/* ---------------- 历史记录 ---------------- */
function addHistory(spec, packs, result) {
  const rec = { time: new Date(), packs, setName: state.current ? state.current.name : "", specLabel: spec.label, money: spec && spec.priceCny ? spec.priceCny * packs : 0, flat: result.flat() };
  state.history.unshift(rec);
  if (state.history.length > 30) state.history.pop();
  store.set("ptcg_history", state.history);
  renderHistory();
}

function loadHistory() {
  state.history = (store.get("ptcg_history", []) || []).map((r) => ({ ...r, time: new Date(r.time) }));
  if (state.history.length) renderHistory();
}

function renderHistory() {
  const box = $("#history");
  if (!state.history.length) {
    box.innerHTML = `<div class="empty-tip">还没有记录，去拆一发吧！</div>`;
    return;
  }
  box.innerHTML = "";
  for (const rec of state.history) {
    const div = document.createElement("div");
    div.className = "draw-record card-glass";
    div.innerHTML = `
      <div class="record-head">
        <b>${escapeHtml(rec.setName || (state.current ? state.current.name : ""))} · ${escapeHtml(rec.specLabel)} × ${rec.packs} 包</b>
        <span>${rec.money ? `¥${fmtMoney(rec.money)} · ` : ""}${rec.time.toLocaleTimeString("zh-CN")}</span>
      </div>
      <div class="record-cards"></div>`;
    const rc = div.querySelector(".record-cards");
    for (const c of rec.flat) {
      const m = document.createElement("div");
      m.className = "mini-card";
      m.dataset.rarity = c.rarity || "N";
      m.innerHTML = `
        <div class="frame"><img loading="lazy" decoding="async" src="${thumbURL(c)}" alt="${escapeHtml(c.cardName)}"></div>
        <div class="mc-name">${escapeHtml(c.cardName)}</div>
        <div class="mc-rar" style="color:${RARITY_COLOR[c.rarity] || RARITY_COLOR.N}">${RARITY_LABEL[c.rarity] || "其他"}</div>`;
      m.addEventListener("click", () => showDetail(c.setCode, c.cardIndex));
      rc.appendChild(m);
    }
    upgradeRemoteImages(rc);
    box.appendChild(div);
  }
}

/* ---------------- 统计 ---------------- */
function renderStats() {
  if (!state.current) return;
  const s = getStats(state.current.id);
  $("#stPacks").textContent = s.packs;
  $("#stCards").textContent = s.cards;
  const rrUp = RARITY_ORDER.slice(0, RARITY_ORDER.indexOf("RR") + 1).reduce((a, r) => a + (s.rarities[r] || 0), 0);
  $("#stRR").textContent = rrUp;
  const best = bestRarity(s.rarities);
  const el = $("#stBest");
  el.textContent = best || "—";
  el.style.color = best ? RARITY_COLOR[best] : "";
  const sp = getSpend(state.current.id);
  $("#stSpend").textContent = `¥${fmtMoney(sp.money)}`;
}

/* ---------------- 收藏册 ---------------- */
function renderCollection() {
  const sel = $("#collSet");
  if (!sel.options.length) {
    for (const s of state.sets) {
      const o = document.createElement("option");
      o.value = s.id;
      o.textContent = `${s.name}（${s.code}）`;
      sel.appendChild(o);
    }
    if (state.current) sel.value = state.current.id;
  }
  if (!sel.value && state.current) sel.value = state.current.id;
  const setId = sel.value;
  const box = getColl()[setId] || {};
  const sortMode = $("#collSort").value;
  const entries = Object.values(box).sort((a, b) => {
    if (sortMode === "index") return a.cardIndex.localeCompare(b.cardIndex, undefined, { numeric: true });
    if (sortMode === "name") return a.name.localeCompare(b.name, "zh-Hans-CN");
    if (sortMode === "count") return b.count - a.count || RARITY_ORDER.indexOf(a.rarity) - RARITY_ORDER.indexOf(b.rarity);
    return RARITY_ORDER.indexOf(a.rarity) - RARITY_ORDER.indexOf(b.rarity) || a.cardIndex.localeCompare(b.cardIndex);
  });
  const total = entries.reduce((a, e) => a + e.count, 0);
  $("#collSummary").innerHTML = entries.length
    ? `<span><b>${entries.length}</b>种卡牌</span><span><b>${total}</b>张总计</span>
       <span><b>${bestRarity(Object.fromEntries(entries.map((e) => [e.rarity, 1]))) || "—"}</b>最高稀有度</span>`
    : `<span>该弹还没有收藏记录</span>`;
  const grid = $("#collGrid");
  if (!entries.length) {
    grid.innerHTML = `<div class="empty-tip">抽到的卡会自动收藏在这里</div>`;
    return;
  }
  grid.innerHTML = "";
  for (const e of entries) {
    const d = document.createElement("div");
    d.className = "coll-card";
    d.innerHTML = `
      <img loading="lazy" decoding="async" src="${thumbURL(e)}" alt="${escapeHtml(e.name)}">
      <div class="cc-x">×${e.count}</div>
      <div class="cc-name">${rarBadge(e.rarity)}${escapeHtml(e.name)} <span>${escapeHtml(e.cardIndex)}</span></div>`;
    d.addEventListener("click", () => showDetail(e.setCode, e.cardIndex));
    grid.appendChild(d);
  }
  upgradeRemoteImages(grid);
}

function exportCollection() {
  const data = JSON.stringify(getColl(), null, 1);
  const blob = new Blob([data], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "ptcg_collection.json";
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ---------------- 卡表 ---------------- */
let clAll = [];
async function renderCardList() {
  if (!state.current) return;
  $("#clTitle").textContent = `${state.current.name} · 完整卡表`;
  let cards;
  try { cards = await loadSetCards(state.current.id); }
  catch (e) { $("#clGrid").innerHTML = `<div class="empty-tip">${escapeHtml(e.message)}</div>`; return; }
  clAll = cards;
  drawCardList();
}
function drawCardList() {
  const kw = $("#clSearch").value.trim().toLowerCase();
  const rar = $("#clRarity").value;
  const grid = $("#clGrid");
  const list = clAll.filter((c) =>
    (!rar || (c.rarity || "N") === rar) && (!kw || c.cardName.toLowerCase().includes(kw)));
  if (!list.length) { grid.innerHTML = `<div class="empty-tip">没有匹配的卡牌</div>`; return; }
  grid.innerHTML = "";
  for (const c of list) {
    const d = document.createElement("div");
    d.className = "cl-card";
    d.innerHTML = `
      <img loading="lazy" decoding="async" src="${thumbURL(c)}" alt="${escapeHtml(c.cardName)}">
      <div class="cl-name">${rarBadge(c.rarity || "N")}${escapeHtml(c.cardName)}</div>`;
    d.addEventListener("click", () => showDetail(c.setCode, c.cardIndex));
    grid.appendChild(d);
  }
  upgradeRemoteImages(grid);
}
function fillRarityFilter(cards) {
  const sel = $("#clRarity");
  const current = sel.value;
  const rs = [...new Set(cards.map((c) => c.rarity || "N"))]
    .sort((a, b) => RARITY_ORDER.indexOf(a) - RARITY_ORDER.indexOf(b));
  sel.innerHTML = `<option value="">全部稀有度</option>` +
    rs.map((r) => `<option value="${r}">${RARITY_LABEL[r] || r}</option>`).join("");
  sel.value = current && rs.includes(current) ? current : "";
}

/* ---------------- 概率公示 ---------------- */
function probSlotHtml(slot) {
  if (slot.fallback) {
    return `<div class="prob-slot"><h4>${escapeHtml(slot.name)}</h4>
      <p class="prob-note">该弹无对应稀有度结构，此槽位从全弹随机抽取。</p></div>`;
  }
  const lines = slot.probabilities.map((p) => `
    <div class="prob-line">
      <span class="pl-r" style="color:${RARITY_COLOR[p.rarity] || ""}">${p.rarity}</span>
      <span class="pl-bar"><i style="width:${(p.p * 100).toFixed(2)}%;background:${RARITY_COLOR[p.rarity] || "#888"}"></i></span>
      <span class="pl-p">${probPct(p.p)}（池 ${p.pool} 张）</span>
    </div>`).join("");
  const kindTag = slot.kind === "holo" ? "闪卡位" : "平卡位";
  return `<div class="prob-slot"><h4>${escapeHtml(slot.name)} <small>${kindTag}</small></h4>${lines}</div>`;
}
function probPct(p) {
  return (p * 100).toFixed(p * 100 >= 1 ? 1 : 2) + "%";
}

async function showProbabilities() {
  if (!state.current) return;
  $("#probTitle").textContent = `${state.current.name} · 概率公示`;
  $("#probBody").innerHTML = `<p class="prob-note">载入中…</p>`;
  $("#probOverlay").hidden = false;
  try {
    const data = await DATA.probabilities(state.current.id);
    const specHtml = data.specs.map((sp) => {
      const variants = sp.variants.map((v) => `
        <div class="prob-variant">
          ${sp.variants.length > 1 ? `<h5>封入变体：${escapeHtml(v.note)}（每包随机）</h5>` : ""}
          ${v.slots.map(probSlotHtml).join("")}
        </div>`).join("");
      return `
        <div class="prob-spec">
          <h4 class="prob-spec-title">${escapeHtml(sp.label)}${sp.price ? ` · ${escapeHtml(sp.price)}` : ""}</h4>
          <p class="prob-note">${escapeHtml(sp.note)}</p>
          ${variants}
        </div>`;
    }).join("");
    $("#probBody").innerHTML = `
      ${specHtml}`;
  } catch (e) {
    $("#probBody").innerHTML = `<p class="prob-note">载入失败：${escapeHtml(e.message)}</p>`;
  }
}

/* ---------------- 卡牌详情 ---------------- */
async function showDetail(code, idx) {
  $("#detailTitle").textContent = "卡牌详情";
  $("#detailBody").innerHTML = `<p class="prob-note">载入中…</p>`;
  $("#detailOverlay").hidden = false;
  try {
    const data = await DATA.detail(code, idx);
    const c = data.data;
    if (!c) throw new Error("无数据");
    $("#detailTitle").textContent = c.name || "卡牌详情";
    const attr = c.pokemonAttr || {};
    const weak = attr.weakness ? `${ENERGY_ZH[attr.weakness.energy] || attr.weakness.energy} ${attr.weakness.value || ""}` : "—";
    const attacks = (attr.attack || []).map((a) => `
      <div class="d-attack">
        <b>${escapeHtml(a.name || "")}</b>　${escapeHtml(a.damage || "")}
        ${a.text ? `<div>${escapeHtml(a.text)}</div>` : ""}
      </div>`).join("");
    $("#detailBody").innerHTML = `
      <div class="d-img"><img src="${imgURL(c.setCode, c.cardIndex)}" alt="${escapeHtml(c.name)}"></div>
      <div class="d-info">
        <h4>${escapeHtml(c.name)} <span style="font-size:12px;color:var(--txt2)">${escapeHtml(c.nameEn || "")}</span></h4>
        <div class="d-sub">${escapeHtml(c.setCode)}-${escapeHtml(c.cardIndex)} · ${RARITY_LABEL[c.rarity] || c.rarity || "—"} · ${escapeHtml(c.artist || "")}</div>
        <div class="d-stats">
          <div><b>HP</b> ${attr.hp ?? "—"}</div>
          <div><b>属性</b> ${ENERGY_ZH[attr.energyType] || attr.energyType || "—"}</div>
          <div><b>阶段</b> ${escapeHtml(attr.stage || "—")}</div>
          <div><b>撤退</b> ${attr.retreatCost ?? "—"}</div>
          <div><b>弱点</b> ${weak}</div>
          <div><b>系列标记</b> ${escapeHtml(c.regulationMark || "—")}</div>
        </div>
        ${attr.ability && attr.ability.length ? `<div class="d-effect"><b>特性</b>
          ${attr.ability.map((a) => `\n${escapeHtml(a.name || "")}：${escapeHtml(a.text || "")}`).join("")}</div>` : ""}
        <div class="d-effect">${escapeHtml(c.description || "—")}</div>
        ${attacks ? `<div class="d-attacks">${attacks}</div>` : ""}
      </div>`;
    upgradeRemoteImages(document.querySelector("#detailBody"));
  } catch (e) {
    $("#detailBody").innerHTML = `<p class="prob-note">载入失败：${escapeHtml(e.message)}</p>`;
  }
}

/* ---------------- 设置：外观主题 ---------------- */
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  const info = $("#themeInfo");
  if (info) info.textContent = `当前：${t === "light" ? "浅色" : "深色"}模式`;
  const toggle = $("#themeToggle");
  if (toggle) toggle.checked = t === "light";
  // APK：状态栏/导航栏颜色跟随主题，保证全屏色彩统一
  if (nativeBridge && nativeBridge.setSystemBars) nativeBridge.setSystemBars(t === "light");
}

/* ---------------- 设置：版本更新检查 ---------------- */
const RELEASE_API = "https://api.github.com/repos/zsjy947/PTCG-gacha-simulator/releases/latest";
const RELEASE_PAGE = "https://github.com/zsjy947/PTCG-gacha-simulator/releases/latest";
let appVersion = "";
let latestDownload = "";

function cmpVersion(a, b) {
  const pa = String(a).split(".").map(Number), pb = String(b).split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

function setUpdateUI(text, downloadUrl) {
  $("#updateInfo").textContent = text;
  latestDownload = downloadUrl || "";
  $("#btnGoDownload").hidden = !latestDownload;
  // 发现新版时在「设置」标签上加红点提醒
  const dot = document.querySelector(".tab[data-tab='settings']");
  if (dot) {
    const mark = dot.querySelector(".upd-dot");
    if (latestDownload && !mark) {
      const s = document.createElement("i");
      s.className = "upd-dot";
      dot.appendChild(s);
    } else if (!latestDownload && mark) mark.remove();
  }
}

/* 轻提示：自动消失，用于更新检查等操作的明确反馈 */
function toast(msg, ms = 2400) {
  let t = document.querySelector("#toast");
  if (!t) {
    t = document.createElement("div");
    t.id = "toast";
    document.body.appendChild(t);
  }
  t.textContent = msg;
  // 触发重绘以重播过渡动画
  void t.offsetWidth;
  t.classList.add("show");
  clearTimeout(toast._h);
  toast._h = setTimeout(() => t.classList.remove("show"), ms);
}

async function checkUpdate(manual) {
  const btn = $("#btnCheckUpdate");
  if (manual) {
    setUpdateUI("正在检查更新…", null);
    if (btn) btn.disabled = true;
  }
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 5000); // 国内网络超时静默失败，不影响使用
  try {
    const r = await fetch(RELEASE_API, { signal: ctl.signal, headers: { Accept: "application/vnd.github+json" } });
    clearTimeout(timer);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const rel = await r.json();
    const latest = String(rel.tag_name || "").replace(/^v/, "");
    if (!/^\d+(\.\d+)*$/.test(latest)) throw new Error("版本号解析失败");
    if (cmpVersion(latest, appVersion) > 0) {
      // 优先给当前平台的安装包直链，找不到再退回 release 页面
      const ext = ASSET ? ".apk" : ".exe";
      const hit = (rel.assets || []).find((a) => a.name.endsWith(ext));
      setUpdateUI(`发现新版本 v${latest}（当前 v${appVersion}）`, hit ? hit.browser_download_url : RELEASE_PAGE);
      if (manual) toast(`发现新版本 v${latest}，点击「前往下载」更新`);
    } else {
      setUpdateUI(`已是最新版本 v${appVersion}`, null);
      if (manual) toast(`已是最新版本 v${appVersion}`);
    }
  } catch (e) {
    clearTimeout(timer);
    if (manual) {
      setUpdateUI("检查失败：暂时连不上 GitHub，请稍后重试或到项目主页查看", RELEASE_PAGE);
      toast("检查失败：暂时连不上 GitHub");
    } else setUpdateUI(`当前版本 v${appVersion}`, null);
  } finally {
    if (manual && btn) btn.disabled = false;
  }
}

async function initVersion() {
  try {
    appVersion = (ASSET ? window.__APP_VERSION__ : (await api("/api/version")).version) || "";
  } catch { appVersion = ""; }
  const about = $("#aboutVersion");
  if (about) about.textContent = appVersion ? `PTCG拆卡模拟器 v${appVersion}` : "PTCG拆卡模拟器";
  const sbV = $("#sbVersion");
  if (sbV && appVersion) sbV.textContent = `PTCG拆卡模拟器 v${appVersion}`;
  if (appVersion) checkUpdate(false);
}

/* ---------------- 设置：图片缓存 ---------------- */
const nativeBridge = (window.PTCGNative && window.PTCGNative.cacheSize) ? window.PTCGNative : null;

async function refreshCacheInfo() {
  const el = $("#cacheInfo");
  const card = $("#cacheCard");
  try {
    if (nativeBridge) {
      el.textContent = `已占用 ${nativeBridge.cacheSize()}`;
    } else if (!ASSET) {
      const info = await api("/api/cache/info");
      el.textContent = `已占用 ${info.label}`;
    } else {
      card.hidden = true;
    }
  } catch {
    card.hidden = true;
  }
}

async function clearImageCache() {
  if (!(await uiConfirm("清除全部已缓存的卡牌图片？清除后再次浏览需重新下载。"))) return;
  const btn = $("#btnClearCache");
  btn.disabled = true;
  try {
    if (nativeBridge) nativeBridge.clearCache();
    else await api("/api/cache/clear", { method: "POST" });
    imgBlobCache.clear();
    await refreshCacheInfo();
  } catch (e) {
    toast(`清除失败：${e.message}`, 3000);
  } finally {
    btn.disabled = false;
  }
}

/* ---------------- 事件绑定 ---------------- */
function init() {
  applyTheme(store.get("ptcg_theme", "dark"));
  loadHistory();
  initVersion();

  $$(".tab").forEach((t) => t.addEventListener("click", () => {
    $$(".tab").forEach((x) => x.classList.toggle("active", x === t));
    $$(".tab-page").forEach((p) => p.classList.toggle("active", p.id === `tab-${t.dataset.tab}`));
    if (t.dataset.tab === "collection") renderCollection();
    if (t.dataset.tab === "cardlist" && state.current) renderCardList();
    if (t.dataset.tab === "settings") refreshCacheInfo();
  }));

  $("#setSearch").addEventListener("input", (e) => filterSets(e.target.value));
  $("#setPicker").addEventListener("click", openSidebar);
  $("#sideClose").addEventListener("click", closeSidebar);
  $("#sidebarBackdrop").addEventListener("click", closeSidebar);
  $("#probClose").addEventListener("click", () => ($("#probOverlay").hidden = true));
  $("#detailClose").addEventListener("click", () => ($("#detailOverlay").hidden = true));
  [$("#probOverlay"), $("#detailOverlay")].forEach((ov) =>
    ov.addEventListener("click", (e) => { if (e.target === ov) ov.hidden = true; }));

  $("#pack").addEventListener("click", burstPack);
  $("#btnFlipAll").addEventListener("click", flipAll);
  $("#btnCloseOverlay").addEventListener("click", closeOverlay);
  $("#btnAgain").addEventListener("click", async () => {
    closeOverlay();
    const pack = $("#pack");
    const spec = state.current.specs.find((x) => x.key === pack.dataset.specKey) || state.spec;
    const packs = parseInt(pack.dataset.packs || "1", 10);
    setTimeout(() => draw(spec, packs), 250);
  });
  $("#navPrev").addEventListener("click", () => { if (state.packIdx > 0) { state.packIdx--; renderPackTabs(); renderPackRow(); } });
  $("#navNext").addEventListener("click", () => { if (state.packIdx < state.packs.length - 1) { state.packIdx++; renderPackTabs(); renderPackRow(); } });

  $("#autoFlip").checked = store.get("ptcg_autoflip", false);
  $("#autoFlip").addEventListener("change", (e) => store.set("ptcg_autoflip", e.target.checked));

  $("#btnClearStats").addEventListener("click", async () => {
    if (await uiConfirm("清空全部拆卡统计与拆卡记录？（收藏册与消费统计不受影响）")) clearStatsAll();
  });
  $("#btnClearSpend").addEventListener("click", async () => {
    if (await uiConfirm("清零全部消费统计？（拆卡记录不受影响）")) clearSpendAll();
  });
  $("#spendToggle").addEventListener("change", (e) => {
    store.set("ptcg_spend_enabled", e.target.checked);
    renderSpend();
  });
  $("#btnClearColl").addEventListener("click", async () => {
    if (await uiConfirm("清空全部收藏记录？")) { store.set(collKey(), {}); renderCollection(); }
  });
  $("#btnExportColl").addEventListener("click", exportCollection);
  $("#collSet").addEventListener("change", renderCollection);
  $("#collSort").addEventListener("change", renderCollection);
  $("#clRarity").addEventListener("change", drawCardList);
  $("#clSearch").addEventListener("input", drawCardList);

  $("#btnClearCache").addEventListener("click", clearImageCache);
  $("#btnCheckUpdate").addEventListener("click", () => checkUpdate(true));
  $("#btnGoDownload").addEventListener("click", () => {
    if (!latestDownload) return;
    if (ASSET) location.href = latestDownload; // WebView 导航触发 DownloadListener → 系统浏览器
    else window.open(latestDownload, "_blank");
  });
  $("#themeToggle").addEventListener("change", (e) => {
    const t = e.target.checked ? "light" : "dark";
    store.set("ptcg_theme", t);
    applyTheme(t);
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { closeOverlay(); closeSidebar(); $("#probOverlay").hidden = true; $("#detailOverlay").hidden = true; if (!$("#confirmOverlay").hidden) settleConfirm(false); }
    if (!$("#overlay").hidden && e.key === " ") { e.preventDefault(); burstPack(); }
  });

  $("#btnConfirmOk").addEventListener("click", () => settleConfirm(true));
  $("#btnConfirmCancel").addEventListener("click", () => settleConfirm(false));
  $("#confirmOverlay").addEventListener("click", (e) => { if (e.target === e.currentTarget) settleConfirm(false); });

  loadSets().then(renderSpend);
  renderSpend();
}

(async () => { await restoreStore(); init(); })();
