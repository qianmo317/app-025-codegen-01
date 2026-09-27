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

export type Substrate = {
  kind: 'sand' | 'gravel' | 'soil' | 'ada';
  densityKgPerL: number; // 密度 kg/L（可配）
  thicknessMm: number; // 基础厚度 mm
  slopeMm: number; // 坡度（前后落差 mm）
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

export type BudgetCategory = '底砂' | '水草' | '矿物盐' | '鱼';

export type Plan = {
  id: string;
  name: string;
  tank: Tank;
  substrate: Substrate;
  /** 混用的第二种底砂；存在时按 budget.sub2Ratio 与主底砂分摊底砂层 */
  substrate2?: Substrate;
  items: Item[];
  fishes: { fishId: string; count: number }[];
  water: WaterConfig;
  /** 采购预算页的市售包装/单价配置（按 key 存用户填写值，缺省视为未填） */
  budget?: BudgetConfig;
  updatedAt: number;
};

/** 预算页单项配置：同 key 的用量会合并为同一采购行 */
export type BudgetEntryConfig = {
  /** 市售包装容量（底砂 kg/袋、水草 株/盆、矿物盐 g/包、鱼 尾/群）；undefined 用类别默认 */
  packSize?: number;
  /** 整包单价；undefined 表示用户还没填，按"待报价"处理而非 0 */
  packPrice?: number;
};

export type BudgetConfig = {
  /** 第二种底砂占底砂层的比例（0~1）；仅 substrate2 存在时生效 */
  sub2Ratio?: number;
  /** 选用的矿物盐（GH_SALTS 的 salt 名；默认无水氯化钙） */
  salt?: string;
  /** key 规则：底砂=sub:<kind>，水草=plant:<id 或名称>，矿物盐=salt:<名称>，鱼=fish:<id> */
  entries: Record<string, BudgetEntryConfig>;
};

export const EMPTY_WATER: WaterConfig = {
  tapGh: 12,
  tapKh: 6,
  targetGh: 8,
  targetCo2Ppm: 25,
  roomTempC: 24,
  targetTempC: 26,
};
