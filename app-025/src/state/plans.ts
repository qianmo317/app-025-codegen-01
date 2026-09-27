import type { Plan, Tank, Substrate, SubstrateLayer, WaterConfig, Packaging } from '../core/types';
import { EMPTY_WATER } from '../core/types';
import { withPackaging, withSaltKey } from '../core/budget';

const KEY = 'aquaplans.v1';

export function defaultSubstrate(): Substrate {
  return { kind: 'soil', densityKgPerL: 1.05, thicknessMm: 50, slopeMm: 60 };
}

export function defaultTank(name = '我的草缸'): Tank {
  return { id: 't1', name, l: 60, w: 45, h: 45, glassMm: 8, waterLevelMm: 390, openTop: true };
}

export function newPlan(name = '我的草缸'): Plan {
  return {
    id: `p${Date.now()}${Math.floor(Math.random() * 1e4)}`,
    name,
    tank: defaultTank(name),
    substrate: defaultSubstrate(),
    items: [],
    fishes: [],
    water: { ...EMPTY_WATER },
    updatedAt: Date.now(),
  };
}

function load(): Plan[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr;
  } catch {
    return [];
  }
}

function save(plans: Plan[]) {
  localStorage.setItem(KEY, JSON.stringify(plans));
}

// ---- 集中式 store（React 组件只做展示与用户动作，见项目约定）----
type Listener = () => void;
const listeners = new Set<Listener>();
let plans: Plan[] = load();

function emit() {
  save(plans);
  listeners.forEach((l) => l());
}

export function getPlans(): Plan[] {
  return plans;
}

export function subscribePlans(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function getPlan(id: string): Plan | undefined {
  return plans.find((p) => p.id === id);
}

export function upsertPlan(plan: Plan) {
  const idx = plans.findIndex((p) => p.id === plan.id);
  const next = { ...plan, updatedAt: Date.now() };
  if (idx >= 0) plans = plans.map((p) => (p.id === plan.id ? next : p));
  else plans = [next, ...plans];
  emit();
}

export function deletePlan(id: string) {
  plans = plans.filter((p) => p.id !== id);
  emit();
}

export function renamePlan(id: string, name: string) {
  plans = plans.map((p) => (p.id === id ? { ...p, name, updatedAt: Date.now() } : p));
  emit();
}

/** 更新某个 plan 的局部字段并持久化 */
export function updatePlan(id: string, patch: Partial<Plan>) {
  plans = plans.map((p) => (p.id === id ? { ...p, ...patch, updatedAt: Date.now() } : p));
  emit();
}

export function updateWater(id: string, patch: Partial<WaterConfig>) {
  const plan = getPlan(id);
  if (!plan) return;
  updatePlan(id, { water: { ...plan.water, ...patch } });
}

/** 更新某行（底砂材质/水草/盐/鱼）的市售包装容量或单价；未建 costs 时惰性创建 */
export function updatePackaging(id: string, key: string, patch: Partial<Packaging>) {
  const plan = getPlan(id);
  if (!plan) return;
  updatePlan(id, { costs: withPackaging(plan.costs, key, patch) });
}

/** 切换矿物盐种类（用量与单价都随盐变，需重算） */
export function updateSaltKey(id: string, saltKey: string) {
  const plan = getPlan(id);
  if (!plan) return;
  updatePlan(id, { costs: withSaltKey(plan.costs, saltKey) });
}

/** 开启/关闭两种底砂混用：开启时从当前单材质复制出两层；关闭时保留首层 */
export function setSubstrateMixed(id: string, mixed: boolean) {
  const plan = getPlan(id);
  if (!plan) return;
  if (mixed) {
    const first: SubstrateLayer = { ...plan.substrate };
    const second: SubstrateLayer =
      plan.substrateLayers && plan.substrateLayers[1]
        ? { ...plan.substrateLayers[1] }
        : { kind: 'sand', densityKgPerL: 1.6, thicknessMm: 30, slopeMm: 0 };
    updatePlan(id, { substrate: first, substrateLayers: [first, second] });
  } else {
    const first = plan.substrateLayers?.[0] ?? plan.substrate;
    updatePlan(id, { substrate: { ...first }, substrateLayers: undefined });
  }
}

/** 更新某层底砂（混用时）；单层方案回写到 substrate */
export function updateSubstrateLayer(id: string, index: number, patch: Partial<SubstrateLayer>) {
  const plan = getPlan(id);
  if (!plan) return;
  const layers = plan.substrateLayers && plan.substrateLayers.length > 0 ? plan.substrateLayers : [plan.substrate];
  const next = layers.map((l, i) => (i === index ? { ...l, ...patch } : l));
  if (plan.substrateLayers && plan.substrateLayers.length > 0) {
    updatePlan(id, { substrate: next[0], substrateLayers: next });
  } else {
    updatePlan(id, { substrate: next[0] });
  }
}
