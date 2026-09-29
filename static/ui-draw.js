/* 开包：规格按钮/抽卡入口/遮罩时序链/历史与统计渲染 —— 自 static/app.js 拆分（语义等价，见 docs/ARCHITECTURE.md） */
"use strict";

/* ---------------- 规格按钮 ---------------- */
function specBtnClass(sp) {
  if (sp.packSize >= SPEC_FAT_MIN) return "draw-fat";
  if (sp.packSize >= SPEC_TEN_MIN) return "draw-pack";
  if (sp.packSize <= SPEC_REWARD_MAX) return "draw-reward";
  if ((sp.note || "").includes("全闪") || (sp.label || "").includes("宝石")) return "draw-gem";
  return "draw-single";
}

/* 行命名：仅规格本身含"瘦包/肥包"才用短名，其余用规格原名（10张装/4张装（全闪）等） */
function specRowLabel(sp) {
  const l = sp.label || "";
  if (l.includes("瘦包")) return "瘦包";
  if (l.includes("肥包")) return "肥包";
  return l;
}

function drawBtn(cls, title, sub, onClick, active) {
  const b = document.createElement("button");
  b.className = `btn ${cls}` + (active ? " spec-active" : "");
  b.innerHTML = `<span class="btn-title">${escapeHtml(title)}</span>` +
    (sub ? `<span class="btn-sub">${escapeHtml(sub)}</span>` : "");
  b.addEventListener("click", onClick);
  return b;
}

