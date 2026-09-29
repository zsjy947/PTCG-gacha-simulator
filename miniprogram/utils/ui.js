/* 稀有度/格式化工具（与前端 static/core.js 保持一致）。
   RARITY_ORDER / RARITY_COLOR / RARITY_LABEL 三表由 tools/build_miniprogram.py
   从 static/core.js 单源生成（F10/PTCG-R5-01），勿手改。 */
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

function rarColor(r) { return RARITY_COLOR[r] || RARITY_COLOR.N; }
function rarLabel(r) { return RARITY_LABEL[r] || "其他"; }
function bestRarity(rs) { return RARITY_ORDER.find((r) => rs[r]) || null; }
function fmtMoney(n) { return Number.isInteger(n) ? String(n) : Number(n).toFixed(2); }
function probPct(p) { return (p * 100).toFixed(p * 100 >= 1 ? 1 : 2) + "%"; }

/* 缺卡文本清单（纯逻辑；与 static/ui-collection.js 逐字一致，tests/test_missing_list.py 对拍）：
 * 【PTCG拆卡模拟器】<弹名> 缺卡 Z/Y：
 * <cardIndex> <cardName>（<rarity>） */
function missingListText(setName, missingCards, totalDistinct) {
  const lines = missingCards.map((c) => `${c.cardIndex} ${c.cardName}（${c.rarity || "N"}）`);
  return `【PTCG拆卡模拟器】${setName} 缺卡 ${missingCards.length}/${totalDistinct}：\n${lines.join("\n")}`;
}

module.exports = { RARITY_ORDER, RARITY_COLOR, RARITY_LABEL, rarColor, rarLabel, bestRarity, fmtMoney, probPct, missingListText };
