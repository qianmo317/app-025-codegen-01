import type { Fish, Packaging, Plan, PlanCosts, SubstrateKind } from './types';
import {
  planEffectiveVolumeL,
  planSubstrateLayers,
  substrateLayerWeightKg,
} from './volume';
import { GH_SALTS } from './water';

/** 可选矿物盐名单（种类改变时用量按其 GH 贡献重算） */
export const GH_SALT_NAMES: string[] = GH_SALTS.map((s) => s.salt);

/**
 * 采购预算（需求 §3：按市售包装折算采购件数与花费）。
 * 纯函数模块：输入方案 + 使用者填写的包装/单价（plan.costs），输出每行的
 * 实际用量、采购件数（向上取整）、余量、折合单价与类别小计/总计。
 * 价格未填的项只标出、绝不按 0 元参与合计。
 */

export type BudgetCategory = '底砂' | '水草' | '矿物盐' | '生物';

export const CATEGORY_ORDER: BudgetCategory[] = ['底砂', '水草', '矿物盐', '生物'];

/** 各类按什么单位算实际用量 */
export const NEED_UNIT: Record<BudgetCategory, string> = {
  底砂: 'kg',
  水草: '株',
  矿物盐: 'g',
  生物: '尾',
};

/** 各类市售包装的单位（袋/盆/包/群） */
export const PACK_UNIT: Record<BudgetCategory, string> = {
  底砂: '袋',
  水草: '盆',
  矿物盐: '包',
  生物: '群',
};

/** 包装容量默认值（底砂 kg/袋、水草 株/盆、盐 g/包、鱼 尾/群），使用者可改 */
export const DEFAULT_PACK_SIZE: Record<BudgetCategory, number> = {
  底砂: 9,
  水草: 6,
  矿物盐: 500,
  生物: 6,
};

export const SUBSTRATE_NAME: Record<SubstrateKind, string> = {
  sand: '河沙',
  gravel: '砾石',
  soil: '水草泥',
  ada: 'ADA 泥',
};

export type BudgetLine = {
  /** 与 plan.costs.packaging 的 key 一致，回填输入用 */
  key: string;
  category: BudgetCategory;
  name: string;
  spec: string;
  /** 实际用量 */
  needValue: number;
  needUnit: string;
  /** 每包装容量（与 needUnit 同量纲） */
  packSize: number;
  packUnit: string;
  /** 要买件数 = ceil(用量 / 每包容量) */
  packs: number;
  /** 买到的总量（件数 × 每包容量） */
  boughtValue: number;
  /** 多出部分 = 买到 − 实际用量 */
  surplusValue: number;
  /** 每包单价（元）；未填为 undefined */
  unitPrice?: number;
  /** 是否缺价格（true 时该行不计入合计） */
  priceMissing: boolean;
  /** 该行花费 = 件数 × 单价（价格已填时） */
  lineCost?: number;
  /** 折合每单位用量的单价 = 单价 / 每包容量（价格已填时） */
  effectiveUnitPrice?: number;
};

export type CategoryBudget = {
  category: BudgetCategory;
  lines: BudgetLine[];
  /** 小计：仅累加已填价格的行；该类有缺价行时为 undefined */
  subtotal?: number;
  /** 该类缺价格的行数 */
  missing: number;
};

export type BudgetResult = {
  categories: CategoryBudget[];
  lines: BudgetLine[];
  /** 总计：所有行都填了价格才有值 */
  total?: number;
  /** 已填价 / 缺价 / 总行数 */
  pricedCount: number;
  missingCount: number;
  lineCount: number;
};

/** 向上取整到整件（带浮点保护：恰好整除时不多买一件） */
export function ceilPacks(need: number, packSize: number): number {
  if (!(need > 0) || !(packSize > 0)) return 0;
  return Math.max(1, Math.ceil(need / packSize - 1e-9));
}

export function emptyCosts(): PlanCosts {
  return { saltKey: GH_SALTS[0].salt, packaging: {} };
}

