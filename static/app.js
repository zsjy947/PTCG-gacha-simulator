/* 宝可梦卡牌 · 简中模拟抽卡 —— 前端逻辑 */
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

function cardImage(c) {
  return c.image || `/img/${c.setCode}/${c.cardIndex}`;
}
function thumbURL(c) {
  return `/thumb/${c.setCode}/${c.cardIndex}`;
}
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
  set(k, v) { localStorage.setItem(k, JSON.stringify(v)); },
};
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
function clearStats(setId) {
  const all = store.get(statsKey(), {});
  delete all[setId];
  store.set(statsKey(), all);
  renderStats();
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

/* ---------------- 弹列表 ---------------- */
async function loadSets() {
  const box = $("#setGroups");
  try {
    const data = await api("/api/sets");
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
        img.src = `/icon/${s.code}`;
        img.alt = "";
        img.onload = () => b.querySelector(".no-icon").replaceWith(img);
        img.onerror = () => {};
        b.addEventListener("click", () => selectSet(s.id));
        frag.appendChild(b);
      }
    }
    box.innerHTML = "";
    box.appendChild(frag);
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
    <div class="hero-icon"><img src="/icon/${s.code}" alt="" style="max-width:64px;max-height:48px;object-fit:contain" onerror="this.outerHTML='🎯'"></div>
    <div class="hero-info">
      <h2>${escapeHtml(s.name)}</h2>
      <p>${escapeHtml(s.group)} · ${s.count} 张卡牌</p>
      <div class="hero-meta">
        <span>弹代码 ${escapeHtml(s.code)}</span>
        ${s.specs.map((sp) => `<span>${escapeHtml(sp.label)}${sp.price ? ` · ${escapeHtml(sp.price)}` : ""}</span>`).join("")}
      </div>
    </div>`;
  renderSpecButtons();
  renderStats();
  loadSetCards(s.id).then(() => { if ($("#tab-cardlist").classList.contains("active")) renderCardList(); });
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
  const data = await api(`/api/sets/${encodeURIComponent(id)}/cards`);
  state.cards.set(id, data.cards);
  fillRarityFilter(data.cards);
  return data.cards;
}

/* ---------------- 抽卡 ---------------- */
async function draw(spec, packs) {
  if (!state.current || state.drawing) return;
  state.drawing = true;
  $$(".draw-actions .btn").forEach((b) => (b.disabled = true));
  try {
    const data = await api("/api/draw", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ set: state.current.id, spec: spec.key, packs }),
    });
    state.packs = data.packs;
    state.packIdx = 0;
    state.flipped = data.packs.map(() => new Set());
    openOverlay(spec, packs);
    addHistory(spec, packs, data.packs);
    const flat = data.packs.flat();
    addStats(state.current.id, flat, data.packs.length);
    addColl(state.current.id, flat);
  } catch (e) {
    alert(`抽卡失败：${e.message}`);
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
  const stagger = Math.min(90, Math.floor(1200 / Math.max(pack.length, 1)));
  pack.forEach((c, i) => {
    const el = document.createElement("div");
    el.className = "gcard back dealt";
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
  if (auto) setTimeout(() => flipAll(), stagger * pack.length + 650);
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
  row.forEach((el, i) => setTimeout(() => flipCard(el, i), i * 60));
}

function closeOverlay() { $("#overlay").hidden = true; }

/* ---------------- 历史记录 ---------------- */
function addHistory(spec, packs, result) {
  const rec = { time: new Date(), packs, specLabel: spec.label, flat: result.flat() };
  state.history.unshift(rec);
  if (state.history.length > 30) state.history.pop();
  renderHistory();
}

function renderHistory() {
  const box = $("#history");
  if (!state.history.length) {
    box.innerHTML = `<div class="empty-tip">还没有记录，去抽一发吧！</div>`;
    return;
  }
  box.innerHTML = "";
  for (const rec of state.history) {
    const div = document.createElement("div");
    div.className = "draw-record card-glass";
    div.innerHTML = `
      <div class="record-head">
        <b>${escapeHtml(state.current ? state.current.name : "")} · ${escapeHtml(rec.specLabel)} × ${rec.packs} 包</b>
        <span>${rec.time.toLocaleTimeString("zh-CN")}</span>
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
  } else if (state.current) {
    sel.value = state.current.id;
  }
  const setId = sel.value;
  const box = getColl()[setId] || {};
  const entries = Object.values(box).sort((a, b) =>
    RARITY_ORDER.indexOf(a.rarity) - RARITY_ORDER.indexOf(b.rarity) || a.cardIndex.localeCompare(b.cardIndex));
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
      <img loading="lazy" decoding="async" src="/thumb/${e.setCode}/${e.cardIndex}" alt="${escapeHtml(e.name)}">
      <div class="cc-x">×${e.count}</div>
      <div class="cc-name">${rarBadge(e.rarity)}${escapeHtml(e.name)} <span>${escapeHtml(e.cardIndex)}</span></div>`;
    d.addEventListener("click", () => showDetail(e.setCode, e.cardIndex));
    grid.appendChild(d);
  }
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
    const data = await api(`/api/sets/${encodeURIComponent(state.current.id)}/probabilities`);
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
      <p class="prob-note">官方未公布每张卡的精确出货率。本页展示的为程序<b>划档概率</b>（可在 config.py 中调整），
      规格依据官方发售公告：每弹的包张数与平卡/闪卡构成见下，槽位内部概率已按本弹实际稀有度卡池归一化。</p>
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
    const data = await api(`/api/card/${encodeURIComponent(code)}/${encodeURIComponent(idx)}`);
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
      <div class="d-img"><img src="/img/${c.setCode}/${c.cardIndex}" alt="${escapeHtml(c.name)}"></div>
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
  } catch (e) {
    $("#detailBody").innerHTML = `<p class="prob-note">载入失败：${escapeHtml(e.message)}</p>`;
  }
}

/* ---------------- 事件绑定 ---------------- */
function init() {
  $$(".tab").forEach((t) => t.addEventListener("click", () => {
    $$(".tab").forEach((x) => x.classList.toggle("active", x === t));
    $$(".tab-page").forEach((p) => p.classList.toggle("active", p.id === `tab-${t.dataset.tab}`));
    if (t.dataset.tab === "collection") renderCollection();
    if (t.dataset.tab === "cardlist" && state.current) renderCardList();
  }));

  $("#setSearch").addEventListener("input", (e) => filterSets(e.target.value));
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

  $("#btnClearStats").addEventListener("click", () => {
    if (state.current && confirm(`清空「${state.current.name}」的统计？`)) clearStats(state.current.id);
  });
  $("#btnClearColl").addEventListener("click", () => {
    if (confirm("清空全部收藏记录？")) { store.set(collKey(), {}); renderCollection(); }
  });
  $("#btnExportColl").addEventListener("click", exportCollection);
  $("#collSet").addEventListener("change", renderCollection);
  $("#clRarity").addEventListener("change", drawCardList);
  $("#clSearch").addEventListener("input", drawCardList);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { closeOverlay(); $("#probOverlay").hidden = true; $("#detailOverlay").hidden = true; }
    if (!$("#overlay").hidden && e.key === " ") { e.preventDefault(); burstPack(); }
  });

  loadSets();
}

init();
