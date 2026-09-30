/* 收藏册：渲染/导入导出 —— 自 static/app.js 拆分（语义等价，见 docs/ARCHITECTURE.md） */
"use strict";

/* ---------------- 收藏册 ---------------- */
/* 收藏卡 tile 模板工厂：缺卡/按价格/普通三种列表共用（FE-001）。
 * DOM 结构/属性/文本与三处原循环逐字节一致，仅元素间空白文本节点归一。 */
function collectionTile(card, opts) {
  const d = document.createElement("div");
  d.className = "coll-card" + (opts.missing ? " missing" : "");
  d.innerHTML = `
      <img loading="lazy" decoding="async" src="${escapeHtml(thumbURL(card))}" alt="${escapeHtml(opts.name)}" onerror="__imgFail(this)">
      <div class="cc-x">${opts.countHtml}</div>${opts.priceHtml || ""}
      <div class="cc-name">${opts.badge}${escapeHtml(opts.name)} <span>${escapeHtml(card.cardIndex)}</span></div>`;
  d.addEventListener("click", () => showDetail(card.setCode, card.cardIndex));
  return d;
}

/* ---------------- 缺卡清单导出（图 / 文本，T4） ---------------- */
const MISSING_PAGE_SIZE = 60;   // 缺卡图每页上限
let _missingCtx = null;         // 缺卡模式上下文 {name, total, cards}（renderCollection 缺卡分支写入）

/* 缺卡文本清单（纯逻辑，无 DOM；tests/test_missing_list.py 与小程序 ui.js 镜像对拍）：
 * 【PTCG拆卡模拟器】<弹名> 缺卡 Z/Y：
 * <cardIndex> <cardName>（<rarity>） */
function missingListText(setName, missingCards, totalDistinct) {
  const lines = missingCards.map((c) => `${c.cardIndex} ${c.cardName}（${c.rarity || "N"}）`);
  return `【PTCG拆卡模拟器】${setName} 缺卡 ${missingCards.length}/${totalDistinct}：\n${lines.join("\n")}`;
}

/* canvas 文本超宽截断 */
function _clipText(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(s + "…").width > maxW) s = s.slice(0, -1);
  return s + "…";
}

/* 缺卡清单图（canvas 2D，布局对齐战报图）：头部弹名+缺卡计数+页码，缩略图网格
 * （thumbURL，每页上限 60 张），每格标注编号/卡名/稀有度；页脚日期+版本+数据来源声明。
 * 返回 dataURL；图片加载失败画占位底色不中断。 */
async function buildMissingImage(setMeta, missingCards, pageNo, pageTotal) {
  const page = missingCards.slice(MISSING_PAGE_SIZE * (pageNo - 1), MISSING_PAGE_SIZE * pageNo);
  const imgs = await Promise.all(page.map((c) => reportImage(c)));
  const cols = page.length <= 4 ? 2 : page.length <= 9 ? 3 : page.length <= 16 ? 4 : page.length <= 30 ? 5 : 6;
  const rows = Math.ceil(Math.max(page.length, 1) / cols);
  const W = 900, gap = 12, headH = 170, footH = 84;
  const cellW = Math.floor((W - gap * (cols + 1)) / cols);
  const thumbH = Math.floor(cellW * 1.32);
  const capH = 44;
  const H = headH + rows * (thumbH + capH + gap) + footH;
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#101528"); bg.addColorStop(1, "#0a0e18");
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#e3350d"; ctx.fillRect(0, 0, W, 8);
  ctx.textAlign = "center";
  ctx.fillStyle = "#f5f6f8";
  ctx.font = "bold 40px 'PingFang SC','Microsoft YaHei',sans-serif";
  ctx.fillText("缺卡清单", W / 2, 86);
  ctx.font = "24px 'PingFang SC','Microsoft YaHei',sans-serif";
  ctx.fillStyle = "#9aa5b1";
  ctx.fillText(`${String(setMeta.name).slice(0, 24)} · 缺 ${missingCards.length}/${setMeta.total} 张 · 第 ${pageNo}/${pageTotal} 页`, W / 2, 128);
  let k = 0;
  for (let i = 0; i < page.length; i++) {
    const im = imgs[i];
    const col = k % cols, row = Math.floor(k / cols);
    const x = gap + col * (cellW + gap), y = headH + row * (thumbH + capH + gap);
    ctx.fillStyle = "#1a2032";
    ctx.fillRect(x, y, cellW, thumbH);
    if (im) { try { ctx.drawImage(im, x, y, cellW, thumbH); } catch { /* 占位底色兜底 */ } }
    const c = page[i];
    ctx.textAlign = "left";
    ctx.fillStyle = RARITY_COLOR[c.rarity] || "#9aa5b1";
    ctx.font = "bold 17px 'PingFang SC','Microsoft YaHei',sans-serif";
    ctx.fillText(_clipText(ctx, `${c.cardIndex} ${c.cardName}`, cellW - 10), x + 5, y + thumbH + 20);
    ctx.fillStyle = "#9aa5b1";
    ctx.font = "15px 'PingFang SC','Microsoft YaHei',sans-serif";
    ctx.fillText(String(c.rarity || "N"), x + 5, y + thumbH + 39);
    k++;
  }
  ctx.textAlign = "center";
  ctx.fillStyle = "#6b7688";
  ctx.font = "20px 'PingFang SC','Microsoft YaHei',sans-serif";
  ctx.fillText(`${new Date().toLocaleDateString("zh-CN")} · PTCG拆卡模拟器${appVersion ? " v" + appVersion : ""} · 数据来源公开网络，仅供学习交流`, W / 2, H - 30);
  return canvas.toDataURL("image/png");
}

