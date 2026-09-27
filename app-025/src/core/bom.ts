import type { Fish, Plan, SubstrateKind } from './types';
import { planEffectiveVolumeL, planSubstrateLayers, substrateLayerWeightKg } from './volume';
import { weeklyWaterChangePct } from './water';
import { equipmentSummary } from './equipment';

export type BomLine = { category: string; name: string; spec: string; qty: string };

export type Bom = {
  lines: BomLine[];
  care: {
    waterChangePct: number;
    feedingTimes: string;
    lightHours: string;
    co2Schedule: string;
  };
};

/** 物料清单 + 养护参数卡（需求文档 §4.6 / §9） */
export function buildBom(
  plan: Plan,
  fishById: Map<string, Fish>,
  plantById: Map<string, { name: string; lightNeed?: string }>,
): Bom {
  const { tank, substrate, items, water } = plan;
  const layers = planSubstrateLayers(plan);
  const eff = planEffectiveVolumeL(plan);
  const lines: BomLine[] = [];

  // 底砂（混用分层时每种材质一行；同种材质合并重量）
  const subGroups = new Map<SubstrateKind, { kg: number; thicknessMm: number; slopeMm: number; density: number }>();
  for (const layer of layers) {
    const g = subGroups.get(layer.kind) ?? { kg: 0, thicknessMm: 0, slopeMm: 0, density: layer.densityKgPerL };
    g.kg += substrateLayerWeightKg(tank, layer);
    g.thicknessMm += layer.thicknessMm;
    g.slopeMm = Math.max(g.slopeMm, layer.slopeMm);
    subGroups.set(layer.kind, g);
  }
  for (const [kind, g] of subGroups) {
    const name = kind === 'ada' ? 'ADA 泥' : kind === 'soil' ? '水草泥' : kind === 'sand' ? '河沙' : '砾石';
    lines.push({
      category: '底砂',
      name,
      spec: `密度 ${g.density}kg/L，厚度 ${g.thicknessMm}mm，坡度 ${g.slopeMm}mm`,
      qty: `${g.kg.toFixed(1)} kg`,
    });
  }

  // 水草
  const plants = items.filter((i) => i.kind === 'plant');
  for (const p of plants) {
    const meta = plantById.get(p.id);
    lines.push({
      category: '水草',
      name: meta?.name ?? p.name,
      spec: `${p.layer === 'front' ? '前景' : p.layer === 'mid' ? '中景' : '后景'}草，${p.lightNeed === 'high' ? '高光' : p.lightNeed === 'mid' ? '中光' : '低光'}`,
      qty: `${p.qty ?? 1} 株`,
    });
  }

  // 硬景观
  for (const h of items.filter((i) => i.kind === 'hardscape')) {
    lines.push({
      category: '硬景观',
      name: h.name,
      spec: `实际尺寸约 ${h.scaleCm}cm`,
      qty: '1 件',
    });
  }

  // 鱼
  for (const f of plan.fishes) {
    const meta = fishById.get(f.fishId);
    if (!meta) continue;
    lines.push({
      category: '生物',
      name: meta.name,
      spec: `成体 ${meta.adultCm}cm，水温 ${meta.tempRange.join('~')}°C`,
      qty: `${f.count} 尾`,
    });
  }

  // 设备
  const eq = equipmentSummary(tank, substrate, items, 'mid', water.roomTempC, water.targetTempC, layers);
  lines.push({
    category: '设备',
    name: '过滤器',
    spec: `流量 ${eq.filter.min}~${eq.filter.max} L/h（5~8 倍有效水量，经验值）`,
    qty: '1 台',
  });
  lines.push({
    category: '设备',
    name: '照明灯',
    spec: `约 ${eq.light.lumens} lm / ${eq.light.watts} W（中光档，按 ${eq.effectiveL.toFixed(0)}L 有效水量）`,
    qty: '1 盏',
  });
  lines.push({
    category: '设备',
    name: '加热棒',
    spec: `${eq.heater.suggested} W（室温 ${water.roomTempC}°C → 目标 ${water.targetTempC}°C）`,
    qty: '1 支',
  });

  const plantQty = plants.reduce((s, p) => s + (p.qty ?? 1), 0);
  const wc = weeklyWaterChangePct(plantQty, eff);

  return {
    lines,
    care: {
      waterChangePct: wc.value,
      feedingTimes: '每日 1~2 次，3 分钟内吃完为准；灯鱼小型鱼每日 1 次更稳',
      lightHours: '每日 6~8 小时（开缸首月 4~6 小时防爆藻）',
      co2Schedule: `开灯前 1 小时开 CO₂、关灯前 1 小时关（光照 ${'6~8'}h，CO₂ 约 ${'7~9'}h）`,
    },
  };
}
