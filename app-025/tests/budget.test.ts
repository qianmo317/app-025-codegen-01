import { describe, it, expect } from 'vitest';
import {
  buildBudget,
  ceilPacks,
  withPackaging,
  withSaltKey,
  emptyCosts,
  GH_SALT_NAMES,
} from '../src/core/budget';
import {
  planSubstrateLayers,
  planSubstrateVolumeL,
  substrateLayerWeightKg,
} from '../src/core/volume';
import { FISHES, PLANTS } from '../src/data/db';
import type { Plan } from '../src/core/types';

const fishMap = new Map(FISHES.map((f) => [f.id, f]));
const plantMap = new Map(PLANTS.map((p) => [p.id, { name: p.name, lightNeed: p.lightNeed }]));

function basePlan(over: Partial<Plan> = {}): Plan {
  return {
    id: 'p1',
    name: '预算缸',
    tank: { id: 't1', name: '60', l: 60, w: 45, h: 45, glassMm: 8, waterLevelMm: 390, openTop: true },
    substrate: { kind: 'soil', densityKgPerL: 1.05, thicknessMm: 50, slopeMm: 60 },
    items: [],
    fishes: [],
    water: { tapGh: 12, tapKh: 6, targetGh: 8, targetCo2Ppm: 25, roomTempC: 24, targetTempC: 26 },
    updatedAt: 0,
    ...over,
  };
}

describe('采购件数向上取整（ceilPacks）', () => {
  it('非整数用量向上取整；恰好整除不多买', () => {
    expect(ceilPacks(20, 6)).toBe(4); // 3.33 → 4 盆
    expect(ceilPacks(18, 6)).toBe(3); // 恰好 3 盆
    expect(ceilPacks(0.2, 9)).toBe(1); // 用量很少也要买 1 件
    expect(ceilPacks(10, 6)).toBe(2);
  });
  it('零/非法用量返回 0', () => {
    expect(ceilPacks(0, 6)).toBe(0);
    expect(ceilPacks(20, 0)).toBe(0);
    expect(ceilPacks(-5, 6)).toBe(0);
  });
});

describe('buildBudget：底砂/水草/生物行', () => {
  const plan = basePlan({
    items: [
      { id: 'i2', kind: 'plant', plantId: 'p-ludwigia', name: '红宫廷', x: 30, y: 10, scaleCm: 25, rotDeg: 0, layer: 'back', lightNeed: 'high', growth: 'fast', qty: 20 },
      { id: 'i4', kind: 'plant', plantId: 'p-ludwigia', name: '红宫廷', x: 31, y: 11, scaleCm: 25, rotDeg: 0, layer: 'back', lightNeed: 'high', growth: 'fast', qty: 7 },
      { id: 'i3', kind: 'plant', plantId: 'p-anubias', name: '小水榕', x: 10, y: 15, scaleCm: 8, rotDeg: 0, layer: 'front', lightNeed: 'low', growth: 'slow', qty: 3 },
    ],
    fishes: [{ fishId: 'f-cardinal-tetra', count: 10 }],
  });
  const budget = buildBudget(plan, fishMap, plantMap);

  it('底砂用量与重量公式一致，默认 9kg/袋', () => {
    const line = budget.lines.find((l) => l.category === '底砂')!;
    const expectKg = substrateLayerWeightKg(plan.tank, plan.substrate);
    expect(line.needValue).toBeCloseTo(expectKg, 6);
    expect(line.packSize).toBe(9);
    // 60×45×(5+3)cm → 21.6L × 1.05 ≈ 22.68kg → 3 袋
    expect(line.needValue).toBeCloseTo(22.68, 1);
    expect(line.packs).toBe(3);
    expect(line.surplusValue).toBeCloseTo(27 - 22.68, 6);
  });

  it('同种水草（同 plantId）合并株数；不同种分行', () => {
    const plants = budget.lines.filter((l) => l.category === '水草');
    const lud = plants.find((l) => l.key === 'plant:p-ludwigia')!;
    const anu = plants.find((l) => l.key === 'plant:p-anubias')!;
    expect(lud.needValue).toBe(27); // 20 + 7 合并
    expect(lud.packs).toBe(5); // 默认 6 株/盆：ceil(27/6)=5
    expect(anu.needValue).toBe(3);
    expect(anu.packs).toBe(1);
  });

  it('鱼按群采购：群游鱼默认一群取 minSchool（宝莲灯 6 尾/群），10 尾 → 2 群', () => {
    const fish = budget.lines.find((l) => l.key === 'fish:f-cardinal-tetra')!;
    expect(fish.needValue).toBe(10);
    expect(fish.packSize).toBe(6);
    expect(fish.packs).toBe(2);
    expect(fish.boughtValue).toBe(12);
    expect(fish.surplusValue).toBe(2);
  });

  it('目标 GH ≤ 自来水（默认 8<12）→ 不出矿物盐行', () => {
    expect(budget.lines.find((l) => l.category === '矿物盐')).toBeUndefined();
  });
});

