import type { BudgetCategory, BudgetConfig, Fish, Plan, Substrate } from './types';
import { effectiveVolumeL, substrateVolumeL } from './volume';
import { GH_SALTS, saltForGh } from './water';

/**
 * 采购预算（需求 §4.7）：
 * 底砂按袋、水草按盆、矿物盐按包、鱼按群 —— 实际用量向上取整到整包；
 * 多买的部分单列，并给出摊到实际用量上的折合单价。
 * 价格由使用者填写：未填的项标"待报价"，绝不按 0 计入合计。
 */

export const BUDGET_CATEGORIES: BudgetCategory[] = ['底砂', '水草', '矿物盐', '鱼'];

export const SUBSTRATE_LABELS: Record<Substrate['kind'], string> = {
  sand: '河沙',
  gravel: '砾石',
  soil: '水草泥',
  ada: 'ADA 泥',
};

/** 各类别市售包装默认容量（用户可在页面按实际包装改） */
export const DEFAULT_PACK_SIZE: Record<BudgetCategory, number> = {
  底砂: 5, // kg/袋
  水草: 10, // 株/盆
  矿物盐: 100, // g/包
  鱼: 10, // 尾/群
};

/** 市售包装单位（买量） */
export const PACK_UNIT: Record<BudgetCategory, string> = {
  底砂: '袋',
  水草: '盆',
  矿物盐: '包',
  鱼: '群',
};

/** 实际用量单位 */
export const DEMAND_UNIT: Record<BudgetCategory, string> = {
  底砂: 'kg',
  水草: '株',
  矿物盐: 'g',
  鱼: '尾',
};

export const subKey = (kind: Substrate['kind']) => `sub:${kind}`;
export const plantKey = (name: string) => `plant:${name}`;
export const fishKey = (id: string) => `fish:${id}`;
export const saltKey = (salt: string) => `salt:${salt}`;

export type BudgetLine = {
  category: BudgetCategory;
  /** 配置键：同种包装（同类别同 key）用量合并为一行 */
  key: string;
  name: string;
  spec: string;
  /** 实际用量（kg / 株 / g / 尾） */
  demand: number;
  demandText: string;
  /** 市售包装容量（每袋/盆/包/群） */
  packSize: number;
  /** 要买几件（向上取整） */
  packs: number;
  /** 买到手的总量 */
  bought: number;
  boughtText: string;
  /** 多出来的部分（买量 − 用量） */
  surplus: number;
  surplusText: string;
  /** 整包单价；undefined = 用户没填（待报价，不按 0 算） */
  packPrice?: number;
  priceMissing: boolean;
  /** 行花费 = 件数 × 整包单价 */
  cost?: number;
  /** 折合单价 = 行花费 ÷ 实际用量（把多买的浪费摊进实际用量） */
  effectiveUnit?: number;
  /** 多买部分折合的金额 */
  surplusWorth?: number;
};

export type CategorySummary = {
  category: BudgetCategory;
  /** 已报价行的金额合计 */
  amount: number;
  /** 是否存在未报价行（有则金额只是部分合计） */
  hasMissing: boolean;
  lines: number;
};

export type Budget = {
  lines: BudgetLine[];
  categories: CategorySummary[];
  /** 已报价行总计；全部行都报价时为确定值，否则只是部分合计 */
  total: number;
  /** 总计是否确定（无待报价项） */
  totalFinal: boolean;
  missingCount: number;
  saltNeeded: boolean;
  saltName: string;
};

type Demand = {
  category: BudgetCategory;
  key: string;
  name: string;
  spec: string;
  demand: number;
};

const EPS = 1e-9;

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** 用量显示精度：重量保留 1 位（整数不显示 .0），株/尾取整 */
export function formatDemand(value: number, category: BudgetCategory): string {
  const v = round2(value);
  if (category === '底砂' || category === '矿物盐') return Number.isInteger(v) ? String(v) : v.toFixed(1);
  return String(Math.round(v));
}

function positiveOr(n: number | undefined, fallback: number): number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : fallback;
}

/** 第二种底砂占比，夹取到 0~1；未启用混用返回 0 */
export function sub2Ratio(config: BudgetConfig | undefined): number {
  const r = config?.sub2Ratio;
  return typeof r === 'number' && Number.isFinite(r) ? Math.max(0, Math.min(1, r)) : 0;
}

/** 当前选用的矿物盐（默认无水氯化钙） */
export function chosenSalt(config: BudgetConfig | undefined): { salt: string; ghPerGramPerL: number } {
  const found = GH_SALTS.find((s) => s.salt === config?.salt);
  return found ?? GH_SALTS[0];
}

