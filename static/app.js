/* 应用装配：主题/版本更新/缓存/事件绑定与启动 —— 自 static/app.js 拆分（语义等价，见 docs/ARCHITECTURE.md） */
"use strict";

/* ---------------- 设置：外观主题 ---------------- */
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
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
  const timer = setTimeout(() => ctl.abort(), UPDATE_TIMEOUT_MS); // 国内网络超时静默失败，不影响使用
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
  $("#expectClose").addEventListener("click", () => ($("#expectOverlay").hidden = true));
  $("#reportClose").addEventListener("click", () => ($("#reportOverlay").hidden = true));
  [$("#probOverlay"), $("#detailOverlay"), $("#expectOverlay"), $("#reportOverlay")].forEach((ov) =>
    ov.addEventListener("click", (e) => { if (e.target === ov) ov.hidden = true; }));

  $("#pack").addEventListener("click", burstPack);
  $("#btnFlipAll").addEventListener("click", flipAll);
  $("#btnCloseOverlay").addEventListener("click", closeOverlay);
  $("#btnAgain").addEventListener("click", async () => {
    closeOverlay();
    const pack = $("#pack");
    const spec = state.current.specs.find((x) => x.key === pack.dataset.specKey) || state.spec;
    const packs = parseInt(pack.dataset.packs || "1", 10);
    setTimeout(() => draw(spec, packs), AGAIN_DELAY_MS);
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
    if (await uiConfirm("清空全部收藏记录？")) { store.set(collKey(), {}); renderCollection(); renderPriceStats(); }
  });
  $("#btnExportColl").addEventListener("click", exportCollection);
  $("#btnImportColl").addEventListener("click", () => $("#collImportFile").click());
  $("#collImportFile").addEventListener("change", (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) importCollectionFile(f);
    e.target.value = "";
  });
  $("#collSet").addEventListener("change", renderCollection);
  $("#collSort").addEventListener("change", renderCollection);
  $("#collMissing").addEventListener("change", renderCollection);
  $("#btnMissingImg").addEventListener("click", exportMissingImage);
  $("#btnMissingText").addEventListener("click", copyMissingList);
  $("#clRarity").addEventListener("change", resetCardList);
  $("#clSearch").addEventListener("input", resetCardList);

  $("#btnReport").addEventListener("click", showReport);
  $("#btnSaveReport").addEventListener("click", saveReport);

  $("#dataSrcInput").value = store.get("ptcg_datasrc", "");
  $("#dataSrcInput").addEventListener("change", (e) => {
    store.set("ptcg_datasrc", e.target.value.trim());
  });
  $("#btnCheckData").addEventListener("click", () => checkDataUpdate(true));
  $("#btnResetData").addEventListener("click", resetDataOverride);
  $("#btnCheckPrice").addEventListener("click", () => checkPriceUpdate(true));

  $("#btnClearCache").addEventListener("click", clearImageCache);
  $("#btnCheckUpdate").addEventListener("click", () => checkUpdate(true));
  $("#precacheClose").addEventListener("click", () => { abortPrecache(); $("#precacheOverlay").hidden = true; });
  $("#precacheCancel").addEventListener("click", () => $("#precacheOverlay").hidden = true);
  $("#precacheStart").addEventListener("click", startPrecache);
  $("#precacheAbort").addEventListener("click", abortPrecache);
  $("#btnGoDownload").addEventListener("click", () => {
    if (!latestDownload) return;
    if (ASSET) {
      // 优先经原生桥直接调起系统浏览器：跳过「WebView 先导航再判下载」，GitHub 连不上时浏览器有可见错误页而非静默
      if (nativeBridge && nativeBridge.openUrl) {
        toast("正在打开浏览器…");
        nativeBridge.openUrl(latestDownload);
      } else location.href = latestDownload; // 兜底：WebView 导航触发 DownloadListener → 系统浏览器
    } else window.open(latestDownload, "_blank");
  });
  $("#themeToggle").addEventListener("change", (e) => {
    const t = e.target.checked ? "light" : "dark";
    store.set("ptcg_theme", t);
    applyTheme(t);
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeOverlay(); closeSidebar();
      $("#probOverlay").hidden = true; $("#detailOverlay").hidden = true;
      $("#expectOverlay").hidden = true; $("#reportOverlay").hidden = true;
      if (!$("#precacheOverlay").hidden) { abortPrecache(); $("#precacheOverlay").hidden = true; }
      if (!$("#confirmOverlay").hidden) settleConfirm(false);
    }
    if (!$("#overlay").hidden && e.key === " ") { e.preventDefault(); burstPack(); }
  });

  $("#btnConfirmOk").addEventListener("click", () => settleConfirm(true));
  $("#btnConfirmCancel").addEventListener("click", () => settleConfirm(false));
  $("#confirmOverlay").addEventListener("click", (e) => { if (e.target === e.currentTarget) settleConfirm(false); });

  loadSets().then(renderSpend);
  loadPrices();
  renderSpend();
}

(async () => { await restoreStore(); init(); })();