function renderSpecButtons() {
  const box = $("#drawActions");
  box.innerHTML = "";
  if (!state.current) return;
  if (!state.current.specs.length) {
    box.innerHTML = `<div class="empty-tip">该商品无公开随机包规格，未开放拆卡；可切换到「卡表」浏览全部卡牌。</div>`;
    return;
  }
  // 下拉手风琴：全宽规格行，点击展开 单包/十连/整盒（整盒按真实盒规抽数，无盒规的规格不提供）
  for (const sp of state.current.specs) {
    const wrap = document.createElement("div");
    wrap.className = "spec-acc" + (state.expandedSpec === sp.key ? " open" : "");
    const toggle = document.createElement("button");
    toggle.className = `btn pack-toggle ${specBtnClass(sp)}`;
    toggle.innerHTML = `
      <span class="pt-left">
        <span class="btn-title">${escapeHtml(specRowLabel(sp))}</span>
        <span class="btn-sub">${escapeHtml(sp.note || sp.label)}${sp.price ? ` · ${escapeHtml(sp.price)}` : ""}</span>
      </span>
      <span class="pt-caret">${state.expandedSpec === sp.key ? "▴" : "▾"}</span>`;
    toggle.addEventListener("click", () => {
      state.expandedSpec = state.expandedSpec === sp.key ? "" : sp.key;
      renderSpecButtons();
    });
    wrap.appendChild(toggle);
    const drop = document.createElement("div");
    drop.className = "spec-drop";
    if (state.expandedSpec !== sp.key) drop.hidden = true;
    drop.appendChild(drawBtn(specBtnClass(sp), "单包", "",
      () => { state.spec = sp; state.expandedSpec = sp.key; renderSpecButtons(); draw(sp, 1); },
      state.spec && state.spec.key === sp.key));
    drop.appendChild(drawBtn("draw-ten", "十连", "", () => draw(sp, 10)));
    if (sp.boxPacks) drop.appendChild(drawBtn("draw-box", "整盒", "", () => draw(sp, sp.boxPacks)));
    wrap.appendChild(drop);
    box.appendChild(wrap);
  }
  const ghost = document.createElement("div");
  ghost.className = "spec-ghost";
  ghost.appendChild(drawBtn("btn-ghost", "目标卡计算", "", showExpectedCost));
  ghost.appendChild(drawBtn("btn-ghost", "概率公示", "", showProbabilities));
  if (!ASSET || window.PTCGNative) {
    // exe / APK：卡图按弹预缓存入口（T5；小程序组件缓存不可控，不放该入口）
    const mark = readImgCacheMark(state.current.id);
    ghost.appendChild(drawBtn("btn-ghost", "离线缓存本弹卡图",
      mark ? `已于 ${cacheMarkDateZh(mark)}缓存 ${mark.count} 张` : "", openPrecache));
  }
  box.appendChild(ghost);
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
/* 稀有度计数与 RR+ 表达式、汇总条片段（renderBoxSummary/renderPackSummary/showReport 共用，FE-003） */
function rarityCounts(cards) {
  const cnt = {};
  for (const c of cards) {
    const r = c.rarity || "N";
    cnt[r] = (cnt[r] || 0) + 1;
  }
  return cnt;
}

function rrUpTo(cnt) {
  return RRUP_RARITIES.reduce((a, r) => a + (cnt[r] || 0), 0);
}

function renderChips(cnt, style, sep) {
  return RARITY_ORDER.filter((r) => cnt[r])
    .map((r) => `<span style="color:${escapeHtml(RARITY_COLOR[r])}${style}">${r}×${cnt[r]}</span>`).join(sep);
}

/* ---------------- 整盒理论参照行（汇总条，数据来自引擎 boxProfile） ---------------- */
/* 「最高期望稀有度」候选排除低展示档：平卡/符号/特款等非划档档位不参与，按 RARITY_ORDER 取最高档 */
const BOX_THEORY_LOW = new Set(["C", "U", "N", "●", "◆", "★", "★★", "★★★", "无标记"]);
let _boxTheory = { key: "", line: "" };

function buildBoxTheoryLine(sp, pools) {
  const profiles = G().boxProfile(sp, pools);
  if (!profiles.length) return "";
  // 变体每包等概率随机落位 → 期望/出现率对变体取平均即整盒边缘值
  const eAvg = {}, pAvg = {};
  for (const p of profiles) {
    for (const [r, e] of Object.entries(p.expectedCount)) eAvg[r] = (eAvg[r] || 0) + e / profiles.length;
    for (const [r, q] of Object.entries(p.pAtLeastOne)) pAvg[r] = (pAvg[r] || 0) + q / profiles.length;
  }
  const keys = Object.keys(eAvg);
  const rr = keys.reduce((a, r) => a + (RRUP_RARITIES.includes(r) ? eAvg[r] : 0), 0);
  let line = `理论：RR+ 期望 ${rr.toFixed(1)} 张`;
  const top = RARITY_ORDER.find((r) => r in eAvg && eAvg[r] >= 0.05 && !BOX_THEORY_LOW.has(r));
  if (top) line += ` · ${top} 出现率 ${(pAvg[top] * 100).toFixed(1)}%`;
  // 理论回本：每稀有度池内有价卡单价均值（无价卡剔除、池内无一有价该档不计）→ E[卡值]/盒花费
  if (sp.priceCny && PRICE_MAP && setPriced(state.packs[0][0].setCode)) {
    let ev = 0;
    for (const r of keys) {
      const prices = (pools[r] || []).map((c) => priceOf(c.setCode, c.cardIndex)).filter((p) => p != null);
      if (prices.length) ev += eAvg[r] * (prices.reduce((a, p) => a + p, 0) / prices.length);
    }
    const money = sp.boxPacks * sp.priceCny;
    if (money > 0) line += ` · 理论回本 ${Math.round((ev * sp.boxPacks / money) * 100)}%`;
  }
  return line;
}

/* 汇总条理论行：整盒（包数=盒规）才显示；全量规格视图（web 简表无 slots）经 DATA.calcData
 * 异步取得后构建并重渲染（键含 弹/规格/包数，翻卡期间不重复计算） */
function boxTheoryLine() {
  const sp = activeSpec();
  const firstCard = state.packs[0] && state.packs[0][0];
  if (!sp || !sp.boxPacks || !firstCard || state.packs.length !== sp.boxPacks) return "";
  const key = `${state.current.id}|${sp.key}|${state.packs.length}`;
  if (_boxTheory.key === key) return _boxTheory.line;
  DATA.calcData(state.current.id).then(({ views, pools }) => {
    const view = views.find((v) => v.key === sp.key) || sp;
    _boxTheory = { key, line: buildBoxTheoryLine(view, pools) };
    renderBoxSummary();
  }).catch(() => {});
  return "";
}

/* 当前入账规格：本次开包未结束时用开包规格，否则用面板选中规格 */
function activeSpec() {
  return (state.pending && state.pending.spec) || state.spec;
}

function openOverlay(spec, packs) {
  const ov = $("#overlay");
  ov.hidden = false;
  $("#packStage").hidden = false;
  $("#cardsStage").hidden = true;
  $("#btnReport").hidden = true;
  $("#btnAgain").hidden = true;
  $("#boxSummary").hidden = true;
  $("#boxSummary").innerHTML = "";
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
  setTimeout(showCards, BURST_TO_CARDS_MS);
}

function showCards() {
  $("#packStage").hidden = true;
  const stage = $("#cardsStage");
  stage.hidden = false;
  const multi = state.packs.length > 1;
  $("#packNav").hidden = !multi;
  if (multi) renderPackTabs();
  renderBoxSummary();
  $("#btnReport").hidden = false;
  renderPackRow();
}

/* 汇总条：多包连开时统计（含花费）。
 * 未翻完全部包时显示拆卡进度（不剧透内容）；全部翻开后（无论在哪一页）
 * 静默变为完整汇总。块高恒定，无跳变、无空白占位。 */
function renderBoxSummary() {
  const el = $("#boxSummary");
  const last = state.packIdx === state.packs.length - 1;
  $("#btnAgain").hidden = !last;
  if (state.packs.length <= 1) { el.hidden = true; return; }
  el.hidden = false;
  const total = state.packs.length;
  const flippedCount = state.flipped.reduce((n, s, i) => n + (s.size >= state.packs[i].length ? 1 : 0), 0);
  if (flippedCount < total) {
    el.classList.add("progress");
    el.innerHTML = `
      <div class="bs-row">
        <span class="bs-title">${total} 包汇总</span>
        <span class="bs-stat">已翻开 ${flippedCount}/${total} 包</span>
      </div>
      <div class="bs-progress"><i style="width:${Math.max(6, Math.round((flippedCount / total) * 100))}%"></i></div>`;
    return;
  }
  el.classList.remove("progress");
  const cnt = rarityCounts(state.packs.flat());
  const rrUp = rrUpTo(cnt);
  const best = bestRarity(cnt);
  const sp = activeSpec();
  const money = sp && sp.priceCny ? sp.priceCny * state.packs.length : 0;
  const chips = renderChips(cnt, "", " · ");
  // 卡值/回本：该弹有价格数据时才显示（快照未覆盖的弹不占位）；空包守卫（FE-008）
  const firstCard = state.packs[0] && state.packs[0][0];
  const valStat = firstCard && setPriced(firstCard.setCode)
    ? `<span class="bs-stat">${valueLineHtml(packValue(state.packs.flat()), money)}</span>` : "";
  el.innerHTML = `
    <div class="bs-row">
      <span class="bs-title">${state.packs.length} 包汇总</span>
      <span class="bs-stat">RR+ 共 <b>${rrUp}</b> 张</span>
      <span class="bs-stat">最高 <b style="color:${escapeHtml(RARITY_COLOR[best] || "")}">${best || "—"}</b></span>
      ${money ? `<span class="bs-stat">合计 <b>¥${fmtMoney(money)}</b></span>` : ""}
      ${valStat}
    </div>
    <div class="box-chips">${chips}</div>
    ${(() => { const t = boxTheoryLine(); return t ? `<div class="bs-theory">${escapeHtml(t)}</div>` : ""; })()}`;
}

/* 页码分页：严格单行。≤PAGE_WINDOW 包全显；更多时 1 … P-1 P P+1 … N 窗口（近边界补页） */
function packPagesList(n, cur) {
  if (n <= PAGE_WINDOW) return Array.from({ length: n }, (_, i) => i + 1);
  if (cur <= 3) return [1, 2, 3, 4, 5, "…", n];                    // 首部：1 2 3 4 5 … n
  if (cur >= n - 2) return [1, "…", n - 4, n - 3, n - 2, n - 1, n]; // 尾部：1 … n-4 … n
  return [1, "…", cur - 1, cur, cur + 1, "…", n];                   // 中部：1 … p-1 p p+1 … n
}

function renderPackTabs() {
  const tabs = $("#packTabs");
  const n = state.packs.length;
  const cur = state.packIdx + 1;
  tabs.innerHTML = packPagesList(n, cur).map((p) =>
    p === "…"
      ? `<span class="pack-tab ellipsis">…</span>`
      : `<button class="pack-tab${p === cur ? " active" : ""}" data-p="${p}">${p}</button>`
  ).join("");
  $$("#packTabs .pack-tab[data-p]").forEach((b) =>
    b.addEventListener("click", () => {
      state.packIdx = Number(b.dataset.p) - 1;
      renderPackTabs();
      renderPackRow();
    }));
}

function renderPackRow() {
  const row = $("#cardsRow");
  row.innerHTML = "";
  const pack = state.packs[state.packIdx];
  const auto = $("#autoFlip").checked;
  const stagger = auto
    ? Math.min(STAGGER_FAST_CAP_MS, Math.floor(STAGGER_FAST_SPAN_MS / Math.max(pack.length, 1)))
    : Math.min(STAGGER_SLOW_CAP_MS, Math.floor(STAGGER_SLOW_SPAN_MS / Math.max(pack.length, 1)));
  pack.forEach((c, i) => {
    // 已翻过的卡回看时直接显示正面（无动画、无需重翻）
    const already = state.flipped[state.packIdx].has(i);
    const el = document.createElement("div");
    el.className = "gcard dealt" + (already ? "" : " back") + (auto && !already ? " fast" : "");
    el.dataset.rarity = c.rarity || "N";
    el.style.animationDelay = already ? "0ms" : `${i * stagger}ms`;
    el.innerHTML = `
      <div class="gcard-inner">
        <div class="gface back"></div>
        <div class="gface front"><img decoding="async" src="${escapeHtml(thumbURL(c))}" alt="${escapeHtml(c.cardName)}" onerror="__imgFail(this)"></div>
      </div>`;
    el.addEventListener("click", () => flipCard(el, i));
    row.appendChild(el);
  });
  $("#navPrev").disabled = state.packIdx === 0;
  $("#navNext").disabled = state.packIdx === state.packs.length - 1;
  renderPackSummary();
  renderBoxSummary();
  if (auto && pack.some((_, i) => !state.flipped[state.packIdx].has(i))) {
    setTimeout(() => flipAll(), stagger * pack.length + AUTOFLIP_EXTRA_MS);
  }
}

/* 单包小结条：定高三区（PC：稀有度｜包序｜卡价 三等宽单行方块），翻卡前后高度不变。
 * 未翻完时左右两区留空，翻满后静默填充；肥包稀有度过长时省略号截断（悬停看全量）。 */
function renderPackSummary() {
  let box = $(".pack-summary");
  if (!box) {
    box = document.createElement("div");
    box.className = "pack-summary";
    $("#cardsRow").after(box);
  }
  const pack = state.packs[state.packIdx];
  const done = state.flipped[state.packIdx].size;
  if (done < pack.length) {
    box.innerHTML = `<div class="ps-chips"></div><div class="ps-value"></div>`;
    return;
  }
  maybeRecordPack(state.packIdx);
  const cnt = rarityCounts(pack);
  const chips = renderChips(cnt, ";font-weight:800", "　");
  const chipsText = RARITY_ORDER.filter((r) => cnt[r]).map((r) => `${r}×${cnt[r]}`).join("　");
  const sp = activeSpec();
  const money = sp && sp.priceCny ? sp.priceCny : 0;
  const valLine = pack.length && setPriced(pack[0].setCode) ? valueLineHtml(packValue(pack), money) : "";
  box.innerHTML = `<div class="ps-chips" title="${escapeHtml(chipsText)}">${chips}</div>`
    + `<div class="ps-value">${valLine}</div>`;
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
    setTimeout(() => burst.remove(), RARITY_BURST_MS);
  }
  renderPackSummary();
  renderBoxSummary();
}

