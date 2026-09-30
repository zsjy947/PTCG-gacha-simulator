/* 卡表：增量渲染/筛选与无限滚动/稀有度筛选 —— 自 static/app.js 拆分（语义等价，见 docs/ARCHITECTURE.md） */
"use strict";

async function loadSetCards(id) {
  if (state.cards.has(id)) return state.cards.get(id);
  const cards = await DATA.cards(id);
  state.cards.set(id, cards);
  fillRarityFilter(cards);
  return cards;
}

/* ---------------- 卡表（增量渲染：大弹按分片追加，滚动到底部自动续载） ---------------- */
let clAll = [];
let clFiltered = [];
let clShown = 0;
let clObserver = null;

async function renderCardList() {
  if (!state.current) return;
  $("#clTitle").textContent = `${state.current.name} · 完整卡表`;
  let cards;
  try { cards = await loadSetCards(state.current.id); }
  catch (e) { $("#clGrid").innerHTML = `<div class="empty-tip">${escapeHtml(e.message)}</div>`; return; }
  clAll = cards;
  resetCardList();
}
function resetCardList() {
  const kw = $("#clSearch").value.trim().toLowerCase();
  const rar = $("#clRarity").value;
  clFiltered = clAll.filter((c) =>
    (!rar || (c.rarity || "N") === rar) && (!kw || c.cardName.toLowerCase().includes(kw)));
  clShown = 0;
  $("#clGrid").innerHTML = "";
  appendCardChunk();
  if (!clObserver) {
    clObserver = new IntersectionObserver((es) => {
      if (es.some((e) => e.isIntersecting) && clShown < clFiltered.length) appendCardChunk();
    }, { rootMargin: "600px 0px" });
    clObserver.observe($("#clSentinel"));
  }
}
function appendCardChunk() {
  const grid = $("#clGrid");
  const chunk = clFiltered.slice(clShown, clShown + RENDER_CHUNK);
  clShown += chunk.length;
  if (!clFiltered.length) {
    grid.innerHTML = `<div class="empty-tip">没有匹配的卡牌</div>`;
    $("#clCount").textContent = "";
    return;
  }
  const frag = document.createDocumentFragment();
  for (const c of chunk) {
    const d = document.createElement("div");
    d.className = "cl-card";
    d.innerHTML = `
      <img loading="lazy" decoding="async" src="${escapeHtml(thumbURL(c))}" alt="${escapeHtml(c.cardName)}" onerror="__imgFail(this)">
      <div class="cl-name">${rarBadge(c.rarity || "N")}${escapeHtml(c.cardName)}</div>`;
    d.addEventListener("click", () => showDetail(c.setCode, c.cardIndex));
    frag.appendChild(d);
  }
  grid.appendChild(frag);
  upgradeRemoteImages(grid);
  $("#clCount").textContent = `${clShown}/${clFiltered.length} 张`;
}
function fillRarityFilter(cards) {
  const sel = $("#clRarity");
  const current = sel.value;
  const rs = [...new Set(cards.map((c) => c.rarity || "N"))]
    .sort((a, b) => RARITY_ORDER.indexOf(a) - RARITY_ORDER.indexOf(b));
  sel.innerHTML = `<option value="">全部稀有度</option>` +
    rs.map((r) => `<option value="${escapeHtml(r)}">${escapeHtml(RARITY_LABEL[r] || r)}</option>`).join("");
  sel.value = current && rs.includes(current) ? current : "";
}