describe('buildBudget：缺价标注、不计零、小计与总计', () => {
  const plan = basePlan({
    costs: withPackaging(withPackaging(emptyCosts(), 'sub:soil', { packSize: 9, unitPrice: 45 }), 'plant:p-ludwigia', { packSize: 6 }),
    items: [
      { id: 'i2', kind: 'plant', plantId: 'p-ludwigia', name: '红宫廷', x: 30, y: 10, scaleCm: 25, rotDeg: 0, layer: 'back', lightNeed: 'high', growth: 'fast', qty: 12 },
    ],
  });
  const budget = buildBudget(plan, fishMap, plantMap);

  it('未填价的行 priceMissing=true 且无 lineCost', () => {
    const plant = budget.lines.find((l) => l.key === 'plant:p-ludwigia')!;
    expect(plant.priceMissing).toBe(true);
    expect(plant.lineCost).toBeUndefined();
  });

  it('已填价行：花费=件数×单价，折合单价=单价/每包容量', () => {
    const sub = budget.lines.find((l) => l.key === 'sub:soil')!;
    expect(sub.priceMissing).toBe(false);
    expect(sub.packs).toBe(3);
    expect(sub.lineCost).toBeCloseTo(135, 6); // 3×45
    expect(sub.effectiveUnitPrice).toBeCloseTo(5, 6); // 45/9
  });

  it('有缺价行 → 总计与该类小计为 undefined，但已填项可单独求和', () => {
    expect(budget.total).toBeUndefined();
    expect(budget.missingCount).toBe(1);
    expect(budget.pricedCount).toBe(1);
    const plantCat = budget.categories.find((c) => c.category === '水草')!;
    expect(plantCat.subtotal).toBeUndefined();
    const subCat = budget.categories.find((c) => c.category === '底砂')!;
    expect(subCat.subtotal).toBeCloseTo(135, 6);
  });

  it('全部填价后总计为各行花费之和', () => {
    const filled: Plan = {
      ...plan,
      costs: withPackaging(plan.costs!, 'plant:p-ludwigia', { packSize: 6, unitPrice: 12 }),
    };
    const b2 = buildBudget(filled, fishMap, plantMap);
    expect(b2.total).toBeCloseTo(135 + 2 * 12, 6); // 12 株 → 2 盆
    expect(b2.missingCount).toBe(0);
  });

  it('单价 ≤ 0 与未填等价（不能当 0 元）', () => {
    const p2 = basePlan({ costs: withPackaging(emptyCosts(), 'sub:soil', { packSize: 9, unitPrice: 0 }) });
    const b2 = buildBudget(p2, fishMap, plantMap);
    expect(b2.lines[0].priceMissing).toBe(true);
    expect(b2.total).toBeUndefined();
  });
});

describe('buildBudget：换材质/改株数/改尾数后预算重算', () => {
  function plan(over: Partial<Plan> = {}) {
    return basePlan({
      items: [
        { id: 'i2', kind: 'plant', plantId: 'p-ludwigia', name: '红宫廷', x: 30, y: 10, scaleCm: 25, rotDeg: 0, layer: 'back', lightNeed: 'high', growth: 'fast', qty: 20 },
      ],
      fishes: [{ fishId: 'f-neon-tetra', count: 6 }],
      ...over,
    });
  }

  it('底砂换材质（soil→ada，密度变化）→ key、用量、件数重算', () => {
    const a = buildBudget(plan(), fishMap, plantMap);
    const b = buildBudget(plan({ substrate: { kind: 'ada', densityKgPerL: 1.15, thicknessMm: 50, slopeMm: 60 } }), fishMap, plantMap);
    expect(a.lines.find((l) => l.key === 'sub:soil')).toBeTruthy();
    expect(b.lines.find((l) => l.key === 'sub:ada')).toBeTruthy();
    const adaKg = b.lines.find((l) => l.key === 'sub:ada')!;
    expect(adaKg.needValue).toBeCloseTo(21.6 * 1.15, 6);
  });

  it('水草株数改动 → 用量/件数重算（20→7：4 盆→2 盆）', () => {
    const before = buildBudget(plan(), fishMap, plantMap).lines.find((l) => l.key === 'plant:p-ludwigia')!;
    const changed = basePlan({
      items: [
        { id: 'i2', kind: 'plant', plantId: 'p-ludwigia', name: '红宫廷', x: 30, y: 10, scaleCm: 25, rotDeg: 0, layer: 'back', lightNeed: 'high', growth: 'fast', qty: 7 },
      ],
    });
    const after = buildBudget(changed, fishMap, plantMap).lines.find((l) => l.key === 'plant:p-ludwigia')!;
    expect(before.packs).toBe(4);
    expect(after.needValue).toBe(7);
    expect(after.packs).toBe(2);
  });

  it('鱼尾数改动 → 群数重算（6→7：1 群→2 群）', () => {
    const before = buildBudget(plan(), fishMap, plantMap).lines.find((l) => l.key === 'fish:f-neon-tetra')!;
    const after = buildBudget(plan({ fishes: [{ fishId: 'f-neon-tetra', count: 7 }] }), fishMap, plantMap).lines.find((l) => l.key === 'fish:f-neon-tetra')!;
    expect(before.packs).toBe(1);
    expect(after.packs).toBe(2);
    expect(after.surplusValue).toBe(5);
  });
});

