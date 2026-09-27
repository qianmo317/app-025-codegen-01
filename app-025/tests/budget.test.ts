import { describe, it, expect } from 'vitest';
import {
  buildBudget,
  SUBSTRATE_LABELS,
  DEFAULT_PACK_SIZE,
  PACK_UNIT,
  subKey,
  plantKey,
  fishKey,
  saltKey,
} from '../src/core/budget';
import { GH_SALTS } from '../src/core/water';
import { FISHES, PLANTS } from '../src/data/db';
import type { Plan, Substrate } from '../src/core/types';

const fishMap = new Map(FISHES.map((f) => [f.id, f]));
const plantMap = new Map(PLANTS.map((p) => [p.id, { name: p.name }]));

function plan(over: Partial<Plan> = {}): Plan {
  return {
    id: 'p1',
    name: '60 草缸',
    tank: { id: 't1', name: '60', l: 60, w: 45, h: 45, glassMm: 8, waterLevelMm: 390, openTop: true },
    substrate: { kind: 'ada', densityKgPerL: 1.15, thicknessMm: 50, slopeMm: 60 },
    items: [
      { id: 'i1', kind: 'hardscape', name: '曼珠沉木', x: 20, y: 15, scaleCm: 25, rotDeg: 0, displacement: 0.3, shape: 'wood' },
      { id: 'i2', kind: 'plant', name: '红宫廷', x: 30, y: 10, scaleCm: 25, rotDeg: 0, layer: 'back', lightNeed: 'high', growth: 'fast', qty: 20 },
      { id: 'i3', kind: 'plant', name: '小水榕', x: 10, y: 15, scaleCm: 8, rotDeg: 0, layer: 'front', lightNeed: 'low', growth: 'slow', qty: 3 },
    ],
    fishes: [
      { fishId: 'f-cardinal-tetra', count: 10 },
      { fishId: 'f-cherry-shrimp', count: 20 },
    ],
    // 自来水 GH12 → 目标 8：默认无需加盐
    water: { tapGh: 12, tapKh: 6, targetGh: 8, targetCo2Ppm: 25, roomTempC: 24, targetTempC: 26 },
    updatedAt: 0,
    ...over,
  };
}

const SUB_VOL_L = 60 * 45 * 8 / 1000; // 平均厚 8cm → 21.6 L

describe('采购预算 · 用量向上取整到整包', () => {
  it('底砂按袋：24.84kg / 5kg 袋 → 5 袋 25kg，多出 0.16kg', () => {
    const b = buildBudget(plan(), fishMap, plantMap);
    const line = b.lines.find((l) => l.category === '底砂')!;
    expect(line.name).toBe(SUBSTRATE_LABELS.ada);
    expect(line.demand).toBeCloseTo(24.84, 6);
    expect(line.packSize).toBe(DEFAULT_PACK_SIZE.底砂);
    expect(line.packs).toBe(5);
    expect(line.bought).toBe(25);
    expect(line.surplus).toBeCloseTo(0.16, 6);
    expect(line.demandText).toBe('24.8 kg');
    expect(line.boughtText).toContain('袋');
  });

  it('水草按盆：20 株 → 2 盆刚好；3 株 → 1 盆，多出 7 株', () => {
    const b = buildBudget(plan(), fishMap, plantMap);
    const hong = b.lines.find((l) => l.key === plantKey('红宫廷'))!;
    const rong = b.lines.find((l) => l.key === plantKey('小水榕'))!;
    expect(hong.packs).toBe(2);
    expect(hong.surplus).toBe(0);
    expect(hong.boughtText).toBe('2 盆（20 株）');
    expect(rong.packs).toBe(1);
    expect(rong.bought).toBe(10);
    expect(rong.surplus).toBe(7);
  });

  it('鱼按群：10 尾 → 1 群；20 尾 → 2 群', () => {
    const b = buildBudget(plan(), fishMap, plantMap);
    const tetra = b.lines.find((l) => l.key === fishKey('f-cardinal-tetra'))!;
    const shrimp = b.lines.find((l) => l.key === fishKey('f-cherry-shrimp'))!;
    expect(tetra.packs).toBe(1);
    expect(tetra.boughtText).toContain('群');
    expect(shrimp.packs).toBe(2);
    expect(shrimp.demand).toBe(20);
  });

  it('整倍数用量不取多（浮点误差安全）', () => {
    const p = plan({
      items: [{ id: 'x', kind: 'plant', name: '绿宫廷', x: 1, y: 1, scaleCm: 10, rotDeg: 0, layer: 'back', lightNeed: 'high', growth: 'fast', qty: 10 }],
      fishes: [],
    });
    const b = buildBudget(p, fishMap, plantMap);
    const line = b.lines.find((l) => l.key === plantKey('绿宫廷'))!;
    expect(line.packs).toBe(1);
    expect(line.surplus).toBe(0);
  });
});