function flipAll() {
  const row = $$("#cardsRow .gcard");
  const gap = row[0] && row[0].classList.contains("fast") ? FLIP_GAP_FAST_MS : FLIP_GAP_SLOW_MS;
  row.forEach((el, i) => setTimeout(() => flipCard(el, i), i * gap));
}

/* 单包入账四连写：抽卡记录/统计/消费/收藏（maybeRecordPack 与 recordUnfinished 共用，FE-002） */
function recordPackResult(pi) {
  const p = state.pending;
  const cards = state.packs[pi];
  addHistory(p.spec, 1, cards);
  addStats(state.current.id, cards, 1);
  addSpend(state.current.id, p.spec, 1);
  addColl(state.current.id, cards);
}

/* 该包全部翻开后才写入抽卡记录、统计与收藏 */
function maybeRecordPack(pi) {
  const p = state.pending;
  if (!p || p.recorded[pi]) return;
  if (state.flipped[pi].size < state.packs[pi].length) return;
  p.recorded[pi] = true;
  recordPackResult(pi);
}

/* 关闭遮罩时把未翻完的包静默入账，保证统计不失真 */
function recordUnfinished() {
  const p = state.pending;
  if (!p) return;
  p.recorded.forEach((done, pi) => {
    if (done) return;
    p.recorded[pi] = true;
    recordPackResult(pi);
  });
  state.pending = null;
}

