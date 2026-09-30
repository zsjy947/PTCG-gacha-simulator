/* 拆卡页：弹列表/搜索/选中与手机端弹包抽屉 —— 自 static/app.js 拆分（语义等价，见 docs/ARCHITECTURE.md） */
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

/* ---------------- 卡图按弹预缓存（T5，exe / APK；小程序无此入口） ----------------
 * APK 通道核实（android-apk 分支 MainActivity）：卡图由原生 shouldInterceptRequest 拦截
 * tcg.mik.moe/static/img|setCode 落盘缓存（imgCacheDir，500MB LRU），该拦截对 <img> 与 XHR
 * 一视同仁 → 预热用 XHR 打同 URL 即填暖同一份缓存，无需原生改造。exe 端同源 /thumb 路由
 * 预热服务端磁盘缓存与 WebView 缓存。标记键 imgcache_<set> 不带 ptcg_ 前缀（不镜像磁盘）。 */
const PRECACHE_CONCURRENCY = 4;
let _precacheActive = false;
let _precacheCtl = null;

function imgCacheMarkKey(setId) { return `imgcache_${setId}`; }
function readImgCacheMark(setId) {
  try { return JSON.parse(localStorage.getItem(imgCacheMarkKey(setId))) || null; } catch { return null; }
}
function cacheMarkDateZh(mark) {
  const [, m, d] = String(mark.date || "").split("-");
  return m ? `${parseInt(m, 10)}月${parseInt(d, 10)}日` : "";
}

async function openPrecache() {
  if (_precacheActive) return;
  let cards = state.cards.get(state.current.id);
  if (!cards) {
    try { cards = await loadSetCards(state.current.id); } catch { cards = []; }
  }
  if (!cards || !cards.length) { toast("卡表尚未载入，稍后再试"); return; }
  const mark = readImgCacheMark(state.current.id);
  $("#precacheHint").textContent =
    `将为当前弹 ${cards.length} 张卡预取卡图（默认仅缩略图，可选含原图），完成后离线也可完整浏览。`
    + (mark ? `上次：已于 ${cacheMarkDateZh(mark)}缓存 ${mark.count} 张${mark.withFull ? "（含原图）" : ""}。` : "");
  $("#precacheWithFull").checked = false;
  $("#precacheProgress").hidden = true;
  $("#precacheText").textContent = "";
  $("#precacheStart").disabled = false;
  $("#precacheCancel").hidden = false;
  $("#precacheAbort").hidden = true;
  $("#precacheOverlay").hidden = false;
}

/* 预热单图：XHR 与 <img> 资源同通道（APK shouldInterceptRequest 两端一致） */
function warmImage(url, ctl) {
  return new Promise((resolve) => {
    if (ctl.signal.aborted) return resolve(false);
    const x = new XMLHttpRequest();
    ctl.signal.addEventListener("abort", () => x.abort(), { once: true });
    x.open("GET", url, true);
    x.responseType = "arraybuffer";
    x.onload = () => resolve(x.status === 200 && !!x.response);
    x.onerror = () => resolve(false);
    x.onabort = () => resolve(false);
    x.send();
  });
}

async function startPrecache() {
  const cards = state.cards.get(state.current.id) || [];
  if (!cards.length || _precacheActive) return;
  // exe 端：缓存占用接近 LRU 上限（默认 600MB）时建议先清理
  if (!ASSET && !nativeBridge) {
    try {
      const info = await api("/api/cache/info");
      const cap = 600 * 1048576;
      if (info.total_bytes > cap * 0.8
        && !(await uiConfirm(`图片缓存已占用 ${info.label}，超过上限（600MB）的 80%，预缓存可能触发旧图淘汰。建议先清理缓存或调大 PTCG_IMG_CACHE_MB。是否继续？`))) return;
    } catch { /* 缓存信息不可用（旧版本服务）则跳过检查 */ }
  }
  const withFull = $("#precacheWithFull").checked;
  _precacheActive = true;
  $("#precacheStart").disabled = true;
  $("#precacheCancel").hidden = true;
  $("#precacheAbort").hidden = false;
  $("#precacheProgress").hidden = false;
  const urls = [...new Set(cards.flatMap((c) => {
    const list = [thumbURL(c)];
    if (withFull && !ASSET) list.push(imgURL(c.setCode, c.cardIndex));
    return list;
  }))];
  const total = urls.length;
  let done = 0, fail = 0, aborted = false;
  const ctl = new AbortController();
  _precacheCtl = ctl;
  ctl.signal.addEventListener("abort", () => { aborted = true; });
  const progText = $("#precacheText"), progFill = $("#precacheBarFill");
  const worker = async () => {
    while (!aborted && urls.length) {
      const url = urls.shift();
      let ok = await warmImage(url, ctl);
      if (!ok && !aborted) ok = await warmImage(url, ctl); // 失败重试 1 次后跳过并计数
      if (!ok) fail++;
      done++;
      progText.textContent = `已缓存 ${done}/${total}（失败 ${fail}）`;
      progFill.style.width = `${Math.round((done / total) * 100)}%`;
    }
  };
  await Promise.all(Array.from({ length: Math.min(PRECACHE_CONCURRENCY, total) }, worker));
  _precacheActive = false;
  _precacheCtl = null;
  $("#precacheOverlay").hidden = true;
  if (aborted) {
    toast(`已取消（本次成功 ${done - fail}/${total}）`);
    return;
  }
  try {
    const d = new Date();
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    localStorage.setItem(imgCacheMarkKey(state.current.id), JSON.stringify({
      date,
      count: cards.length,
      withFull,
    }));
  } catch { /* 空间不足时标记写入失败不影响预热成果 */ }
  toast(fail ? `预缓存完成，${fail} 张失败（可重试）` : `预缓存完成（${cards.length} 张）`);
  renderSpecButtons(); // 刷新入口按钮「已于 M月D日缓存 N 张」标记
}

function abortPrecache() {
  if (_precacheCtl) _precacheCtl.abort();
}