/** 采购预算：同一份方案任何改动（底砂材质/株数/尾数/混用）都从用量重新取整计算 */
export function buildBudget(
  plan: Plan,
  fishById: Map<string, Fish>,
  plantById: Map<string, { name: string }>,
): Budget {
  const { tank, substrate, substrate2, items, water, budget: config } = plan;
  const demands: Demand[] = [];
  const push = (d: Demand) => {
    if (!(d.demand > 0)) return;
    const existing = demands.find((x) => x.category === d.category && x.key === d.key);
    if (existing) existing.demand += d.demand; // 合并同种包装
    else demands.push({ ...d });
  };

  // ---- 底砂：按袋（kg）。混用时两层体积按比例分摊、密度各算各的，分两行 ----
  const subVolL = substrateVolumeL(tank, substrate);
  const ratio = substrate2 ? sub2Ratio(config) : 0;
  push({
    category: '底砂',
    key: subKey(substrate.kind),
    name: SUBSTRATE_LABELS[substrate.kind],
    spec: `密度 ${substrate.densityKgPerL}kg/L${substrate2 ? `，占底砂层 ${Math.round((1 - ratio) * 100)}%` : ''}`,
    demand: subVolL * substrate.densityKgPerL * (substrate2 ? 1 - ratio : 1),
  });
  if (substrate2) {
    push({
      category: '底砂',
      key: subKey(substrate2.kind),
      name: SUBSTRATE_LABELS[substrate2.kind],
      spec: `密度 ${substrate2.densityKgPerL}kg/L，占底砂层 ${Math.round(ratio * 100)}%`,
      demand: subVolL * substrate2.densityKgPerL * ratio,
    });
  }

  // ---- 水草：按盆（株），同名水草合并 ----
  for (const p of items.filter((i) => i.kind === 'plant')) {
    const meta = plantById.get(p.id);
    push({
      category: '水草',
      key: plantKey(meta?.name ?? p.name),
      name: meta?.name ?? p.name,
      spec: p.layer === 'front' ? '前景草' : p.layer === 'mid' ? '中景草' : '后景草',
      demand: p.qty ?? 1,
    });
  }

  // ---- 矿物盐：按包（g），仅目标 GH 高于自来水时需要 ----
  const salt = chosenSalt(config);
  const dose = saltForGh(water.tapGh, water.targetGh, effectiveVolumeL(tank, substrate, items), salt.salt);
  const saltNeeded = !!dose;
  if (dose) {
    push({
      category: '矿物盐',
      key: saltKey(dose.salt),
      name: dose.salt,
      spec: `ΔGH ${(water.targetGh - water.tapGh).toFixed(1)}，每 g/L 贡献 ${dose.ghPerGramPerL}°dGH`,
      demand: dose.grams,
    });
  }

  // ---- 鱼：按群（尾），同鱼种合并 ----
  for (const f of plan.fishes) {
    const meta = fishById.get(f.fishId);
    if (!meta) continue;
    push({
      category: '鱼',
      key: fishKey(meta.id),
      name: meta.name,
      spec: `${meta.schooling ? '群游' : '非群游'}，成体 ${meta.adultCm}cm`,
      demand: f.count,
    });
  }

  // ---- 用量 → 整包买量 ----
  const lines: BudgetLine[] = demands.map((d) => {
    const cfg = config?.entries?.[d.key];
    const packSize = positiveOr(cfg?.packSize, DEFAULT_PACK_SIZE[d.category]);
    // 包装容量为 0/非法时无法取整：按 1 件兜底（页面输入已限制 >0），避免 NaN
    const packs = packSize > 0 ? Math.ceil((d.demand - EPS) / packSize) : 1;
    const bought = packs * packSize;
    const surplus = round2(bought - d.demand);
    const hasPrice = typeof cfg?.packPrice === 'number' && Number.isFinite(cfg.packPrice);
    const packPrice = hasPrice ? (cfg!.packPrice as number) : undefined;
    const cost = hasPrice ? round2(packs * packPrice!) : undefined;
    return {
      category: d.category,
      key: d.key,
      name: d.name,
      spec: d.spec,
      demand: d.demand,
      demandText: `${formatDemand(d.demand, d.category)} ${DEMAND_UNIT[d.category]}`,
      packSize,
      packs,
      bought,
      boughtText: `${packs} ${PACK_UNIT[d.category]}（${formatDemand(bought, d.category)} ${DEMAND_UNIT[d.category]}）`,
      surplus,
      surplusText: `${formatDemand(surplus, d.category)} ${DEMAND_UNIT[d.category]}`,
      packPrice,
      priceMissing: !hasPrice,
      cost,
      effectiveUnit: hasPrice && d.demand > 0 ? round2(cost! / d.demand) : undefined,
      surplusWorth: hasPrice && surplus > 0 ? round2((surplus / packSize) * packPrice!) : undefined,
    };
  });

  // ---- 类别小计（保持固定类别顺序） ----
  const categories: CategorySummary[] = BUDGET_CATEGORIES.map((category) => {
    const inCat = lines.filter((l) => l.category === category);
    return {
      category,
      amount: round2(inCat.reduce((s, l) => s + (l.cost ?? 0), 0)),
      hasMissing: inCat.some((l) => l.priceMissing),
      lines: inCat.length,
    };
  });

  const missingCount = lines.filter((l) => l.priceMissing).length;
  const total = round2(lines.reduce((s, l) => s + (l.cost ?? 0), 0));

  return {
    lines,
    categories,
    total,
    totalFinal: missingCount === 0,
    missingCount,
    saltNeeded,
    saltName: salt.salt,
  };
}
