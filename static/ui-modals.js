/* 弹窗：应用内确认/概率公示/卡牌详情/期望成本/拆卡战报 —— 自 static/app.js 拆分（语义等价，见 docs/ARCHITECTURE.md） */
"use strict";

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

/* ---------------- 概率公示 ---------------- */
/* 整盒理论折叠块（引擎 boxProfile，规格用 DATA.calcData 的全量视图；无盒规 → 不渲染） */
function probBoxHtml(view, pools) {
  const profiles = G().boxProfile(view, pools);
  if (!profiles.length) return "";
  const multi = profiles.length > 1;
  const tables = profiles.map((p) => {
    const rows = Object.keys(p.expectedCount)
      .sort((a, b) => RARITY_ORDER.indexOf(a) - RARITY_ORDER.indexOf(b))
      .map((r) => `
        <tr>
          <td><span class="pl-r" style="color:${escapeHtml(RARITY_COLOR[r] || "")}">${escapeHtml(r)}</span></td>
          <td>${p.expectedCount[r].toFixed(1)}</td>
          <td>${(p.pAtLeastOne[r] * 100).toFixed(1)}%</td>
        </tr>`).join("");
    return `${multi ? `<p class="prob-note pb-variant">封入变体：${escapeHtml(p.note)}（每包随机）</p>` : ""}
      <table class="expect-table prob-box-table">
        <thead><tr><th>稀有度</th><th>期望张数/盒</th><th>出现率</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }).join("");
  return `<details class="prob-box"><summary>整盒理论</summary>${tables}</details>`;
}

function probSlotHtml(slot) {
  if (slot.fallback) {
    return `<div class="prob-slot"><h4>${escapeHtml(slot.name)}</h4>
      <p class="prob-note">该弹无对应稀有度结构，此槽位从全弹随机抽取。</p></div>`;
  }
  const lines = slot.probabilities.map((p) => `
    <div class="prob-line">
      <span class="pl-r" style="color:${escapeHtml(RARITY_COLOR[p.rarity] || "")}">${escapeHtml(p.rarity)}</span>
      <span class="pl-bar"><i style="width:${(p.p * 100).toFixed(2)}%;background:${escapeHtml(RARITY_COLOR[p.rarity] || "#888")}"></i></span>
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
    const { probData, views, pools } = await DATA.calcData(state.current.id);
    const specHtml = probData.specs.map((sp) => {
      const variants = sp.variants.map((v) => `
        <div class="prob-variant">
          ${sp.variants.length > 1 ? `<h5>封入变体：${escapeHtml(v.note)}（每包随机）</h5>` : ""}
          ${v.slots.map(probSlotHtml).join("")}
        </div>`).join("");
      const view = views.find((v) => v.id === sp.id) || {};
      return `
        <div class="prob-spec">
          <h4 class="prob-spec-title">${escapeHtml(sp.label)}${sp.price ? ` · ${escapeHtml(sp.price)}` : ""}</h4>
          <p class="prob-note">${escapeHtml(sp.note)}</p>
          ${variants}
          ${probBoxHtml(view, pools)}
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
    const weak = attr.weakness ? `${ENERGY_ZH[attr.weakness.energy] || escapeHtml(attr.weakness.energy)} ${escapeHtml(attr.weakness.value || "")}` : "—";
    const attacks = (attr.attack || []).map((a) => `
      <div class="d-attack">
        <b>${escapeHtml(a.name || "")}</b>　${escapeHtml(a.damage || "")}
        ${a.text ? `<div>${escapeHtml(a.text)}</div>` : ""}
      </div>`).join("");
    $("#detailBody").innerHTML = `
      <div class="d-img"><img src="${escapeHtml(imgURL(c.setCode, c.cardIndex))}" alt="${escapeHtml(c.name)}" onerror="__imgFail(this)"></div>
      <div class="d-info">
        <h4>${escapeHtml(c.name)} <span style="font-size:12px;color:var(--txt2)">${escapeHtml(c.nameEn || "")}</span></h4>
        <div class="d-sub">${escapeHtml(c.setCode)}-${escapeHtml(c.cardIndex)} · ${escapeHtml(RARITY_LABEL[c.rarity] || c.rarity || "—")} · ${escapeHtml(c.artist || "")}</div>
        <div class="d-stats">
          <div><b>HP</b> ${escapeHtml(attr.hp ?? "—")}</div>
          <div><b>属性</b> ${ENERGY_ZH[attr.energyType] || escapeHtml(attr.energyType) || "—"}</div>
          <div><b>阶段</b> ${escapeHtml(attr.stage || "—")}</div>
          <div><b>撤退</b> ${escapeHtml(attr.retreatCost ?? "—")}</div>
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

/* ---------------- 目标卡期望成本计算（单卡 / 集齐 两页签） ----------------
 * 规格一律用 DATA.calcData 的全量视图（web 简表无 slots 会崩，FE-019） */
async function showExpectedCost() {
  if (!state.current) return;
  _collectBuilt = false; // 弹窗每次打开重建目标选择区
  $("#expectTitle").textContent = `${state.current.name} · 目标卡期望计算`;
  $("#expectBody").innerHTML = `
    <div class="exp-tabs">
      <button class="exp-tab active" data-tab="single">单卡</button>
      <button class="exp-tab" data-tab="collect">集齐</button>
    </div>
    <div id="expSingle"><p class="prob-note">计算中…</p></div>
    <div id="expCollect" hidden></div>`;
  $("#expectOverlay").hidden = false;
  $$("#expectBody .exp-tab").forEach((b) => b.addEventListener("click", () => {
    $$("#expectBody .exp-tab").forEach((x) => x.classList.toggle("active", x === b));
    $("#expSingle").hidden = b.dataset.tab !== "single";
    $("#expCollect").hidden = b.dataset.tab === "single";
    if (b.dataset.tab === "collect") renderCollectPane();
  }));
  try {
    const { views, pools } = await DATA.calcData(state.current.id);
    $("#expSingle").innerHTML = views.map((sp) => {
      const rows = G().expectedCost(sp, pools);
      const money = (r) => sp.priceCny && Number.isFinite(r.cardPacks)
        ? `¥${fmtMoney(Math.round(r.cardPacks * sp.priceCny))}` : "—";
      const body = rows.map((r) => `
        <tr>
          <td><span class="pl-r" style="color:${escapeHtml(RARITY_COLOR[r.rarity] || "")}">${escapeHtml(r.rarity)}</span></td>
          <td>${r.pool} 张</td>
          <td>${probPct(r.pPack)}</td>
          <td>${Number.isFinite(r.anyPacks) ? Math.ceil(r.anyPacks) : "—"} 包</td>
          <td>${Number.isFinite(r.cardPacks) ? Math.ceil(r.cardPacks) : "—"} 包</td>
          <td>${money(r)}</td>
        </tr>`).join("");
      return `
        <div class="prob-spec">
          <h4 class="prob-spec-title">${escapeHtml(sp.label)}${sp.price ? ` · ${escapeHtml(sp.price)}` : ""}</h4>
          <table class="expect-table">
            <thead><tr><th>稀有度</th><th>池</th><th>单包出现率</th><th>任一该稀有度</th><th>指定一张卡</th><th>期望花费</th></tr></thead>
            <tbody>${body}</tbody>
          </table>
        </div>`;
    }).join("") + `<p class="prob-note">基于划档概率模型的数学期望（几何分布），仅估算"平均而言"，非保底承诺；实际所需包数波动可能很大。</p>`;
  } catch (e) {
    $("#expSingle").innerHTML = `<p class="prob-note">计算失败：${escapeHtml(e.message)}</p>`;
  }
}

/* 「集齐」页签：目标三选一 → 逐规格期望包数/花费（稀有度闭式公式，卡集合蒙特卡洛） */
let _collectBuilt = false;

/* targets 形状声明见 shared/gacha.d.ts（Targets） */
/** @returns {{ targets?: import("../shared/gacha").Targets, label?: string, empty?: string }} */
function collectTargets(views, pools) {
  const sel = $("#ctRarity");
  const kind = /** @type {HTMLInputElement} */ (document.querySelector('#expectBody input[name="ct"]:checked'))?.value || "rarity";
  if (kind === "rrup") {
    const rs = RRUP_RARITIES.filter((r) => pools[r]);
    return { targets: { kind: "rarity", rarities: rs }, label: `集齐 RR+ 及以上（${rs.length} 档全部卡）` };
  }
  if (kind === "missing") {
    const have = new Set(Object.keys(getColl()[state.current.id] || {}));
    const cards = state.cards.get(state.current.id) || [];
    const keys = cards.filter((c) => !have.has(`${c.setCode}__${c.cardIndex}`)).map((c) => `${c.setCode}__${c.cardIndex}`);
    if (!keys.length) return { empty: "收藏册该弹暂无缺卡（可能还没收藏记录，先去拆卡吧）" };
    return { targets: { kind: "cards", keys }, label: `集齐收藏册缺卡（${keys.length} 张）` };
  }
  const r = sel && sel.value;
  if (!r || !pools[r]) return { empty: "请选择目标稀有度" };
  return { targets: { kind: "rarity", rarities: [r] }, label: `集齐 ${r} 全部（${(pools[r] || []).length} 张）` };
}

async function renderCollectPane() {
  const pane = $("#expCollect");
  try {
    const { views, pools } = await DATA.calcData(state.current.id);
    if (!_collectBuilt) {
      const rarities = Object.keys(pools).sort((a, b) => RARITY_ORDER.indexOf(a) - RARITY_ORDER.indexOf(b));
      pane.innerHTML = `
        <div class="collect-target">
          <label class="ct-item"><input type="radio" name="ct" value="rarity" checked>某稀有度全部</label>
          <select id="ctRarity" class="ct-select">
            ${rarities.map((r) => `<option value="${escapeHtml(r)}">${escapeHtml(RARITY_LABEL[r] || r)}（${(pools[r] || []).length} 张）</option>`).join("")}
          </select>
          <label class="ct-item"><input type="radio" name="ct" value="rrup">RR+ 及以上</label>
          <label class="ct-item"><input type="radio" name="ct" value="missing">收藏册缺卡</label>
        </div>
        <div class="ct-label prob-note">在上方选择集齐目标，按规格给出期望包数与花费。</div>
        <div id="ctResults"></div>`;
      $$('#expectBody input[name="ct"]').forEach((r) => r.addEventListener("change", runCollect));
      $("#ctRarity").addEventListener("change", runCollect);
      _collectBuilt = true;
      runCollect();
    }
  } catch (e) {
    pane.innerHTML = `<p class="prob-note">计算失败：${escapeHtml(e.message)}</p>`;
  }
}

/* 缺卡目标可能极大（接近全图鉴时单试验要数千包）：按「集齐期望」闭式估计（各目标稀有度
 * Tier 的集齐期望包数取最大）把试验数压进固定包数预算。预算只依赖目标构成（不看墙钟）
 * ——同种子重复计算仍逐位一致；重型目标每批只跑 1 次试验，保证计算期间界面流畅可取消。
 * 下限 12 次保证中位/P90 可读（结果注记实际次数），上限 300 保持小目标统计精度。 */
function collectSimPlan(view, pools, targets) {
  const BUDGET_PACKS = 8000, MIN_TRIALS = 12, MAX_TRIALS = 300;
  let est = 0;
  try {
    const perRarity = {};
    const byKey = new Map();
    for (const r of Object.keys(pools)) for (const c of pools[r]) byKey.set(`${c.setCode}__${c.cardIndex}`, c);
    for (const k of (targets.keys || [])) {
      const c = byKey.get(k);
      if (c) perRarity[c.rarity || "N"] = (perRarity[c.rarity || "N"] || 0) + 1;
    }
    const profile = G().rarityProfile(view, pools)[0] || { expectedCount: {} };
    for (const [r, n] of Object.entries(perRarity)) {
      const poolSize = (pools[r] || []).length;
      const lambda = profile.expectedCount[r] || 0;
      if (lambda <= 0 || !poolSize) return { trials: MIN_TRIALS, batch: 1 };
      let h = 0;
      for (let k = 1; k <= n; k++) h += 1 / k;
      est = Math.max(est, (poolSize * h) / lambda);
    }
  } catch { est = 0; }
  const trials = est > 0
    ? Math.max(MIN_TRIALS, Math.min(MAX_TRIALS, Math.round(BUDGET_PACKS / est)))
    : MAX_TRIALS;
  return { trials, batch: est > 300 ? 1 : 3 };
}

let _ctRun = 0; // 运行号：重选目标 / 取消 / 关闭弹窗都会使在途计算失效

function ctDead(runId) { return runId !== _ctRun || $("#expectOverlay").hidden; }

function collectRowsHtml(views, rows, simMode, noteExtra = "") {
  return `
    <table class="expect-table">
      <thead><tr><th>规格</th><th>期望包数</th><th>期望花费</th>${simMode ? "<th>中位 / P90</th>" : ""}</tr></thead>
      <tbody>
        ${views.map((sp, i) => {
          const res = rows[i] || {};
          return `
          <tr>
            <td>${escapeHtml(sp.label)}</td>
            <td>${res.expectedPacks != null ? `${res.expectedPacks.toFixed(1)} 包` : "—"}</td>
            <td>${res.expectedSpend != null ? `¥${fmtMoney(Math.round(res.expectedSpend))}` : "—"}</td>
            ${simMode ? `<td>${res.expectedPacks != null ? `中位 ${res.medianPacks} · P90 ${res.p90Packs} 包` : "—"}</td>` : ""}
          </tr>`;
        }).join("")}
      </tbody>
    </table>
    ${rows[0] && rows[0].note ? `<p class="prob-note">${escapeHtml(rows[0].note + noteExtra)}</p>` : ""}`;
}

async function runCollect() {
  const box = $("#ctResults");
  if (!box) return;
  const runId = ++_ctRun;
  const { views, pools } = await DATA.calcData(state.current.id);
  if (ctDead(runId)) return;
  const { targets, label, empty } = collectTargets(views, pools);
  $("#ctResults").previousElementSibling.textContent = empty || label;
  if (empty) { box.innerHTML = ""; return; }
  const simMode = targets.kind === "cards";
  if (!simMode) {
    // 闭式公式：毫秒级，同步算完
    box.innerHTML = `<p class="prob-note">计算中…</p>`;
    await new Promise((r) => setTimeout(r, 30));
    if (ctDead(runId)) return;
    const rows = views.map((sp) => G().collectExpectation(sp, pools, targets, { trials: 300, packCap: 3000 }));
    box.innerHTML = collectRowsHtml(views, rows, false);
    return;
  }
  // 卡集合目标（蒙特卡洛）：引擎分批执行，批间让出主线程——页面不卡死、可取消；
  // 试验数逐规格自适应（瘦包/肥包单试验成本差可达数倍）
  const plans = views.map((sp) => collectSimPlan(sp, pools, targets));
  const runners = views.map((sp, i) => G().collectSimBatched(sp, pools, targets,
    { trials: plans[i].trials, packCap: 3000, batch: plans[i].batch }));
  const total = runners.reduce((a, r) => a + r.trials, 0);
  box.innerHTML = `
    <p class="prob-note">蒙特卡洛计算中：已算 <b id="ctDone">0</b>/${total} 次试验，可随时取消。</p>
    <div class="bs-progress" style="margin-bottom:10px"><i id="ctBar" style="width:0%"></i></div>
    <button class="mini-btn" id="ctCancel">取消计算</button>`;
  $("#ctCancel").addEventListener("click", () => {
    _ctRun++;
    box.innerHTML = `<p class="prob-note">已取消计算，可重新选择目标再算。</p>`;
  });
  const results = [];
  let doneTotal = 0;
  for (let i = 0; i < runners.length; i++) {
    const r = runners[i];
    for (;;) {
      if (ctDead(runId)) return;
      const st = r.next();
      const dn = doneTotal + st.done;
      const bar = $("#ctBar"), tx = $("#ctDone");
      if (bar) bar.style.width = `${Math.round((dn / total) * 100)}%`;
      if (tx) tx.textContent = String(dn);
      if (st.finished) { doneTotal += r.trials; results.push(st.result); break; }
      await new Promise((res) => setTimeout(res, 0));
    }
  }
  if (ctDead(runId)) return;
  const parts = [`各规格模拟 ${plans.map((p) => p.trials).join("/")} 次试验`];
  if (runners[0].filtered) parts.push(`${runners[0].filtered} 张不在本弹卡表已忽略`);
  box.innerHTML = collectRowsHtml(views, results, true, `（${parts.join("；")}）`);
}

/* ---------------- 拆卡战报图（canvas 生成，可保存/下载） ---------------- */
function reportImgEl(url) {
  return new Promise((resolve) => {
    const im = new Image();
    im.crossOrigin = "anonymous";
    im.onload = () => resolve(im);
    im.onerror = () => resolve(null);
    im.src = url;
  });
}
async function reportImage(card) {
  // 资产模式走 XHR→Blob（缓存复用，fetchCardImageBlob 见 core.js），保证 canvas 不被跨域污染
  if (ASSET) {
    const u = await fetchCardImageBlob(thumbURL(card));
    return u ? reportImgEl(u) : null;
  }
  return reportImgEl(thumbURL(card));
}

async function showReport() {
  const pack = state.packs && state.packs[state.packIdx];
  if (!pack) return;
  toast("正在生成战报图…");
  const W = 900, H = 1350;
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");
  // 背景
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#101528"); bg.addColorStop(1, "#0a0e18");
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#e3350d"; ctx.fillRect(0, 0, W, 8);
  // 标题
  ctx.fillStyle = "#f5f6f8";
  ctx.font = "bold 40px 'PingFang SC','Microsoft YaHei',sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("拆卡战报", W / 2, 92);
  ctx.font = "24px 'PingFang SC','Microsoft YaHei',sans-serif";
  ctx.fillStyle = "#9aa5b1";
  const setName = state.current ? `${state.current.name} · ${state.spec ? state.spec.label : ""}` : "";
  ctx.fillText(setName.slice(0, 24), W / 2, 134);
  // 卡图网格（最多 20 张，超出截断）
  const imgs = await Promise.all(pack.slice(0, 20).map(reportImage));
  const shown = imgs.filter(Boolean).length;
  const cols = shown <= 4 ? 2 : shown <= 9 ? 3 : shown <= 16 ? 4 : 5;
  const rows = Math.ceil(Math.max(shown, 1) / cols);
  const gap = 14;
  const cellW = Math.floor((W - gap * (cols + 1)) / cols);
  const cellH = Math.floor(cellW * 1.38);
  const gridTop = 180;
  let k = 0;
  for (const im of imgs) {
    if (!im) continue;
    const col = k % cols, row = Math.floor(k / cols);
    const x = gap + col * (cellW + gap), y = gridTop + row * (cellH + gap);
    ctx.fillStyle = "#1a2032";
    ctx.fillRect(x, y, cellW, cellH);
    ctx.drawImage(im, x, y, cellW, cellH);
    k++;
  }
  // 底部稀有度统计
  let y = gridTop + rows * (cellH + gap) + 46;
  const cnt = rarityCounts(pack);
  ctx.font = "bold 26px 'PingFang SC','Microsoft YaHei',sans-serif";
  ctx.textAlign = "left";
  let x = 40;
  for (const r of RARITY_ORDER) {
    if (!cnt[r]) continue;
    ctx.fillStyle = RARITY_COLOR[r] || "#9aa5b1";
    const label = `${r}×${cnt[r]}`;
    ctx.fillText(label, x, y);
    x += ctx.measureText(label).width + 36;
  }
  ctx.fillStyle = "#6b7688";
  ctx.font = "20px 'PingFang SC','Microsoft YaHei',sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(new Date().toLocaleDateString("zh-CN") + " · PTCG拆卡模拟器 · 仅供学习交流", W / 2, H - 36);
  try {
    const dataURL = canvas.toDataURL("image/png");
    $("#reportImg").src = dataURL;
    $("#reportOverlay").hidden = false;
    $("#btnSaveReport").dataset.url = dataURL;
  } catch {
    toast("战报图生成失败（图片跨域受限）", 3000);
  }
}

function saveReport() {
  const url = $("#btnSaveReport").dataset.url;
  if (!url) return;
  if (nativeBridge && nativeBridge.saveImage) {
    const b64 = url.split(",")[1] || "";
    const path = nativeBridge.saveImage(b64);
    toast(`已保存到：${path || "相册目录"}`, 3600);
    return;
  }
  const a = document.createElement("a");
  a.href = url;
  a.download = `ptcg战报_${Date.now()}.png`;
  a.click();
  toast("战报图已开始下载");
}
