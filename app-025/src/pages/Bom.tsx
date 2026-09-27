import { useMemo } from 'react';
import type { Plan } from '../core/types';
import { buildBom } from '../core/bom';
import { buildBudget, GH_SALT_NAMES, type BudgetLine, type CategoryBudget } from '../core/budget';
import { FISHES, PLANTS } from '../data/db';
import { updatePackaging, updateSaltKey } from '../state/plans';
import { Link } from '../router';

export default function Bom({ plan }: { plan: Plan }) {
  const fishMap = useMemo(() => new Map(FISHES.map((f) => [f.id, f])), []);
  const plantMap = useMemo(
    () => new Map(PLANTS.map((p) => [p.id, { name: p.name, lightNeed: p.lightNeed }])),
    [],
  );
  const bom = useMemo(() => buildBom(plan, fishMap, plantMap), [plan, fishMap, plantMap]);
  const budget = useMemo(() => buildBudget(plan, fishMap, plantMap), [plan, fishMap, plantMap]);
  const saltLine = budget.lines.find((l) => l.category === '矿物盐');
  const saltKey = plan.costs?.saltKey ?? GH_SALT_NAMES[0];

  function downloadSvg() {
    const svg = renderPlanSvg(plan);
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${plan.name}-平面图.svg`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="page bom-page" data-testid="bom-page">
      <nav className="row tabs no-print">
        <Link to={`/plan/${plan.id}`} className="tab">
          ← 造景编辑
        </Link>
        <Link to={`/plan/${plan.id}/water`} className="tab">
          水质与设备
        </Link>
        <Link to={`/plan/${plan.id}/stocking`} className="tab">
          生物兼容
        </Link>
        <span className="tab active">物料清单</span>
      </nav>
      <h1>物料清单与采购预算（{plan.name}）</h1>

      <div className="row no-print">
        <button className="btn primary" data-testid="print-btn" onClick={() => window.print()}>
          打印（A4 参数卡）
        </button>
        <button className="btn" data-testid="export-svg" onClick={downloadSvg}>
          导出平面图 SVG
        </button>
      </div>

      {/* 采购预算：按市售包装向上取整，用量/买量并排，缺价标出不按零计 */}
      <section data-testid="budget-section">
        <div className="section-head">
          <h2>采购预算</h2>
          <div className="budget-totals" data-testid="budget-totals">
            {budget.lineCount === 0 ? (
              <span className="muted small">方案中还没有可采购的物料。</span>
            ) : budget.total === undefined ? (
              <span className="bad" data-testid="budget-total-missing">
                共 {budget.lineCount} 项，{budget.missingCount} 项价格未填（标「待报价」），补齐后才出总计；
                已填项合计 <b data-testid="budget-priced-sum">{money(sumPriced(budget.lines))}</b>
              </span>
            ) : (
              <span>
                共 {budget.lineCount} 项 · 总计 <b className="big-inline" data-testid="budget-total">{money(budget.total)}</b>
              </span>
            )}
          </div>
        </div>

        {saltLine && (
          <div className="row salt-pick no-print" data-testid="salt-pick">
            <label>
              矿物盐种类（改种类后用量与单价重算）
              <select
                data-testid="salt-select"
                value={saltKey}
                onChange={(e) => updateSaltKey(plan.id, e.target.value)}
              >
                {GH_SALT_NAMES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

        {budget.categories.map((cat) => (
          <BudgetCategoryTable
            key={cat.category}
            cat={cat}
            planId={plan.id}
            saltKey={saltKey}
          />
        ))}
      </section>

      <h2>物料明细（用量依据）</h2>
      <table className="table" data-testid="bom-table">
        <thead>
          <tr>
            <th>类别</th>
            <th>名称</th>
            <th>规格</th>
            <th>数量</th>
          </tr>
        </thead>
        <tbody>
          {bom.lines.map((l, i) => (
            <tr key={i} data-testid={`bom-line-${l.category}`}>
              <td>{l.category}</td>
              <td>{l.name}</td>
              <td className="muted small">{l.spec}</td>
              <td>
                <b>{l.qty}</b>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <section className="card2 care-card" data-testid="care-card">
        <h3>养护参数卡（贴缸）</h3>
        <ul>
          <li>
            换水：每周 <b>{bom.care.waterChangePct}%</b>
          </li>
          <li>
            光照：<b>{bom.care.lightHours}</b>
          </li>
          <li>
            CO₂ 日程：<b>{bom.care.co2Schedule}</b>
          </li>
          <li>
            喂食：<b>{bom.care.feedingTimes}</b>
          </li>
        </ul>
        <p className="muted small">缸体 {plan.tank.l}×{plan.tank.w}×{plan.tank.h}cm · 玻璃 {plan.tank.glassMm}mm · {plan.tank.openTop ? '开放缸' : '封闭缸'}</p>
      </section>
    </div>
  );
}

function BudgetCategoryTable({ cat, planId, saltKey }: { cat: CategoryBudget; planId: string; saltKey: string }) {
  return (
    <div className="budget-cat" data-testid={`budget-cat-${cat.category}`}>
      <div className="budget-cat-head">
        <h3>{cat.category}小计</h3>
        <span data-testid={`budget-subtotal-${cat.category}`}>
          {cat.subtotal === undefined ? (
            <span className="bad">
              {cat.missing} 项待报价{cat.lines.some((l) => !l.priceMissing) ? `，已填项合计 ${money(sumPriced(cat.lines))}` : ''}
            </span>
          ) : (
            <b>{money(cat.subtotal)}</b>
          )}
        </span>
      </div>
      <table className="table budget-table" data-testid={`budget-table-${cat.category}`}>
        <thead>
          <tr>
            <th>名称</th>
            <th>规格</th>
            <th>实际用量</th>
            <th>每包容量</th>
            <th>要买（向上取整）</th>
            <th>买到用量</th>
            <th>多出</th>
            <th>每包单价（元）</th>
            <th>折合单价</th>
            <th>小计</th>
          </tr>
        </thead>
        <tbody>
          {cat.lines.map((line) => (
            <BudgetRow key={line.key} line={line} planId={planId} saltKey={saltKey} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BudgetRow({ line, planId, saltKey }: { line: BudgetLine; planId: string; saltKey: string }) {
  const isSalt = line.category === '矿物盐';
  // 盐切换种类后，旧种类的行不应继续存在；若出现 key 与当前选中不一致则以当前盐为准
  const editableKey = isSalt ? `salt:${saltKey}` : line.key;
  return (
    <tr data-testid={`budget-line-${line.key}`} className={line.priceMissing ? 'row-missing-price' : ''}>
      <td>
        {line.name}
        {line.priceMissing && <span className="price-tag" data-testid={`price-missing-${line.key}`}>待报价</span>}
      </td>
      <td className="muted small">{line.spec}</td>
      {/* 用量与买量并排显示 */}
      <td data-testid={`need-${line.key}`}>
        {fmt(line.needValue)} {line.needUnit}
      </td>
      <td>
        <input
          type="number"
          className="num-input"
          data-testid={`packsize-${line.key}`}
          value={line.packSize}
          min={0}
          step="any"
          onChange={(e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v)) updatePackaging(planId, editableKey, { packSize: v });
          }}
        />{' '}
        <span className="muted small">{line.needUnit}/{line.packUnit}</span>
      </td>
      <td>
        <b data-testid={`packs-${line.key}`}>{line.packs}</b> {line.packUnit}
      </td>
      <td className="muted" data-testid={`bought-${line.key}`}>
        {fmt(line.boughtValue)} {line.needUnit}
      </td>
      <td className="surplus" data-testid={`surplus-${line.key}`}>
        {line.surplusValue > 1e-9 ? `+${fmt(line.surplusValue)} ${line.needUnit}` : '—'}
      </td>
      <td>
        <input
          type="number"
          className="num-input price-input"
          data-testid={`price-${line.key}`}
          defaultValue={line.unitPrice ?? ''}
          placeholder="待填"
          min={0}
          step="any"
          onBlur={(e) => {
            const raw = e.target.value.trim();
            const v = raw === '' ? undefined : Number(raw);
            updatePackaging(planId, editableKey, v === undefined || !Number.isFinite(v) || v <= 0 ? { unitPrice: undefined } : { unitPrice: v });
          }}
        />
      </td>
      <td className="muted small" data-testid={`eff-price-${line.key}`}>
        {line.effectiveUnitPrice === undefined ? '—' : `${money(line.effectiveUnitPrice)}/${line.needUnit}`}
      </td>
      <td data-testid={`linecost-${line.key}`}>
        {line.lineCost === undefined ? <span className="muted">待报价</span> : money(line.lineCost)}
      </td>
    </tr>
  );
}

function sumPriced(lines: BudgetLine[]): number {
  return lines.reduce((s, l) => s + (l.lineCost ?? 0), 0);
}

/** 金额：两位小数，抹去无意义的 0 */
function money(v: number): string {
  return `¥${round2(v).toFixed(2)}`;
}

function round2(v: number): number {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

/** 用量类数值：最多 2 位小数（盐克数、底砂 kg 可能带小数） */
function fmt(v: number): string {
  return round2(v).toString();
}

/** 导出带尺寸标注的平面图 SVG */
function renderPlanSvg(plan: Plan): string {
  const { tank } = plan;
  const scale = 10; // 10px per cm
  const W = tank.l * scale;
  const H = tank.w * scale;
  const shapes = plan.items
    .map((it) => {
      const s = it.scaleCm * scale;
      const color = it.kind === 'plant' ? (it.layer === 'front' ? '#d9534f' : it.layer === 'mid' ? '#f0ad4e' : '#4285f4') : '#a08050';
      const label = `${it.name} ${it.scaleCm}cm`;
      return it.kind === 'hardscape'
        ? `<rect x="${(it.x - it.scaleCm / 2) * scale}" y="${(it.y - it.scaleCm / 2) * scale}" width="${s}" height="${s * 0.7}" rx="${s * 0.15}" fill="#a08050" stroke="#6b4f2a" stroke-width="2"><title>${label}</title></rect>`
        : `<circle cx="${it.x * scale}" cy="${it.y * scale}" r="${s / 2}" fill="#7dbb6c" stroke="${color}" stroke-width="2" opacity="0.8"><title>${label}</title></circle>`;
    })
    .join('\n  ');
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect x="0" y="0" width="${W}" height="${H}" fill="#eaf3f6" stroke="#333" stroke-width="3"/>
  <text x="8" y="20" font-size="14" fill="#333">${plan.name} 平面图 ${tank.l}×${tank.w}cm（底砂 ${plan.substrate.thicknessMm}+${plan.substrate.slopeMm}mm）</text>
  ${shapes}
</svg>`;
}
