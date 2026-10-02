/* PTCG 简中拆卡引擎类型声明（外挂形态：引擎 shared/gacha.js 冻结一行不改 —— R3）。
 *
 * 覆盖两种消费形态：
 *   - 浏览器：window.PTCGGacha（UMD 全局，见文末 Window 扩充）
 *   - Node（tests/parity_*.js 对拍脚本）：require() 直接消费，纯 JS 侧不在此处理
 *
 * 数据形状来源（声明与实现解耦，靠 tests 对拍锁定一致性）：
 *   - Spec：config.py SPECS 全量 / server/api.py _spec_brief（web 简表，无 slots）/
 *     android/build_assets.py spec_brief_full（资产全量）/ static/data.js buildSpecViews
 *     （概率表重建的引擎可计算视图）
 *   - GachaCard：data/cards/*.json 卡条目 + drawPack 运行时附加 slotName/slotKind
 *     + 消费方附加 image
 */

/** 随机源：返回 [0,1) 浮点（如 mulberry32(seed)），缺省 Math.random */
export type Rng = () => number;

/** 卡表条目：源数据字段 + 运行时附加字段 */
export interface GachaCard {
  setCode: string;
  cardIndex: string;
  cardName: string;
  rarity?: string;
  /* drawPack 逐张附加：所属槽位 */
  slotName?: string;
  slotKind?: string;
  /* 消费方附加（DATA.cards / API _card_urls） */
  image?: string;
}

/** 逐槽抽卡权重（kind: config.py _slots 的 "normal" | "holo"） */
export interface GachaSlot {
  name: string;
  kind: string;
  weights: Record<string, number>;
}

/** 封入变体（如太晶盛聚 7+3 / 6+4 两种落位） */
export interface GachaVariant {
  note?: string;
  slots: GachaSlot[];
}

/** 包规格：config.py SPECS 全量、_spec_brief 简表（无 slots）、buildSpecViews 视图三形态的字段并集。
 * 无 variants 时以 slots 为封入结构；无 slots 也无 variants 的简表不能直接喂引擎
 * （须先经 buildSpecViews 重建，见 FE-019）。 */
export interface Spec {
  id: string;
  /** 规格键（sm5/sv20/tera10…），简表与视图携带 */
  key?: string;
  label: string;
  short?: string;
  note?: string;
  price?: string | null;
  priceCny?: number | null;
  /** 整盒包数；缺省视为无整盒商品（boxProfile → []，不渲染整盒理论） */
  boxPacks?: number | null;
  /** 简表携带：首变体槽位数（渲染用，引擎不读） */
  packSize?: number;
  default?: boolean;
  slots?: GachaSlot[];
  variants?: GachaVariant[];
}

/** 按稀有度分池结果（buildPools 产出；键为标准稀有度，符号稀有度已按 RARITY_ALIAS 归类） */
export type Pools = Record<string, GachaCard[]>;

/** collectExpectation / collectSimBatched 的目标（二选一） */
export type Targets =
  | { kind: "rarity"; rarities: string[] }
  | { kind: "cards"; keys: string[] };

/** specProbabilities 单稀有度概率行 */
export interface SlotProbability {
  rarity: string;
  p: number;
  pool: number;
}

/** specProbabilities 逐槽概率表 */
export interface SlotProbabilityTable {
  name: string;
  kind: string;
  /** true = 权重稀有度全部缺失，槽位退化为整弹均匀抽（probabilities 为空表） */
  fallback: boolean;
  probabilities: SlotProbability[];
}

export interface SpecProbabilitiesVariant {
  note?: string;
  slots: SlotProbabilityTable[];
}

/** specProbabilities 返回：概率公示展示用 */
export interface SpecProbabilities {
  id: string;
  label: string;
  note?: string;
  price?: string | null;
  packSize: number;
  variants: SpecProbabilitiesVariant[];
}

/** rarityProfile 条目：单包稀有度画像（期望张数 / 出现率，按封入变体逐条返回） */
export interface RarityProfile {
  note: string;
  expectedCount: Record<string, number>;
  pAppear: Record<string, number>;
}

/** boxProfile 条目：整盒理论画像（boxPacks 缺省时返回 []） */
export interface BoxProfile {
  note: string;
  boxPacks: number;
  expectedCount: Record<string, number>;
  pAtLeastOne: Record<string, number>;
}

/** expectedCost 行（按单包出现率降序；anyPacks/cardPacks 可为 Infinity） */
export interface ExpectedCostRow {
  rarity: string;
  pPack: number;
  pool: number;
  anyPacks: number;
  cardPacks: number;
}