/** 不可变更新某行的包装/单价（供 store 调用） */
export function withPackaging(costs: PlanCosts | undefined, key: string, patch: Partial<Packaging>): PlanCosts {
  const base: PlanCosts = costs ?? emptyCosts();
  const prev: Packaging = base.packaging[key] ?? { packSize: 0 };
  return {
    ...base,
    packaging: { ...base.packaging, [key]: { ...prev, ...patch } },
  };
}

/** 不可变更新选用的矿物盐 */
export function withSaltKey(costs: PlanCosts | undefined, saltKey: string): PlanCosts {
  return { ...(costs ?? emptyCosts()), saltKey };
}

type PlantMeta = { name: string; lightNeed?: string };

/**
 * 计算采购预算。
 * @param plan       当前方案（底砂分层/水草株数/鱼尾数/水质改动后重算）
 * @param fishById   鱼种元数据
 * @param plantById  水草元数据（按素材 id）
 */
export function buildBudget(
  plan: Plan,
  fishById: Map<string, Fish>,
  plantById: Map<string, PlantMeta>,
): BudgetResult {
  const packaging = plan.costs?.packaging ?? {};
  const lines: BudgetLine[] = [];

  const makeLine = (args: {
    key: string;
    category: BudgetCategory;
    name: string;
    spec: string;
    needValue: number;
    defaultPackSize: number;
  }): BudgetLine => {
    const { key, category } = args;
    const saved = packaging[key];
    const packSize = saved?.packSize && saved.packSize > 0 ? saved.packSize : args.defaultPackSize;
    const unitPrice = saved?.unitPrice && saved.unitPrice > 0 ? saved.unitPrice : undefined;
    const packs = ceilPacks(args.needValue, packSize);
    const boughtValue = packs * packSize;
    const surplusValue = Math.max(0, boughtValue - args.needValue);
    return {
      key,
      category,
      name: args.name,
      spec: args.spec,
      needValue: args.needValue,
      needUnit: NEED_UNIT[category],
      packSize,
      packUnit: PACK_UNIT[category],
      packs,
      boughtValue,
      surplusValue,
      unitPrice,
      priceMissing: unitPrice === undefined,
      lineCost: unitPrice === undefined ? undefined : packs * unitPrice,
      effectiveUnitPrice: unitPrice === undefined ? undefined : unitPrice / packSize,
    };
  };

  // ---- 底砂：混用分层时每行一种材质；同种材质合并（重量相加） ----
  const subGroups = new Map<SubstrateKind, { kg: number; thicknessMm: number; slopeMm: number; density: number }>();
  for (const layer of planSubstrateLayers(plan)) {
    const g = subGroups.get(layer.kind) ?? { kg: 0, thicknessMm: 0, slopeMm: 0, density: layer.densityKgPerL };
    g.kg += substrateLayerWeightKg(plan.tank, layer);
    g.thicknessMm += layer.thicknessMm;
    g.slopeMm = Math.max(g.slopeMm, layer.slopeMm);
    subGroups.set(layer.kind, g);
  }
  for (const [kind, g] of subGroups) {
    if (!(g.kg > 0)) continue;
    lines.push(
      makeLine({
        key: `sub:${kind}`,
        category: '底砂',
        name: SUBSTRATE_NAME[kind],
        spec: `密度 ${g.density}kg/L，厚 ${g.thicknessMm}mm，坡度 ${g.slopeMm}mm`,
        needValue: g.kg,
        defaultPackSize: DEFAULT_PACK_SIZE.底砂,
      }),
    );
  }

  // ---- 水草：同种素材（plantId，缺失时按名称）合并株数 ----
  const plantGroups = new Map<string, { name: string; qty: number; spec: string }>();
  for (const p of plan.items.filter((i) => i.kind === 'plant')) {
    const id = p.plantId ?? `name:${p.name}`;
    const meta = p.plantId ? plantById.get(p.plantId) : undefined;
    const name = meta?.name ?? p.name;
    const qty = p.qty ?? 1;
    const layerText = p.layer === 'front' ? '前景' : p.layer === 'mid' ? '中景' : '后景';
    const lightText = p.lightNeed === 'high' ? '高光' : p.lightNeed === 'mid' ? '中光' : '低光';
    const g = plantGroups.get(id) ?? { name, qty: 0, spec: `${layerText}草，${lightText}` };
    g.qty += qty;
    plantGroups.set(id, g);
  }
  for (const [id, g] of plantGroups) {
    if (g.qty <= 0) continue;
    lines.push(
      makeLine({
        key: `plant:${id}`,
        category: '水草',
        name: g.name,
        spec: g.spec,
        needValue: g.qty,
        defaultPackSize: DEFAULT_PACK_SIZE.水草,
      }),
    );
  }

  // ---- 矿物盐：目标 GH 高于自来水时需要加盐（用量随有效水量与盐种类变化） ----
  const saltLine = buildSaltLine(plan, makeLine);
  if (saltLine) lines.push(saltLine);

  // ---- 生物：每种鱼一行，按群采购，默认一群的尾数取群游建议 minSchool ----
  for (const f of plan.fishes) {
    const meta = fishById.get(f.fishId);
    if (!meta || f.count <= 0) continue;
    lines.push(
      makeLine({
        key: `fish:${f.fishId}`,
        category: '生物',
        name: meta.name,
        spec: `成体 ${meta.adultCm}cm，水温 ${meta.tempRange.join('~')}°C${meta.schooling ? `，群游建议 ≥${meta.minSchool ?? 6} 尾` : ''}`,
        needValue: f.count,
        defaultPackSize: meta.minSchool ?? DEFAULT_PACK_SIZE.生物,
      }),
    );
  }

  // ---- 分类小计与总计 ----
  const categories: CategoryBudget[] = CATEGORY_ORDER.map((category) => {
    const catLines = lines.filter((l) => l.category === category);
    const missing = catLines.filter((l) => l.priceMissing).length;
    const subtotal =
      catLines.length > 0 && missing === 0
        ? catLines.reduce((s, l) => s + (l.lineCost ?? 0), 0)
        : undefined;
    return { category, lines: catLines, subtotal, missing };
  }).filter((c) => c.lines.length > 0);

  const pricedCount = lines.filter((l) => !l.priceMissing).length;
  const missingCount = lines.length - pricedCount;
  const total = lines.length > 0 && missingCount === 0 ? lines.reduce((s, l) => s + (l.lineCost ?? 0), 0) : undefined;

  return { categories, lines, total, pricedCount, missingCount, lineCount: lines.length };
}