/* 导出缺卡图：逐页生成并复用战报保存链路（APK PTCGNative 桥存相册 / PC toDataURL 下载） */
async function exportMissingImage() {
  if (!_missingCtx || !_missingCtx.cards.length) return;
  toast("正在生成缺卡图…");
  const pages = Math.ceil(_missingCtx.cards.length / MISSING_PAGE_SIZE);
  try {
    for (let p = 1; p <= pages; p++) {
      const url = await buildMissingImage(_missingCtx, _missingCtx.cards, p, pages);
      if (nativeBridge && nativeBridge.saveImage) {
        const path = nativeBridge.saveImage(url.split(",")[1] || "");
        if (p === pages) toast(`已保存到：${path || "相册目录"}${pages > 1 ? `（共 ${pages} 页）` : ""}`, 3600);
      } else {
        const a = document.createElement("a");
        a.href = url;
        a.download = `ptcg缺卡清单${pages > 1 ? `_第${p}页共${pages}页` : ""}_${Date.now()}.png`;
        a.click();
        if (p === pages) toast(pages > 1 ? `缺卡图已开始下载（共 ${pages} 页）` : "缺卡图已开始下载");
      }
    }
  } catch {
    toast("缺卡图生成失败（图片跨域受限）", 3000);
  }
}

/* 复制缺卡文本清单：navigator.clipboard 优先，execCommand 兜底 */
async function copyMissingList() {
  if (!_missingCtx || !_missingCtx.cards.length) return;
  const text = missingListText(_missingCtx.name, _missingCtx.cards, _missingCtx.total);
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(text);
    else {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    toast("缺卡清单已复制");
  } catch {
    toast("复制失败", 3000);
  }
}

/* 缺卡导出按钮：隐藏 ↔ 弹选择右侧收窄原位出现（开启缺卡模式）；无缺卡时可见但置灰 */
function _setMissingButtons(visible, enabled) {
  const bi = $("#btnMissingImg"), bt = $("#btnMissingText");
  if (!bi || !bt) return;
  bi.hidden = bt.hidden = !visible;
  bi.disabled = bt.disabled = !enabled;
}