/** collectExpectation / collectSimBatched.next().result 的结果。
 * mode="closed" 为闭式公式（n·Hn/λ，附 formula），mode="sim" 为固定种子蒙特卡洛
 * （附 medianPacks/p90Packs/completedRatio/packCap）。note/filtered 仅 sim 形态携带
 * （closed 无此字段；声明为可选以匹配消费方对两形态的统一读取）。 */
export interface CollectResult {
  mode: "closed" | "sim";
  expectedPacks: number | null;
  expectedSpend: number | null;
  /** 仅 sim：未完成试验口径注记（「仅统计 N 包内集齐的试验，完成率 x%」） */
  note?: string;
  /** 仅 sim：目标中不在本弹卡表被忽略的张数 */
  filtered?: number;
  /** 仅 closed："nHn/lambda" */
  formula?: string;
  /** 仅 sim：完成试验的中位 / P90 所需包数 */
  medianPacks?: number | null;
  p90Packs?: number | null;
  /** 仅 sim：完成试验占比（0–1） */
  completedRatio?: number;
  /** 仅 sim：单试验包数上限 */
  packCap?: number;
}

/** collectExpectation / collectSimBatched 共用参数（缺省见引擎实现） */
export interface CollectOpts {
  /** 试验次数，默认 300 */
  trials?: number;
  /** 单试验包数上限，默认 3000 */
  packCap?: number;
  /** 随机种子，默认 0xC011EC7 */
  seed?: number;
  /** 仅 collectSimBatched：每批试验数，默认 3 */
  batch?: number;
}

/** collectSimBatched 单批执行状态 */
export interface CollectBatchState {
  finished: boolean;
  done: number;
  trials: number;
  result: CollectResult | null;
}

/** collectSimBatched 返回：分步集齐模拟器（批间让出主线程；跑完 result 与
 * collectExpectation 同参结果完全相等，tests/test_consistency.py 锁定） */
export interface CollectSimRunner {
  filtered: number;
  trials: number;
  next(): CollectBatchState;
}

/* ---- 引擎导出（与 shared/gacha.js 的 return 块一一对应） ---- */

export const RARITY_ALIAS: Record<string, string>;

/** 可复现随机源（与 tests/mulberry.py 逐位一致，跨引擎对拍用） */
export function mulberry32(seed: number): Rng;

/** 按稀有度分池；符号稀有度先按 RARITY_ALIAS 映射（卡面展示仍保留原始记号） */
export function buildPools(cards: GachaCard[]): Pools;

/** 仅保留池中存在的稀有度并归一化；全部缺失返回 null（槽位退化为整弹均匀抽） */
export function normalizeWeights(
  weights: Record<string, number>,
  available: string[],
): Record<string, number> | null;

/** 按概率表抽稀有度 */
export function pickRarity(probs: Record<string, number>, rng?: Rng): string;

/** 按稀有度池均匀抽卡；包内已出现的卡不再出现（used 记 cardKey，池耗尽退回整弹去重） */
export function pickCard(
  pools: Pools,
  rarity: string | null,
  cards: GachaCard[],
  used?: Set<string>,
  rng?: Rng,
): GachaCard;

/** 开一包：多封入变体规格每包随机落位，逐张附加 slotName/slotKind */
export function drawPack(cards: GachaCard[], pools: Pools, spec: Spec, rng?: Rng): GachaCard[];

/** 开 packs 包（pools 未传时内部构建） */
export function drawPacks(cards: GachaCard[], spec: Spec, packs: number, rng?: Rng): GachaCard[][];

/** 某规格的概率表（含封入变体，供「概率公示」展示） */
export function specProbabilities(spec: Spec, pools: Pools): SpecProbabilities;

/** 某规格每个稀有度的期望成本（目标卡计算器） */
export function expectedCost(spec: Spec, pools: Pools): ExpectedCostRow[];

/** 每包稀有度画像（确定性，无随机数；变体规格逐变体返回） */
export function rarityProfile(spec: Spec, pools: Pools): RarityProfile[];

/** 整盒理论画像（boxPacks 缺省视为无整盒商品 → 返回 []） */
export function boxProfile(spec: Spec, pools: Pools): BoxProfile[];

/** 多目标「集齐期望」：rarity 目标走闭式公式，cards 目标走固定种子蒙特卡洛 */
export function collectExpectation(
  spec: Spec,
  pools: Pools,
  targets: Targets | null,
  opts?: CollectOpts,
): CollectResult;

/** collectExpectation 的分步形态（cards 模式）：next() 每次只跑 batch 个试验并立即返回 */
export function collectSimBatched(
  spec: Spec,
  pools: Pools,
  targets: Targets | null,
  opts?: CollectOpts,
): CollectSimRunner;

/** UMD 全局形态：浏览器内挂载为 window.PTCGGacha */
export as namespace PTCGGacha;

declare global {
  interface Window {
    PTCGGacha: typeof import("./gacha");
  }
}