function closeOverlay() { recordUnfinished(); $("#overlay").hidden = true; }

/* ---------------- 历史记录 ---------------- */
function addHistory(spec, packs, result) {
  const rec = { time: new Date(), packs, setName: state.current ? state.current.name : "", specLabel: spec.label, money: spec && spec.priceCny ? spec.priceCny * packs : 0, flat: result.flat() };
  state.history.unshift(rec);
  if (state.history.length > HISTORY_LIMIT) state.history.pop();
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
        <div class="frame"><img loading="lazy" decoding="async" src="${escapeHtml(thumbURL(c))}" alt="${escapeHtml(c.cardName)}" onerror="__imgFail(this)"></div>
        <div class="mc-name">${escapeHtml(c.cardName)}</div>
        <div class="mc-rar" style="color:${escapeHtml(RARITY_COLOR[c.rarity] || RARITY_COLOR.N)}">${RARITY_LABEL[c.rarity] || "其他"}</div>`;
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
  const rrUp = rrUpTo(s.rarities);
  $("#stRR").textContent = rrUp;
  const best = bestRarity(s.rarities);
  const el = $("#stBest");
  el.textContent = best || "—";
  el.style.color = best ? RARITY_COLOR[best] : "";
  const sp = getSpend(state.current.id);
  $("#stSpend").textContent = `¥${fmtMoney(sp.money)}`;
  renderCompare(s);
  renderDist(s.rarities);
}

/* ---------------- 实测对照（T2）：各稀有度实测占比 vs 划档模型期望占比 ----------------
 * 样本 ≥30 包才自动展开；规格用面板当前选中规格的首变体口径（全量视图经 DATA.calcData 取得） */
const CMP_MIN_PACKS = 30;
let _cmpProfile = { key: "", profile: null, variants: 1 };

function cmpTableHtml(s, profile) {
  const expectTotal = Object.values(profile.expectedCount).reduce((a, b) => a + b, 0);
  const rows = Object.keys(profile.expectedCount)
    .sort((a, b) => RARITY_ORDER.indexOf(a) - RARITY_ORDER.indexOf(b))
    .map((r) => {
      const act = s.rarities[r] || 0;
      const actShare = s.cards ? act / s.cards : 0;
      const expShare = profile.expectedCount[r] / expectTotal;
      const dev = actShare - expShare;
      const devText = `${dev >= 0 ? "+" : "−"}${(Math.abs(dev) * 100).toFixed(2)}%`;
      return `
        <tr>
          <td><span class="pl-r" style="color:${escapeHtml(RARITY_COLOR[r] || "")}">${escapeHtml(r)}</span></td>
          <td>${act}</td>
          <td>${(actShare * 100).toFixed(2)}%</td>
          <td>${(expShare * 100).toFixed(2)}%</td>
          <td><b class="bv ${dev >= 0 ? "val-up" : "val-down"}">${devText}</b></td>
        </tr>`;
    }).join("");
  return `<thead><tr><th>稀有度</th><th>实测张数</th><th>实测占比</th><th>理论期望占比</th><th>偏差</th></tr></thead><tbody>${rows}</tbody>`;
}

function renderCompare(s) {
  const card = $("#compareCard");
  if (!card) return;
  const sp = state.spec || (state.current.specs || [])[0] || null;
  if (!sp || !s.packs) { card.hidden = true; return; }
  card.hidden = false;
  const key = `${state.current.id}|${sp.key}`;
  const apply = () => {
    const { profile, variants } = _cmpProfile;
    $("#cmpTable").innerHTML = cmpTableHtml(s, profile);
    // 尾注：变体规格注明按首变体口径
    $("#cmpNote").textContent = "偏差来自随机波动与划档模型近似，不构成概率修正依据。"
      + (variants > 1 ? "多变体规格按首变体口径。" : "");
    const enough = s.packs >= CMP_MIN_PACKS;
    $("#cmpSummary").textContent = `已开 ${s.packs} 包`
      + (enough ? "" : " · 样本不足（<30 包），仅供参考");
    $("#cmpBox").open = enough;
  };
  if (_cmpProfile.key === key) { apply(); return; }
  DATA.calcData(state.current.id).then(({ views, pools }) => {
    const view = views.find((v) => v.key === sp.key) || sp;
    const profiles = G().rarityProfile(view, pools);
    _cmpProfile = { key, profile: profiles[0], variants: profiles.length };
    apply();
  }).catch(() => { card.hidden = true; });
}

/* 稀有度出货分布（本弹）：纯 CSS 条形，复用稀有度配色 */
function renderDist(rarities) {
  const card = $("#distCard"), bars = $("#distBars");
  if (!card) return;
  const rows = RARITY_ORDER.filter((r) => rarities[r]);
  if (!rows.length) { card.hidden = true; return; }
  const max = Math.max(...rows.map((r) => rarities[r]));
  bars.innerHTML = rows.map((r) => `
    <div class="dist-row">
      <span class="dist-r" style="color:${escapeHtml(RARITY_COLOR[r] || RARITY_COLOR.N)}">${r}</span>
      <span class="dist-bar"><i style="width:${(rarities[r] / max) * 100}%;background:${escapeHtml(RARITY_COLOR[r] || RARITY_COLOR.N)}"></i></span>
      <span class="dist-n">${rarities[r]}</span>
    </div>`).join("");
  card.hidden = false;
}