describe('采购预算 · 矿物盐按包', () => {
  it('目标 GH 高于自来水：盐量随 ΔGH×有效水量，按包上取整', () => {
    const p = plan({ water: { tapGh: 12, tapKh: 6, targetGh: 18, targetCo2Ppm: 25, roomTempC: 24, targetTempC: 26 } });
    const b = buildBudget(p, fishMap, plantMap);
    const salt = b.lines.find((l) => l.category === '矿物盐')!;
    // 有效水量 = 105.3 − 21.6 − 2.30（沉木排水）≈ 81.4 L；默认盐 0.5 → 6×81.4/0.5 ≈ 976.8g
    expect(salt.demand).toBeCloseTo(976.8, 1);
    expect(salt.packs).toBe(10); // 100g/包
    expect(salt.bought).toBe(1000);
    expect(salt.surplus).toBeCloseTo(23.2, 1);
    expect(b.saltNeeded).toBe(true);
  });

  it('目标 GH 不高于自来水时没有矿物盐行（RO 场景）', () => {
    const b = buildBudget(plan(), fishMap, plantMap);
    expect(b.lines.some((l) => l.category === '矿物盐')).toBe(false);
    expect(b.saltNeeded).toBe(false);
  });

  it('换盐种：硫酸镁贡献低 → 用量与包数重算', () => {
    const mg = GH_SALTS.find((s) => s.salt.includes('MgSO'))!;
    const p = plan({
      water: { tapGh: 12, tapKh: 6, targetGh: 18, targetCo2Ppm: 25, roomTempC: 24, targetTempC: 26 },
      budget: { salt: mg.salt, entries: {} },
    });
    const b = buildBudget(p, fishMap, plantMap);
    const salt = b.lines.find((l) => l.category === '矿物盐')!;
    expect(salt.key).toBe(saltKey(mg.salt));
    expect(salt.demand).toBeCloseTo((6 * 81.4) / 0.23, 0); // ≈2124g
    expect(salt.packs).toBe(22);
  });
});

describe('采购预算 · 价格未填不按零算', () => {
  it('全部未填：行花费缺失、总计未定、有待报价计数', () => {
    const b = buildBudget(plan(), fishMap, plantMap);
    expect(b.lines.length).toBe(5); // 底砂1 + 水草2 + 鱼2
    expect(b.lines.every((l) => l.priceMissing && l.cost === undefined && l.effectiveUnit === undefined)).toBe(true);
    expect(b.total).toBe(0);
    expect(b.totalFinal).toBe(false);
    expect(b.missingCount).toBe(5);
    b.categories.forEach((c) => {
      if (c.lines > 0) expect(c.hasMissing).toBe(true);
    });
  });

  it('填价后：行花费 = 件数×单价；折合单价 = 花费/实际用量；总计确定', () => {
    const p = plan({
      budget: {
        entries: {
          [subKey('ada')]: { packPrice: 50 },
          [plantKey('红宫廷')]: { packPrice: 30 },
          [plantKey('小水榕')]: { packPrice: 12 },
          [fishKey('f-cardinal-tetra')]: { packPrice: 25 },
          [fishKey('f-cherry-shrimp')]: { packPrice: 15 },
        },
      },
    });
    const b = buildBudget(p, fishMap, plantMap);
    const sub = b.lines.find((l) => l.category === '底砂')!;
    expect(sub.cost).toBe(250); // 5 袋 × 50
    expect(sub.effectiveUnit).toBeCloseTo(250 / 24.84, 2); // ≈10.06/kg
    expect(sub.surplusWorth).toBeCloseTo((0.16 / 5) * 50, 2); // 浪费 1.6 元
    const rong = b.lines.find((l) => l.key === plantKey('小水榕'))!;
    expect(rong.effectiveUnit).toBe(4); // 12 元 / 3 株
    expect(b.total).toBe(250 + 60 + 12 + 25 + 30);
    expect(b.totalFinal).toBe(true);
  });

  it('部分填价：合计只含已报价行，并保留待报价提示', () => {
    const p = plan({ budget: { entries: { [subKey('ada')]: { packPrice: 50 } } } });
    const b = buildBudget(p, fishMap, plantMap);
    expect(b.total).toBe(250);
    expect(b.totalFinal).toBe(false);
    expect(b.missingCount).toBe(4);
  });
});