type MakeLine = (args: {
  key: string;
  category: BudgetCategory;
  name: string;
  spec: string;
  needValue: number;
  defaultPackSize: number;
}) => BudgetLine;

function buildSaltLine(plan: Plan, makeLine: MakeLine): BudgetLine | null {
  const { tapGh, targetGh } = plan.water;
  const eff = planEffectiveVolumeL(plan);
  if (!(eff > 0) || !(targetGh > tapGh)) return null;

  const selectedName = plan.costs?.saltKey ?? GH_SALTS[0].salt;
  const salt = GH_SALTS.find((s) => s.salt === selectedName) ?? GH_SALTS[0];
  // m(g) = ΔGH × V(L) / 盐的 GH 贡献
  const grams = ((targetGh - tapGh) * eff) / salt.ghPerGramPerL;
  return makeLine({
    key: `salt:${salt.salt}`,
    category: '矿物盐',
    name: salt.salt,
    spec: `ΔGH ${(targetGh - tapGh).toFixed(1)} × ${eff.toFixed(1)}L ÷ ${salt.ghPerGramPerL}（升 GH 用）`,
    needValue: grams,
    defaultPackSize: DEFAULT_PACK_SIZE.矿物盐,
  });
}

/** 切换矿物盐种类时，旧盐的包装/单价不应再匹配到新盐（按盐名做 key） */
export function saltPackagingKey(saltName: string): string {
  return `salt:${saltName}`;
}
