import { useMemo, useState } from 'react';
import type { BudgetCategory } from '../core/types';
import type { Plan } from '../core/types';
import { buildBudget, PACK_UNIT, DEMAND_UNIT } from '../core/budget';
import { GH_SALTS } from '../core/water';
import { FISHES, PLANTS } from '../data/db';
import { updateBudget, updateBudgetEntry } from '../state/plans';
import { Link } from '../router';

type Filter = 'all' | BudgetCategory;

const money = (n: number) => `¥${n.toFixed(2)}`;

export default function BudgetPage({ plan }: { plan: Plan }) {
  const [filter, setFilter] = useState<Filter>('all');
  const fishMap = useMemo(() => new Map(FISHES.map((f) => [f.id, f])), []);
  const plantMap = useMemo(() => new Map(PLANTS.map((p) => [p.id, { name: p.name }])), []);
  const budget = useMemo(() => buildBudget(plan, fishMap, plantMap), [plan, fishMap, plantMap]);

  const visible = filter === 'all' ? budget.lines : budget.lines.filter((l) => l.category === filter);

  return (
    <div className="page budget-page" data-testid="budget-page">
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
        <Link to={`/plan/${plan.id}/bom`} className="tab">
          物料清单
        </Link>
        <span className="tab active">采购预算</span>
      </nav>
      <h1>采购预算（{plan.name}）</h1>
      <p className="muted small">
        用量按市售包装向上取整（底砂按袋 · 水草按盆 · 矿物盐按包 · 鱼按群）；价格请按实际购买包装填写，
        <b className="missing-price">未填价格的项标为"待报价"，不会按 0 元计入合计</b>。
      </p>

      {/* 总计 + 类别小计 */}
      <div className="cards2 budget-summary" data-testid="budget-summary">
        <button
          type="button"
          className={`card2 budget-total ${filter === 'all' ? 'picked' : ''}`}
          data-testid="cat-all"
          onClick={() => setFilter('all')}
        >
          <h3>总计</h3>
          <p className="big" data-testid="grand-total">
            {budget.totalFinal ? money(budget.total) : `${money(budget.total)} 起`}
          </p>
          <p className="muted small">{budget.lines.length} 个采购项</p>
          {!budget.totalFinal && (
            <p className="missing-price" data-testid="grand-missing">
              ⚠ {budget.missingCount} 项待报价，补齐后才是最终总价
            </p>
          )}
        </button>
        {budget.categories.map((c) => (
          <button
            type="button"
            key={c.category}
            className={`card2 ${filter === c.category ? 'picked' : ''}`}
            data-testid={`cat-${c.category}`}
            onClick={() => setFilter(filter === c.category ? 'all' : c.category)}
          >
            <h3>{c.category}小计</h3>
            <p className="big">{c.lines > 0 ? money(c.amount) : '—'}</p>
            <p className="muted small">
              {c.lines} 项
              {c.hasMissing && <span className="missing-price"> · 有待报价项</span>}
            </p>
          </button>
        ))}
      </div>

      {/* 矿物盐选择（仅需要加盐时） */}
      {budget.lines.some((l) => l.category === '矿物盐') && (
        <section className="card2" data-testid="salt-picker">
          <h3>矿物盐选择</h3>
          <label>
            盐种
            <select
              data-testid="salt-select"
              value={budget.saltName}
              onChange={(e) => updateBudget(plan.id, { salt: e.target.value })}
            >
              {GH_SALTS.map((s) => (
                <option key={s.salt} value={s.salt}>
                  {s.salt}（{s.ghPerGramPerL} °dGH/g/L）
                </option>
              ))}
            </select>
          </label>
          <span className="muted small"> 目标 GH 高于自来水时需要加盐；用量随有效水量与 ΔGH 重算。</span>
        </section>
      )}

      <table className="table budget-table" data-testid="budget-table">
        <thead>
          <tr>
            <th>类别</th>
            <th>名称</th>
            <th>规格/说明</th>
            <th>实际用量</th>
            <th>要买（向上取整）</th>
            <th>多出</th>
            <th>包装容量</th>
            <th>整包单价</th>
            <th>行花费</th>
            <th>折合单价</th>
          </tr>
        </thead>
        <tbody>
          {visible.length === 0 && (
            <tr>
              <td colSpan={10} className="muted" data-testid="budget-empty">
                该类别暂无采购项。
              </td>
            </tr>
          )}
          {visible.map((l) => (
            <tr key={`${l.category}-${l.key}`} data-testid={`budget-line-${l.category}`} data-budget-key={l.key}>
              <td>{l.category}</td>
              <td>{l.name}</td>
              <td className="muted small">{l.spec}</td>
              <td>
                <b data-testid="demand">{l.demandText}</b>
              </td>
              <td>
                <b data-testid="bought">{l.boughtText}</b>
              </td>
              <td className={l.surplus > 0 ? 'surplus' : 'muted'} data-testid="surplus">
                {l.surplus > 0 ? `+${l.surplusText}` : '刚好'}
                {l.surplusWorth !== undefined && l.surplusWorth > 0 && (
                  <div className="muted small">浪费 {money(l.surplusWorth)}</div>
                )}
              </td>
              <td>
                <div className="row pack-input">
                  <input
                    type="number"
                    className="num-sm"
                    data-testid="pack-size"
                    aria-label={`${l.name} 包装容量`}
                    value={plan.budget?.entries?.[l.key]?.packSize ?? l.packSize}
                    step={l.category === '底砂' || l.category === '矿物盐' ? 0.5 : 1}
                    min={0}
                    onChange={(e) => {
                      const v = e.target.value === '' ? undefined : Math.max(0, Number(e.target.value));
                      updateBudgetEntry(plan.id, l.key, { packSize: v });
                    }}
                  />
                  <span className="muted small">
                    {DEMAND_UNIT[l.category]}/{PACK_UNIT[l.category]}
                  </span>
                </div>
              </td>
              <td>
                <div className="row pack-input">
                  <span className="muted">¥</span>
                  <input
                    type="number"
                    className={`num-sm ${l.priceMissing ? 'price-missing-input' : ''}`}
                    data-testid="pack-price"
                    aria-label={`${l.name} 整包单价`}
                    value={plan.budget?.entries?.[l.key]?.packPrice ?? ''}
                    placeholder="待填"
                    min={0}
                    onChange={(e) => {
                      const v = e.target.value === '' ? undefined : Math.max(0, Number(e.target.value));
                      updateBudgetEntry(plan.id, l.key, { packPrice: v });
                    }}
                  />
                </div>
              </td>
              <td data-testid="line-cost">{l.cost !== undefined ? money(l.cost) : <span className="missing-price">待报价</span>}</td>
              <td className="muted small" data-testid="effective-unit">
                {l.effectiveUnit !== undefined ? `${money(l.effectiveUnit)} / ${DEMAND_UNIT[l.category]}` : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">
        折合单价 = 行花费 ÷ 实际用量（多买的浪费摊到实际用量上）；改底砂材质/厚度、水草株数、鱼尾数后，用量与买量自动重算。
      </p>
    </div>
  );
}
