/* 数据访问层（服务/资产双模式）与卡表数据热更新 —— 自 static/app.js 拆分（语义等价，见 docs/ARCHITECTURE.md） */
"use strict";

/* ---- 数据访问层：服务模式 / 资产模式 ---- */
const DATA = {
  async sets() {
    if (!ASSET) return api("/api/sets");
    // 数据由 build_assets 以 JS 文件内嵌（file:// 下 fetch 不可用）
    const idx = window.__SETS_INDEX__ || [];
    const meta = window.__GACHA_META__ || { sets: {} };
    state.gachaMeta = meta;
    const groups = {};
    for (const s of idx) {
      if (!s.count) continue;
      const m = meta.sets[s.id] || {};
      const entry = { ...s, specs: m.specs || [], drawable: !!m.drawable, group: m.group || "其他" };
      (groups[entry.group] = groups[entry.group] || []).push(entry);
    }
    const order = ["补充包", "收集啦151", "宝石包", "嗨皮系列", "对战派对",
                   "大师战略卡组", "起始卡组", "专题包", "礼盒·套装", "特典卡"];
    const result = [];
    for (const g of order) if (groups[g]) { result.push({ group: g, sets: groups[g] }); delete groups[g]; }
    for (const g of Object.keys(groups)) result.push({ group: g, sets: groups[g] });
    return { groups: result };
  },
  async cards(setId) {
    // 热更新覆盖优先（设置页「卡表数据更新」拉取的增量数据，键不带 ptcg_ 前缀、不镜像磁盘）
    const ov = localStorage.getItem(`datacard_${setId}`);
    if (ov) {
      try { return JSON.parse(ov); } catch { localStorage.removeItem(`datacard_${setId}`); }
    }
    if (!ASSET) {
      const d = await api(`/api/sets/${encodeURIComponent(setId)}/cards`);
      return d.cards;
    }
    window.__CARD_FILES__ = window.__CARD_FILES__ || {};
    if (!window.__CARD_FILES__[setId]) {
      // 动态注入 script 标签加载该弹卡表
      await new Promise((resolve, reject) => {
        const sc = document.createElement("script");
        sc.src = `assets/cards/${setId}.js`;
        sc.onload = resolve;
        sc.onerror = () => reject(new Error(`卡表 ${setId} 加载失败`));
        document.head.appendChild(sc);
      });
    }
    const cards = window.__CARD_FILES__[setId] || [];
    for (const c of cards) c.image = imgURL(c.setCode, c.cardIndex);
    return cards;
  },
  async probabilities(setId) {
    if (!ASSET) return api(`/api/sets/${encodeURIComponent(setId)}/probabilities`);
    const cards = await DATA.cards(setId);
    const pools = G().buildPools(cards);
    return { specs: (state.current.specs || []).map((sp) => G().specProbabilities(sp, pools)) };
  },
  async draw(setId, spec, packs) {
    if (!ASSET) {
      return api("/api/draw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ set: setId, spec: spec.key, packs }),
      });
    }
    const cards = await DATA.cards(setId);
    const pools = G().buildPools(cards);
    const packsOut = [];
    for (let i = 0; i < packs; i++) packsOut.push(G().drawPack(cards, pools, spec));
    return {
      packs: packsOut.map((p) => p.map((c) => ({ ...c, image: imgURL(c.setCode, c.cardIndex) }))),
    };
  },
  async detail(code, idx) {
    if (!ASSET) return api(`/api/card/${encodeURIComponent(code)}/${encodeURIComponent(idx)}`);
    // file:// 环境用 XHR（fetch 到 https 会受 CORS 限制）
    return new Promise((resolve, reject) => {
      const x = new XMLHttpRequest();
      x.open("POST", `${MIK_API}/card/card-detail`, true);
      x.setRequestHeader("Content-Type", "application/json");
      x.onload = () => { try { resolve(JSON.parse(x.responseText)); } catch (e) { reject(e); } };
      x.onerror = () => reject(new Error("详情接口网络错误"));
      x.send(JSON.stringify({ setCode: code, cardIndex: idx }));
    });
  },

  /* 概率公示/期望计算/整盒理论共用的计算素材：概率表（展示用）+ 全量规格视图 + 卡池（引擎计算用）。
   * 按弹缓存；卡表热更新清除时一并清（clearCalcCache）。
   * 规格全量视图（FE-019）：web 模式 /api/sets 的 _spec_brief 不含 slots，直接喂引擎会崩
   * （v.slots is not iterable）。视图由概率路由（现有路由）的逐槽概率表重构槽位权重：
   * 表内为归一化数值，引擎 normalizeWeights 再归一化结果不变；兜底槽 probabilities 为空表
   * → weights 空 → 引擎同样判定 fallback。价格/盒规等元数据取自规格简表；资产模式同样适用。 */
  async calcData(setId) {
    if (_calcCache.has(setId)) return _calcCache.get(setId);
    const probData = await this.probabilities(setId);
    const cards = await loadSetCards(setId);
    const set = state.sets.find((s) => s.id === setId) || state.current || {};
    const data = {
      probData,
      views: buildSpecViews(probData.specs || [], set.specs || []),
      pools: G().buildPools(cards),
    };
    _calcCache.set(setId, data);
    return data;
  },
};