describe('采购预算 · 方案改动后重算', () => {
  it('底砂换材质（密度变化）→ 用量与袋数重算', () => {
    const gravel: Substrate = { kind: 'gravel', densityKgPerL: 1.5, thicknessMm: 50, slopeMm: 60 };
    const b1 = buildBudget(plan(), fishMap, plantMap);
    const b2 = buildBudget(plan({ substrate: gravel }), fishMap, plantMap);
    expect(b1.lines.find((l) => l.category === '底砂')!.demand).toBeCloseTo(24.84, 6);
    const line = b2.lines.find((l) => l.category === '底砂')!;
    expect(line.demand).toBeCloseTo(SUB_VOL_L * 1.5, 6); // 32.4kg
    expect(line.packs).toBe(7); // 32.4/5 → 7 袋
  });

  it('水草改株数 / 鱼改尾数 → 盆数、群数跟着重算', () => {
    const p = plan();
    const b1 = buildBudget(p, fishMap, plantMap);
    expect(b1.lines.find((l) => l.key === plantKey('小水榕'))!.packs).toBe(1);
    const p2 = plan({
      items: p.items.map((i) => (i.id === 'i3' ? { ...i, qty: 13 } : i)),
      fishes: p.fishes.map((f) => (f.fishId === 'f-cardinal-tetra' ? { ...f, count: 22 } : f)),
    });
    const b2 = buildBudget(p2, fishMap, plantMap);
    expect(b2.lines.find((l) => l.key === plantKey('小水榕'))!.packs).toBe(2); // 13/10
    expect(b2.lines.find((l) => l.key === fishKey('f-cardinal-tetra'))!.packs).toBe(3); // 22/10
    expect(b2.lines.find((l) => l.key === fishKey('f-cardinal-tetra'))!.surplus).toBe(8);
  });

  it('同名水草用量合并为同一采购行', () => {
    const p = plan({
      items: [
        { id: 'a', kind: 'plant', name: '红宫廷', x: 1, y: 1, scaleCm: 25, rotDeg: 0, layer: 'back', lightNeed: 'high', growth: 'fast', qty: 20 },
        { id: 'b', kind: 'plant', name: '红宫廷', x: 2, y: 2, scaleCm: 25, rotDeg: 0, layer: 'back', lightNeed: 'high', growth: 'fast', qty: 5 },
      ],
      fishes: [],
    });
    const b = buildBudget(p, fishMap, plantMap);
    const lines = b.lines.filter((l) => l.key === plantKey('红宫廷'));
    expect(lines.length).toBe(1);
    expect(lines[0].demand).toBe(25);
    expect(lines[0].packs).toBe(3); // 25/10 → 3 盆，多出 5
    expect(lines[0].surplus).toBe(5);
  });

  it('用户改市售包装容量（自定义 packSize）→ 按新包装取整', () => {
    const p = plan({ budget: { entries: { [plantKey('小水榕')]: { packSize: 2 } } } });
    const b = buildBudget(p, fishMap, plantMap);
    const rong = b.lines.find((l) => l.key === plantKey('小水榕'))!;
    expect(rong.packSize).toBe(2);
    expect(rong.packs).toBe(2);
    expect(rong.surplus).toBe(1);
  });
});

describe('采购预算 · 两种底砂混用', () => {
  it('分两行、按体积比例 × 各自密度分摊', () => {
    const p = plan({
      substrate2: { kind: 'sand', densityKgPerL: 1.6, thicknessMm: 50, slopeMm: 0 },
      budget: { sub2Ratio: 0.3, entries: {} },
    });
    const b = buildBudget(p, fishMap, plantMap);
    const subs = b.lines.filter((l) => l.category === '底砂');
    expect(subs.length).toBe(2);
    const ada = subs.find((l) => l.key === subKey('ada'))!;
    const sand = subs.find((l) => l.key === subKey('sand'))!;
    expect(ada.demand).toBeCloseTo(SUB_VOL_L * 1.15 * 0.7, 6); // 17.388kg
    expect(sand.demand).toBeCloseTo(SUB_VOL_L * 1.6 * 0.3, 6); // 10.368kg
    expect(ada.spec).toContain('70%');
    expect(sand.spec).toContain('30%');
  });

  it('混砂各自按袋取整，小计/合计同时覆盖两行', () => {
    const p = plan({
      substrate2: { kind: 'sand', densityKgPerL: 1.6, thicknessMm: 50, slopeMm: 0 },
      budget: { sub2Ratio: 0.5, entries: { [subKey('ada')]: { packPrice: 50 }, [subKey('sand')]: { packPrice: 40 } } },
    });
    const b = buildBudget(p, fishMap, plantMap);
    const subs = b.lines.filter((l) => l.category === '底砂');
    // 21.6*1.15*0.5 = 12.42kg → 3 袋；21.6*1.6*0.5 = 17.28kg → 4 袋
    expect(subs.map((l) => l.packs).sort()).toEqual([3, 4]);
    const cat = b.categories.find((c) => c.category === '底砂')!;
    expect(cat.amount).toBe(3 * 50 + 4 * 40);
    expect(cat.hasMissing).toBe(false);
  });

  it('关掉混用后恢复单行', () => {
    const withMix = plan({
      substrate2: { kind: 'sand', densityKgPerL: 1.6, thicknessMm: 50, slopeMm: 0 },
      budget: { sub2Ratio: 0.3, entries: {} },
    });
    expect(buildBudget(withMix, fishMap, plantMap).lines.filter((l) => l.category === '底砂').length).toBe(2);
    const off = plan({ ...withMix, substrate2: undefined });
    expect(buildBudget(off, fishMap, plantMap).lines.filter((l) => l.category === '底砂').length).toBe(1);
  });
});
