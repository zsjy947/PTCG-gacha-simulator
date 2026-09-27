/* 核心：常量/全局状态/工具与 API/URL 与图片工具/__imgFail/本地引擎入口 —— 自 static/app.js 拆分（语义等价，见 docs/refactor/） */
"use strict";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const RARITY_ORDER = ["FUR", "UR", "SAR", "HR", "SR", "ACE", "AR", "SSR", "CHR", "CSR", "RRR", "RGB", "RR", "K", "PR", "A", "S", "R", "U", "C", "N", "★★★", "★★", "★", "◆", "●", "无标记"];
const RARITY_COLOR = {
  C: "#9aa5b1", U: "#58c470", R: "#4aa8ff", RR: "#ffd75e", AR: "#7ee8fa",
  SR: "#ff7edb", SAR: "#b28dff", UR: "#ffc82e", ACE: "#8f7bff", TR: "#f6a5c0", N: "#6b7688",
  FUR: "#ff5f9e", RGB: "#e0c3fc",
  HR: "#f3e19c", RRR: "#ffa94d", SSR: "#63e6be", S: "#c3cbda",
  CHR: "#74c0fc", CSR: "#b197fc", PR: "#868e96", K: "#e599f7", A: "#96f2d7",
  "●": "#9aa5b1", "◆": "#58c470", "★": "#4aa8ff", "★★": "#ffd75e", "★★★": "#b28dff", "无标记": "#6b7688",
};
const RARITY_LABEL = {
  C: "普通 C", U: "非普通 U", R: "稀有 R", RR: "双稀有 RR", AR: "艺术稀有 AR",
  SR: "超级稀有 SR", SAR: "特艺术 SAR", UR: "究极稀有 UR", ACE: "ACE SPEC", TR: "双星 TR", N: "其他",
  FUR: "30周年特艺术 FUR", RGB: "彩虹 RGB",
  HR: "全图稀有 HR", RRR: "三重稀有 RRR", SSR: "超稀有 SSR", S: "特别 S",
  CHR: "角色稀有 CHR", CSR: "收藏稀有 CSR", PR: "宣传 PR", K: "异画 K", A: "特别 A",
  "●": "普通 ●", "◆": "非普通 ◆", "★": "稀有 ★", "★★": "双稀有 ★★", "★★★": "特艺术 ★★★", "无标记": "特款（无标记）",
};
const ENERGY_ZH = { G: "草", R: "火", W: "水", L: "雷", P: "超", F: "斗", D: "恶", M: "钢", Y: "妖", N: "无", C: "无色" };
const BOX_SIZE = 30;          // 官方补充包整盒包数
const RENDER_CHUNK = 120;     // 卡表增量渲染分片大小

const state = {
  sets: [],           // 全部弹（扁平）
  current: null,      // 当前弹 {id, code, name, specs, ...}
  cards: new Map(),   // setId -> 卡列表
  drawing: false,
  spec: null,         // 当前选择的包规格 {id, key, label, ...}
  expandedSpec: "",   // 开包面板当前展开的规格 key（手风琴）
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

/* 卡图加载失败统一处理：延迟重试 2 次（800ms/2000ms），仍失败换卡背占位。
 * 资产模式清 blob 缓存重新走 XHR 升级；服务模式加 cache-buster 重发（服务端会再试回源）。 */
window.__imgFail = function (img) {
  const tries = Number(img.dataset.retry || 0);
  if (tries >= 2) {
    if (img.dataset.nofallback) return;
    img.dataset.nofallback = "1";
    img.src = ASSET ? "cardback.png" : "/static/cardback.png";
    return;
  }
  img.dataset.retry = String(tries + 1);
  setTimeout(() => {
    if (img.dataset.nofallback) return;
    const url = img.getAttribute("src");
    if (ASSET && /^https?:/.test(url)) {
      imgBlobCache.delete(url);
      img.removeAttribute("data-blobbed");
      upgradeRemoteImages(img.closest(".gcard, .record-cards, .coll-grid, .cl-grid, .detail-body") || img.parentElement || img);
    } else {
      img.src = url + (url.includes("?") ? "&" : "?") + "r=" + Date.now();
    }
  }, tries === 0 ? 800 : 2000);
};

/* ---- 本地抽卡引擎：统一使用 shared/gacha.js（window.PTCGGacha）----
 * 服务模式由 /static/gacha.js 提供，资产模式由构建脚本复制到 www/；
 * Python↔JS 同种子对拍见 tests/test_engine.py，勿在本文件重写引擎逻辑。 */
const G = () => window.PTCGGacha;

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

function fmtMoney(n) { return Number.isInteger(n) ? String(n) : n.toFixed(2); }

/* 卡号归一（与服务端 store.norm_index 一致：纯数字补零到三位） */
function normIdx(v) {
  const s = String(v ?? "").trim();
  return /^\d+$/.test(s) ? s.padStart(3, "0") : s;
}