describe('buildBudget：两种底砂混用', () => {
  const plan = basePlan({
    substrate: { kind: 'soil', densityKgPerL: 1.05, thicknessMm: 50, slopeMm: 60 },
    substrateLayers: [
      { kind: 'soil', densityKgPerL: 1.05, thicknessMm: 50, slopeMm: 40 },
      { kind: 'sand', densityKgPerL: 1.6, thicknessMm: 20, slopeMm: 0 },
    ],
  });

  it('分两行（每种材质一行），重量按各自密度分别计算', () => {
    const budget = buildBudget(plan, fishMap, plantMap);
    const subs = budget.lines.filter((l) => l.category === '底砂');
    expect(subs.map((l) => l.key).sort()).toEqual(['sub:sand', 'sub:soil']);
    const layers = planSubstrateLayers(plan);
    const soil = subs.find((l) => l.key === 'sub:soil')!;
    const sand = subs.find((l) => l.key === 'sub:sand')!;
    expect(soil.needValue).toBeCloseTo(substrateLayerWeightKg(plan.tank, layers[0]), 6);
    expect(sand.needValue).toBeCloseTo(substrateLayerWeightKg(plan.tank, layers[1]), 6);
  });

  it('总体积为两层之和（有效水量按总底砂扣除）', () => {
    expect(planSubstrateVolumeL(plan)).toBeCloseTo(
      substrateLayerWeightKg(plan.tank, plan.substrateLayers![0]) / 1.05 +
        substrateLayerWeightKg(plan.tank, plan.substrateLayers![1]) / 1.6,
      5,
    );
  });

  it('同种材质的两层合并为一行（重量相加）', () => {
    const merged = basePlan({
      substrateLayers: [
        { kind: 'sand', densityKgPerL: 1.6, thicknessMm: 20, slopeMm: 0 },
        { kind: 'sand', densityKgPerL: 1.6, thicknessMm: 10, slopeMm: 10 },
      ],
    });
    const budget = buildBudget(merged, fishMap, plantMap);
    const subs = budget.lines.filter((l) => l.category === '底砂');
    expect(subs.length).toBe(1);
    const expectKg =
      substrateLayerWeightKg(merged.tank, merged.substrateLayers![0]) +
      substrateLayerWeightKg(merged.tank, merged.substrateLayers![1]);
    expect(subs[0].needValue).toBeCloseTo(expectKg, 6);
  });
});

describe('buildBudget：矿物盐按包折算', () => {
  function saltPlan(over: Partial<Plan['water']> = {}) {
    return basePlan({ water: { ...basePlan().water, targetGh: 18, ...over } });
  }

  it('目标 GH 高于自来水 → 出盐行，用量 m=ΔGH×V/贡献，默认 500g/包向上取整', () => {
    const plan = saltPlan();
    const budget = buildBudget(plan, fishMap, plantMap);
    const salt = budget.lines.find((l) => l.category === '矿物盐')!;
    expect(salt).toBeTruthy();
    // 默认无水氯化钙 0.5；有效水量 = 毛水量 − 底砂体积
    const gross = (60 * 45 * 39) / 1000; // 105.3
    const subVol = (60 * 45 * 8) / 1000; // 21.6
    const eff = gross - subVol;
    expect(salt.needValue).toBeCloseTo(((18 - 12) * eff) / 0.5, 5);
    expect(salt.packSize).toBe(500);
    expect(salt.packs).toBe(ceilPacks(salt.needValue, 500));
  });

  it('切换盐种类（贡献不同）→ 用量与行 key 重算', () => {
    const plan = saltPlan();
    const first = buildBudget(plan, fishMap, plantMap).lines.find((l) => l.category === '矿物盐')!;
    const switched = { ...plan, costs: withSaltKey(emptyCosts(), GH_SALT_NAMES[2]) };
    const b2 = buildBudget(switched, fishMap, plantMap);
    const salt2 = b2.lines.find((l) => l.category === '矿物盐')!;
    expect(first.key).not.toBe(salt2.key);
    expect(salt2.key).toBe(`salt:${GH_SALT_NAMES[2]}`);
    expect(salt2.needValue).toBeGreaterThan(first.needValue); // 泻盐贡献 0.23 < 0.5
  });

  it('盐包容量改小 → 包数变多', () => {
    const plan = saltPlan();
    const b1 = buildBudget(plan, fishMap, plantMap);
    const key = b1.lines.find((l) => l.category === '矿物盐')!.key;
    const b2 = buildBudget({ ...plan, costs: withPackaging(emptyCosts(), key, { packSize: 100 }) }, fishMap, plantMap);
    expect(b2.lines.find((l) => l.category === '矿物盐')!.packSize).toBe(100);
    expect(b2.lines.find((l) => l.category === '矿物盐')!.packs).toBeGreaterThan(b1.lines.find((l) => l.category === '矿物盐')!.packs);
  });
});
