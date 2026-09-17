/* 稀有度/格式化工具（与前端 static/app.js 保持一致） */
const RARITY_ORDER = ["FUR", "UR", "SAR", "SR", "ACE", "AR", "RGB", "RR", "R", "U", "C", "N", "★★★", "★★", "★", "◆", "●", "无标记"];
const RARITY_COLOR = {
  C: "#9aa5b1", U: "#58c470", R: "#4aa8ff", RR: "#ffd75e", AR: "#7ee8fa",
  SR: "#ff7edb", SAR: "#b28dff", UR: "#ffc82e", ACE: "#8f7bff", TR: "#f6a5c0", N: "#6b7688",
  FUR: "#ff5f9e", RGB: "#e0c3fc",
  "●": "#9aa5b1", "◆": "#58c470", "★": "#4aa8ff", "★★": "#ffd75e", "★★★": "#b28dff", "无标记": "#6b7688",
};
const RARITY_LABEL = {
  C: "普通 C", U: "非普通 U", R: "稀有 R", RR: "双稀有 RR", AR: "艺术稀有 AR",
  SR: "超级稀有 SR", SAR: "特艺术 SAR", UR: "究极稀有 UR", ACE: "ACE SPEC", TR: "双星 TR", N: "其他",
  FUR: "30周年特艺术 FUR", RGB: "彩虹 RGB",
  "●": "普通 ●", "◆": "非普通 ◆", "★": "稀有 ★", "★★": "双稀有 ★★", "★★★": "特艺术 ★★★", "无标记": "特款（无标记）",
};

function rarColor(r) { return RARITY_COLOR[r] || RARITY_COLOR.N; }
function rarLabel(r) { return RARITY_LABEL[r] || "其他"; }
function bestRarity(rs) { return RARITY_ORDER.find((r) => rs[r]) || null; }
function fmtMoney(n) { return Number.isInteger(n) ? String(n) : Number(n).toFixed(2); }
function probPct(p) { return (p * 100).toFixed(p * 100 >= 1 ? 1 : 2) + "%"; }

module.exports = { RARITY_ORDER, RARITY_COLOR, RARITY_LABEL, rarColor, rarLabel, bestRarity, fmtMoney, probPct };
