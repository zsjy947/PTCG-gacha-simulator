/* 收藏册：渲染/导入导出 —— 自 static/app.js 拆分（语义等价，见 docs/refactor/） */
"use strict";

/* ---------------- 收藏册 ---------------- */
/* 收藏卡 tile 模板工厂：缺卡/按价格/普通三种列表共用（FE-001）。
 * DOM 结构/属性/文本与三处原循环逐字节一致，仅元素间空白文本节点归一。 */
function collectionTile(card, opts) {
  const d = document.createElement("div");
  d.className = "coll-card" + (opts.missing ? " missing" : "");
  d.innerHTML = `
      <img loading="lazy" decoding="async" src="${thumbURL(card)}" alt="${escapeHtml(opts.name)}" onerror="__imgFail(this)">
      <div class="cc-x">${opts.countHtml}</div>${opts.priceHtml || ""}
      <div class="cc-name">${opts.badge}${escapeHtml(opts.name)} <span>${escapeHtml(card.cardIndex)}</span></div>`;
  d.addEventListener("click", () => showDetail(card.setCode, card.cardIndex));
  return d;
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
    toast(`已导入 ${sets} 弹 ${entries} 种收藏`);
  };
  reader.readAsText(file, "utf-8");
}