async function renderCollection() {
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
  const valueOf = (list) => {
    let v = 0, any = false;
    for (const e of list) {
      const p = priceOf(e.setCode, e.cardIndex);
      if (p != null) { any = true; v += p * (e.count || 1); }
    }
    return any ? Math.round(v * 100) / 100 : null;
  };
  const totalValue = valueOf(entries);
  const valueSpan = (v) => v == null ? "" : `<span class="cc-total">卡牌总价 <b>¥${fmtMoney(v)}</b></span>`;
  $("#collSummary").innerHTML = entries.length
    ? `<span><b>${entries.length}</b>种卡牌</span><span><b>${total}</b>张总计</span>
       <span><b>${bestRarity(Object.fromEntries(entries.map((e) => [e.rarity, 1]))) || "—"}</b>最高稀有度</span>${valueSpan(totalValue)}`
    : `<span>该弹还没有收藏记录</span>`;

  // 完成度与缺卡：以完整卡表为基准（数据缺失时静默跳过）
  const bar = $("#collBar");
  const pctText = $("#collPct");
  let all = null;
  try { all = await DATA.cards(setId); } catch { all = null; }
  const totalDistinct = all ? all.length : 0;
  if (all && totalDistinct) {
    const pct = Math.min(100, (entries.length / totalDistinct) * 100);
    bar.style.width = `${pct}%`;
    pctText.textContent = `已收集 ${entries.length} / ${totalDistinct} 种（${pct.toFixed(1)}%）`;
    $("#collProgress").hidden = false;
  } else {
    $("#collProgress").hidden = true;
  }

  const grid = $("#collGrid");
  // 按价格模式：只看已收的有价卡，与「只看缺卡」互斥（该开关在此模式下禁用）
  const priceMode = sortMode === "price";
  const missingToggle = $("#collMissing");
  missingToggle.disabled = priceMode;
  missingToggle.closest(".switch").style.opacity = priceMode ? .45 : "";
  const missingOnly = missingToggle.checked && !priceMode;
  /* 缺卡导出按钮：缺卡模式下显示（弹选择收窄腾位），无缺卡置灰 */
  _setMissingButtons(missingOnly, false);
  const missCards = () => {
    const have = new Set(Object.keys(box));
    return all.filter((c) => !have.has(`${c.setCode}__${c.cardIndex}`));
  };
  if (missingOnly) {
    const missing = all ? missCards() : [];
    if (!all || !all.length) {
      grid.innerHTML = `<div class="empty-tip">该弹暂无卡表数据</div>`;
      return;
    }
    if (!missing.length) {
      grid.innerHTML = `<div class="empty-tip">🎉 该弹已收集完成！</div>`;
      return;
    }
    _missingCtx = {
      name: (state.sets.find((x) => x.id === setId) || {}).name || setId,
      total: totalDistinct,
      cards: missing,
    };
    _setMissingButtons(true, true);
    $("#collSummary").innerHTML = `<span><b>${missing.length}</b>张缺卡</span>
      <span><b>${entries.length}/${totalDistinct}</b>种已收</span>${valueSpan(valueOf(missing))}`;
    grid.innerHTML = "";
    for (const c of missing) {
      grid.appendChild(collectionTile(c, {
        missing: true,
        name: c.cardName,
        badge: rarBadge(c.rarity || "N"),
        countHtml: "缺",
      }));
    }
    upgradeRemoteImages(grid);
    return;
  }

  if (!entries.length) {
    grid.innerHTML = `<div class="empty-tip">抽到的卡会自动收藏在这里</div>`;
    return;
  }

  // 按价格：仅列出当前收藏中有价格的卡（按单价降序），卡片标明单价与数量；
  // 其余排序不显示价格，避免污染版式
  if (priceMode) {
    const priced = entries
      .map((e) => ({ ...e, unit: priceOf(e.setCode, e.cardIndex) }))
      .filter((e) => e.unit != null)
      .sort((a, b) => b.unit - a.unit ||
        a.cardIndex.localeCompare(b.cardIndex, undefined, { numeric: true }));
    if (!priced.length) {
      grid.innerHTML = `<div class="empty-tip">当前收藏的卡暂无价格数据</div>`;
      return;
    }
    grid.innerHTML = "";
    for (const e of priced) {
      grid.appendChild(collectionTile(e, {
        name: e.name,
        badge: rarBadge(e.rarity),
        countHtml: `×${e.count}`,
        priceHtml: `\n      <div class="cc-price">¥${fmtMoney(e.unit)}</div>`,
      }));
    }
    upgradeRemoteImages(grid);
    return;
  }

  grid.innerHTML = "";
  for (const e of entries) {
    grid.appendChild(collectionTile(e, {
      name: e.name,
      badge: rarBadge(e.rarity),
      countHtml: `×${e.count}`,
    }));
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

/* 导入收藏：结构校验后按"合并（同卡数量相加）"写入；如需覆盖先清空再导入 */
function importCollectionFile(file) {
  const reader = new FileReader();
  reader.onload = async () => {
    let parsed;
    try {
      parsed = JSON.parse(String(reader.result));
    } catch { toast("导入失败：不是合法的 JSON 文件", 3000); return; }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      toast("导入失败：结构不符合收藏册导出格式", 3000); return;
    }
    let sets = 0, entries = 0, cards = 0;
    const valid = {};
    for (const [setId, box] of Object.entries(parsed)) {
      if (!box || typeof box !== "object" || Array.isArray(box)) continue;
      const clean = {};
      for (const e of Object.values(box)) {
        if (!e || !e.setCode || !e.cardIndex || !e.name) continue;
        clean[`${e.setCode}__${e.cardIndex}`] = {
          name: String(e.name), rarity: e.rarity || "N",
          setCode: String(e.setCode), cardIndex: String(e.cardIndex),
          count: Math.max(1, Math.floor(Number(e.count) || 1)),
        };
        entries++; cards += clean[`${e.setCode}__${e.cardIndex}`].count;
      }
      if (Object.keys(clean).length) { valid[setId] = clean; sets++; }
    }
    if (!sets) { toast("导入失败：文件中没有有效的收藏记录", 3000); return; }
    if (!(await uiConfirm(`导入 ${sets} 弹共 ${entries} 种（${cards} 张）收藏记录，与现有收藏合并（同卡数量相加）。继续？`))) return;
    const coll = getColl();
    for (const [setId, box] of Object.entries(valid)) {
      const target = coll[setId] || {};
      for (const [k, e] of Object.entries(box)) {
        if (target[k]) target[k].count += e.count;
        else target[k] = e;
      }
      coll[setId] = target;
    }
    store.set(collKey(), coll);
    renderCollection();
    renderPriceStats();
    toast(`已导入 ${sets} 弹 ${entries} 种收藏`);
  };
  reader.readAsText(file, "utf-8");
}
