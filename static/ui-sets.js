/* 拆卡页：弹列表/搜索/选中与手机端弹包抽屉 —— 自 static/app.js 拆分（语义等价，见 docs/refactor/） */
"use strict";

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
    <div class="hero-icon"><img src="${escapeHtml(iconURL(s.code))}" alt="" style="max-width:64px;max-height:48px;object-fit:contain" onerror="this.outerHTML='🎯'"></div>
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