/* ---------------- 卡表数据热更新 ---------------- */
/* 默认源依次尝试：jsDelivr CDN（国内一般可达）→ GitHub raw（常需代理）。
 * 卡表数据已独立开源至数据仓库 PTCG-card-data（CC0，见 README「声明」）：其两路镜像
 * 排在最前；本仓库两路保留为兼容期回退（一个版本后评估移除）。卡价快照不在数据
 * 仓库范围（checkPriceUpdate 逐源尝试 /prices/index.json，数据仓库 404 后自然落到本仓库）。
 * 数据随仓库发布：卡表提交合并到 master 并推送后即可拉到（CDN 对分支引用有数小时缓存）。 */
const DATA_SOURCES = [
  "https://cdn.jsdelivr.net/gh/zsjy947/PTCG-card-data@master/data",
  "https://raw.githubusercontent.com/zsjy947/PTCG-card-data/master/data",
  "https://cdn.jsdelivr.net/gh/zsjy947/PTCG-gacha-simulator@master/data",
  "https://raw.githubusercontent.com/zsjy947/PTCG-gacha-simulator/master/data",
];

/* 规格全量视图构建（DATA.calcData 用；概率表 → 引擎可计算的 slots 权重视图） */
function buildSpecViews(probSpecs, briefs) {
  return probSpecs.map((psp) => {
    const brief = briefs.find((b) => b.id === psp.id) || {};
    return {
      ...brief,
      id: psp.id, label: psp.label, note: psp.note, price: psp.price,
      variants: (psp.variants || []).map((v) => ({
        note: v.note,
        slots: (v.slots || []).map((slot) => ({
          name: slot.name, kind: slot.kind,
          weights: Object.fromEntries((slot.probabilities || []).map((p) => [p.rarity, p.p])),
        })),
      })),
    };
  });
}

/* DATA.calcData 的按弹缓存（卡表热更新时与 state.cards 一并清除） */
const _calcCache = new Map();
function clearCalcCache() { _calcCache.clear(); }

function dataSrcList() {
  const custom = (store.get("ptcg_datasrc", "") || "").replace(/\/+$/, "");
  return custom ? [custom] : DATA_SOURCES;
}

/* 逐源解析 manifest：全部失败时抛出可读错误（区分 404 与网络不可达） */
async function resolveDataSrc() {
  let saw404 = false, netFail = false;
  for (const base of dataSrcList()) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), DATASRC_TIMEOUT_MS);
    try {
      const r = await fetch(`${base}/manifest.json`, { signal: ctl.signal });
      clearTimeout(timer);
      if (r.ok) return { base, manifest: await r.json() };
      if (r.status === 404) saw404 = true;
      else netFail = true;
    } catch {
      clearTimeout(timer);
      netFail = true;
    }
  }
  throw new Error(saw404 && !netFail
    ? "数据源暂无数据清单：更新尚未发布（需把卡表数据合并到 master 并推送；CDN 缓存有数小时延迟）"
    : "暂时连不上数据源（GitHub 直连国内常受限，可在下方填写镜像数据源后重试）");
}

