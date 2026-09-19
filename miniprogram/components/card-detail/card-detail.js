const data = require("../../utils/data.js");
const ui = require("../../utils/ui.js");
const img = require("../../utils/img.js");

Component({
  properties: {
    show: { type: Boolean, value: false },
    setCode: { type: String, value: "" },
    cardIndex: { type: String, value: "" },
    fallbackName: { type: String, value: "" },
    fallbackRarity: { type: String, value: "" },
  },

  data: {
    loading: false,
    detail: null,
    img: "",
    imgFail: false,
    degraded: false,
    rarLabel: "",
    rarColor: "",
  },

  observers: {
    "show, setCode, cardIndex"(show, setCode, cardIndex) {
      if (!show || !setCode || !cardIndex) return;
      this.loadData(setCode, cardIndex);
    },
  },

  methods: {
    onImgError() { this.setData({ imgFail: true }); },
    onImgRetry() { this.setData({ imgFail: false }); },

    loadData(setCode, cardIndex) {
      this.setData({
        loading: true, detail: null, degraded: false, imgFail: false,
        img: data.imgURL(setCode, cardIndex),
        rarLabel: ui.rarLabel(this.data.fallbackRarity),
        rarColor: ui.rarColor(this.data.fallbackRarity),
      });
      data.fetchDetail(setCode, cardIndex)
        .then((c) => {
          const attr = c.pokemonAttr || {};
          this.setData({
            loading: false,
            degraded: false,
            detail: {
              name: c.name || this.data.fallbackName,
              nameEn: c.nameEn || "",
              rarity: c.rarity || this.data.fallbackRarity,
              artist: c.artist || "",
              regulationMark: c.regulationMark || "",
              description: c.description || "",
              hp: attr.hp ?? "",
              energy: attr.energyType || "",
              stage: attr.stage || "",
              retreat: attr.retreatCost ?? "",
              weak: attr.weakness ? `${attr.weakness.energy} ${attr.weakness.value || ""}` : "",
              ability: (attr.ability || []).map((a) => `${a.name || ""}：${a.text || ""}`).join("\n"),
              attacks: (attr.attack || []).map((a) => ({
                name: a.name || "", damage: a.damage || "", text: a.text || "",
              })),
            },
            rarLabel: ui.rarLabel(c.rarity || this.data.fallbackRarity),
            rarColor: ui.rarColor(c.rarity || this.data.fallbackRarity),
          });
        })
        .catch(() => this.setData({
          loading: false,
          degraded: true,
          detail: { name: this.data.fallbackName || cardIndex, rarity: this.data.fallbackRarity },
        }));
    },

    onClose() { this.triggerEvent("close"); },
    noop() {},
  },
});
