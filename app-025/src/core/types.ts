// 数据模型（与需求文档 §7 对齐）
export type Tank = {
  id: string;
  name: string;
  l: number; // 长 cm
  w: number; // 宽 cm
  h: number; // 高 cm
  glassMm: number; // 玻璃厚度 mm
  waterLevelMm: number; // 水面高度（自缸底起算，mm）
  openTop: boolean; // 是否开放缸
};

export type SubstrateKind = 'sand' | 'gravel' | 'soil' | 'ada';

export type Substrate = {
  kind: SubstrateKind;
  densityKgPerL: number; // 密度 kg/L（可配）
  thicknessMm: number; // 基础厚度 mm
  slopeMm: number; // 坡度（前后落差 mm）
};

/**
 * 底砂分层（两种底砂混用时按行铺设，各占一层厚度与坡度）。
 * 单材质方案用一层即可；混用时两种各一层，体积/重量分别计算。
 */
export type SubstrateLayer = Substrate;

/** 预算/采购清单：每种市售包装的规格与单价（单价由使用者填写，留空视为未填） */
export type Packaging = {
  /** 每包装的容量：底砂 kg/袋、水草 株/盆、矿物盐 g/包、鱼 尾/群 */
  packSize: number;
  /** 每包单价（元）；undefined 或 ≤0 表示价格未填，预算不计入且需要标出 */
  unitPrice?: number;
};

/** 方案级预算输入：按 key 存包装与单价（底砂按材质、水草按素材 id、鱼按 id、盐按盐名） */
export type PlanCosts = {
  saltKey?: string; // 选用的矿物盐（GH_SALTS 的 salt 名），默认第一种
  packaging: Record<string, Packaging>;
};

export type Item = {
  id: string;
  kind: 'hardscape' | 'plant';
  name: string;
  x: number; // 平面坐标 cm（左上原点）
  y: number; // cm
  scaleCm: number; // 实际尺寸 cm（最大维度）
  rotDeg: number;
  layer?: 'front' | 'mid' | 'back'; // 水草层次
  lightNeed?: 'low' | 'mid' | 'high';
  growth?: 'slow' | 'mid' | 'fast';
  qty?: number; // 水草株数
  plantId?: string; // 水草素材 id（用于合并同种水草的包装与单价）
  displacement?: number; // 硬景观排水系数（0~1，可配）
  shape?: 'rock' | 'wood';
};

export type Fish = {
  id: string;
  name: string;
  adultCm: number;
  minTankL: number;
  tempRange: [number, number];
  ghRange: [number, number];
  phRange: [number, number];
  temperament: 'peaceful' | 'semi' | 'aggressive';
  plantNip: boolean;
  schooling: boolean;
  minSchool?: number;
  singleMale?: boolean;
};

export type WaterConfig = {
  tapGh: number;
  tapKh: number;
  targetGh: number;
  targetCo2Ppm: number;
  roomTempC: number;
  targetTempC: number;
};

export type Plan = {
  id: string;
  name: string;
  tank: Tank;
  substrate: Substrate;
  /** 混用底砂时的分层；为空/未定义表示单材质（用 substrate） */
  substrateLayers?: SubstrateLayer[];
  items: Item[];
  fishes: { fishId: string; count: number }[];
  water: WaterConfig;
  /** 采购预算输入（包装规格 + 单价，使用者填写） */
  costs?: PlanCosts;
  updatedAt: number;
};

export const EMPTY_WATER: WaterConfig = {
  tapGh: 12,
  tapKh: 6,
  targetGh: 8,
  targetCo2Ppm: 25,
  roomTempC: 24,
  targetTempC: 26,
};