function appliedManifest() { return store.get("ptcg_data_applied", null); }

/* 增量基线：内置数据的指纹（APK 由构建脚本注入 / exe 走 /api/data-manifest）
 * 叠加已应用的热更新记录。据此只下载与本地真正不同的弹，而非全量。 */
let _bundledManifest = null;
async function bundledManifest() {
  if (_bundledManifest) return _bundledManifest;
  try {
    if (ASSET) _bundledManifest = window.__DATA_MANIFEST__ || { sets: {} };
    else _bundledManifest = await api("/api/data-manifest");
  } catch { _bundledManifest = { sets: {} }; }
  return _bundledManifest;
}

async function checkDataUpdate(manual) {
  const info = $("#dataUpdInfo");
  const btn = $("#btnCheckData");
  if (manual) { info.textContent = "正在检查卡表更新…"; if (btn) btn.disabled = true; }
  try {
    const { base, manifest } = await resolveDataSrc();
    const bundled = (await bundledManifest()).sets || {};
    const applied = (appliedManifest() || {}).sets || {};
    // 基线：内置指纹优先级最低，已应用的热更新记录覆盖之
    const baseline = { ...bundled, ...applied };
    const changed = Object.entries(manifest.sets || {})
      .filter(([id, m]) => !baseline[id] || baseline[id].md5 !== m.md5);
    const appliedTime = appliedManifest()?.generated ? `（当前：${appliedManifest().generated.slice(0, 10)}）` : "";
    if (!changed.length) {
      info.textContent = `卡表已是最新${appliedTime}`;
      if (manual) toast("卡表已是最新");
      return;
    }
    if (manual) {
      const ok = await uiConfirm(`发现 ${changed.length} 弹卡表有更新（远端 ${manifest.generated.slice(0, 10)}），现在下载吗？`);
      if (!ok) { info.textContent = `有 ${changed.length} 弹可更新`; return; }
    }
    let done = 0, fail = 0;
    // 下一份"已应用"记录：以内置+旧记录为底，仅合并下载成功的弹；
    // 失败的弹保留原基线值 → 下次检查仍识别为可更新并重试
    const nextApplied = { ...bundled, ...applied };
    for (const [id, m] of changed) {
      try {
        const cr = await fetch(`${base}/cards/${id}.json`);
        if (!cr.ok) throw new Error(`HTTP ${cr.status}`);
        const cards = await cr.json();
        if (!Array.isArray(cards) || !cards.length || !cards[0].cardIndex) {
          // 空表也是合法数据（如上游未收录的特典弹）：仅当远端确有内容才校验
          if (!Array.isArray(cards)) throw new Error("数据异常");
        }
        try {
          localStorage.setItem(`datacard_${id}`, JSON.stringify(cards));
        } catch {
          throw new Error("本地空间不足，请在设置页清理后重试");
        }
        nextApplied[id] = m;
        done++;
      } catch {
        fail++;
      }
    }
    store.set("ptcg_data_applied", { generated: manifest.generated, sets: nextApplied });
    state.cards.clear(); // 清缓存让下次进入按新数据重新加载
    clearCalcCache();
    const remain = changed.length - done;
    info.textContent = done
      ? `已更新 ${done} 弹${fail ? `，失败 ${fail} 弹（下次检查将重试）` : ""}（${manifest.generated.slice(0, 10)}）`
      : `下载失败，稍后重试`;
    toast(done ? `卡表已更新 ${done} 弹` : "卡表更新失败");
  } catch (e) {
    info.textContent = e.message || "检查失败";
    if (manual) toast(e.message || "检查失败", 3600);
  } finally {
    if (manual && btn) btn.disabled = false;
  }
}

async function resetDataOverride() {
  if (!(await uiConfirm("恢复为内置卡表数据？热更新下载的数据将被清除。"))) return;
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith("datacard_")) keys.push(k);
  }
  keys.forEach((k) => localStorage.removeItem(k));
  store.set("ptcg_data_applied", null);
  state.cards.clear();
  clearCalcCache();
  $("#dataUpdInfo").textContent = "已恢复内置数据";
  toast("已恢复内置卡表数据");
}
