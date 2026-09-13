import { useMemo, useState } from 'react'
import { inr, pct } from './lib/inr.js'
import { LTCG_EXEMPTION, computeTax, harvestPlan } from './lib/tax.js'
import './TaxOptimizer.css'

// ponytail: the panel prices UNREALISED positions the user typed into the Portfolio panel --
// mark-to-market on a date they pick, with no cost-basis lot history, no STT / brokerage /
// cess, and no gains already booked earlier in the financial year. Phase 2 pulls realised
// transactions from NSDL/CDSL and feeds the same three pure functions; nothing here changes
// shape when it does.

// Sign is carried by the glyph, never by colour alone (a11y).
const signed = (n) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${inr(Math.abs(n))}`

const SLAB_CHOICES = [
  { rate: 5, label: '5% — taxable income up to ₹8L' },
  { rate: 20, label: '20% — ₹8L to ₹20L' },
  { rate: 30, label: '30% — above ₹20L' },
]

// Text first, badge colour second.
function treatment(row, slabRate) {
  if (row.bucket === 'SLAB') {
    return {
      text: `Slab ${slabRate}%`,
      hint: row.kind === 'DEBT_MF' ? 'Sec 50AA — deemed short-term' : 'Gold under 24 months',
      badge: 'badge--danger',
    }
  }
  if (row.bucket === 'LONG') return { text: 'Long-term 12.5%', hint: 'Above the exemption', badge: 'badge--ok' }
  return { text: 'Short-term 20%', hint: 'Sec 111A', badge: 'badge--warn' }
}

function heldFor(months, days) {
  if (months >= 12) return `${Math.floor(months / 12)}y ${months % 12}m`
  if (months >= 1) return `${months} mo`
  return `${days} d`
}

const today = () => new Date().toISOString().slice(0, 10)

export default function TaxOptimizer({ holdings, quiz }) {
  const list = useMemo(() => (Array.isArray(holdings) ? holdings : []), [holdings])
  const [asOf, setAsOf] = useState(today)
  // null means "take the slab from the risk quiz"; a number means the user overrode it.
  const [slabRate, setSlabRate] = useState(null)

  const opts = useMemo(() => ({ asOf, slabRate, quiz }), [asOf, slabRate, quiz])
  const result = useMemo(() => computeTax(list, opts), [list, opts])
  const plan = useMemo(() => harvestPlan(list, opts), [list, opts])

  const income = quiz && quiz.profile ? Number(quiz.profile.monthlyIncome) : 0
  const slabHint =
    slabRate !== null
      ? `Set manually. Clear it by picking the rate your risk profile implies.`
      : income > 0
        ? `Defaulted to ${pct(result.slabRate)} from the ${inr(income)} monthly income in your risk profile.`
        : `No risk profile on file, so the top ${pct(result.slabRate)} slab is assumed. Complete the Risk Profile quiz to set it from your income.`

  const exemptionLeft = Math.max(0, LTCG_EXEMPTION - result.longTerm.exemptionUsed)
  const brokerCount = result.byBroker.length

  return (
    <section className="panel" id="tax" aria-labelledby="tx-title">
      <div className="panel__head">
        <div>
          <h2 className="panel__title" id="tx-title">
            Cross-Platform Tax Optimizer
            <span className="badge badge--secure">{result.financialYear}</span>
          </h2>
          <p className="panel__sub">
            One STCG/LTCG engine over every broker at once — Indian tools stop at a single
            broker's statement. Positions are read from the Portfolio panel as a unified
            NSDL/CDSL-style view, classified under the post-Budget-2024 rules, and checked for
            losses worth harvesting against gains booked anywhere in the set.
          </p>
        </div>
        <div className="panel__actions">
          <span className="tag">{list.length} position(s)</span>
          <span className="tag">{brokerCount} broker(s)</span>
        </div>
      </div>

      <div className="panel__body">
        {list.length === 0 ? (
          <p className="empty">
            No holdings linked yet. Add equity, mutual fund or gold positions in the{' '}
            <a className="tx__link" href="#portfolio">Portfolio</a> panel — this engine prices what you actually hold
            and invents nothing.
          </p>
        ) : (
          <>
            <div className="grid-2">
              <div className="field">
                <label className="field__label" htmlFor="tx-slab">
                  Income tax slab
                </label>
                <select
                  id="tx-slab"
                  value={result.slabRate}
                  onChange={(e) => setSlabRate(Number(e.target.value))}
                >
                  {SLAB_CHOICES.map((s) => (
                    <option key={s.rate} value={s.rate}>
                      {s.label}
                    </option>
                  ))}
                </select>
                <p className="field__hint">{slabHint}</p>
              </div>

              <div className="field">
                <label className="field__label" htmlFor="tx-asof">
                  Value positions as of
                </label>
                <input id="tx-asof" type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
                <p className="field__hint">
                  Holding periods and the ₹1,25,000 exemption are both measured to this date. The
                  Indian financial year runs 1 April to 31 March, so this date sits in{' '}
                  {result.financialYear}.
                </p>
              </div>
            </div>

            <hr className="sep" />

            <div className="tx__result" aria-live="polite">
              <div className="grid-2">
                <div className="stat">
                  <div className="stat__k">Unrealised gain</div>
                  <div className="stat__v">{signed(result.totalGain)}</div>
                  <p className="tx__stat-sub">Across {brokerCount} broker(s), all asset kinds.</p>
                </div>
                <div className="stat">
                  <div className="stat__k">LTCG exemption left</div>
                  <div className="stat__v">{inr(exemptionLeft)}</div>
                  <p className="tx__stat-sub">
                    {inr(result.longTerm.exemptionUsed)} of {inr(LTCG_EXEMPTION)} used this financial year.
                  </p>
                </div>
                <div className="stat">
                  <div className="stat__k">Estimated tax if realised</div>
                  <div className="stat__v">{inr(result.totalTax)}</div>
                  <p className="tx__stat-sub">
                    {inr(result.shortTerm.tax)} short-term · {inr(result.longTerm.tax)} long-term ·{' '}
                    {inr(result.slab.tax)} at slab.
                  </p>
                </div>
                <div className="stat">
                  <div className="stat__k">Financial year</div>
                  <div className="stat__v">{result.financialYear}</div>
                  <p className="tx__stat-sub">Slab applied: {pct(result.slabRate)}.</p>
                </div>
              </div>

              {(result.carryForward.shortTerm > 0 || result.carryForward.longTerm > 0) && (
                <p className="tx__note">
                  Unabsorbed loss carried forward: {inr(result.carryForward.shortTerm)} short-term
                  (sets off against future short- and long-term gains) and{' '}
                  {inr(result.carryForward.longTerm)} long-term (long-term gains only). Both lapse
                  after {result.carryForward.expiresAfter}, and only if the return is filed by the
                  due date.
                </p>
              )}

              <hr className="sep" />

              {/* The headline claim: one liability computed across brokers, not per statement. */}
              <h3 className="tx__h">Unified view — by broker</h3>
              <div className="tx__tablewrap">
                <table className="tx__table">
                  <caption>
                    Every linked broker in one assessment. Capital gains tax is charged on the
                    person, not on the demat account, so a loss at one broker offsets a gain at
                    another — the per-broker tax column is this position's share of that single bill.
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Broker</th>
                      <th scope="col" className="tx__num">Invested</th>
                      <th scope="col" className="tx__num">Current</th>
                      <th scope="col" className="tx__num">Gain / loss</th>
                      <th scope="col" className="tx__num">Est. tax</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.byBroker.map((b) => (
                      <tr key={b.broker}>
                        <th scope="row">{b.broker}</th>
                        <td className="tx__num">{inr(b.invested)}</td>
                        <td className="tx__num">{inr(b.current)}</td>
                        <td className="tx__num">{signed(b.gain)}</td>
                        <td className="tx__num">{inr(b.tax)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <th scope="row">All brokers</th>
                      <td className="tx__num">
                        {inr(result.byBroker.reduce((a, b) => a + b.invested, 0))}
                      </td>
                      <td className="tx__num">
                        {inr(result.byBroker.reduce((a, b) => a + b.current, 0))}
                      </td>
                      <td className="tx__num">{signed(result.totalGain)}</td>
                      <td className="tx__num">{inr(result.totalTax)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              <h3 className="tx__h">By holding</h3>
              <div className="tx__tablewrap">
                <table className="tx__table">
                  <caption>
                    Each position classified by holding period as of {asOf}. Equity and equity
                    funds turn long-term after more than 12 months, gold after more than 24; debt
                    funds are taxed at slab whatever the period. Taxable is what survives after
                    losses and the exemption are set off.
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Holding</th>
                      <th scope="col">Broker</th>
                      <th scope="col">Treatment</th>
                      <th scope="col" className="tx__num">Held</th>
                      <th scope="col" className="tx__num">Gain / loss</th>
                      <th scope="col" className="tx__num">Taxable</th>
                      <th scope="col" className="tx__num">Est. tax</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.byHolding.map((r) => {
                      const t = treatment(r, result.slabRate)
                      return (
                        <tr key={r.holdingId}>
                          <th scope="row">
                            <span className="tx__sym">{r.symbol}</span>
                            <span className="tx__meta">{r.kind.replace('_', ' ')}</span>
                          </th>
                          <td>{r.broker}</td>
                          <td>
                            <span className={`badge ${t.badge}`}>{t.text}</span>
                            <span className="tx__meta">{t.hint}</span>
                          </td>
                          <td className="tx__num">{heldFor(r.months, r.days)}</td>
                          <td className="tx__num">{signed(r.gain)}</td>
                          <td className="tx__num">{inr(r.taxable)}</td>
                          <td className="tx__num">{inr(r.tax)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              <hr className="sep" />

              <h3 className="tx__h">Tax-loss harvesting</h3>
              {plan.candidates.length === 0 ? (
                <p className="empty">
                  No position is showing an unrealised loss, so there is nothing to harvest. The
                  estimated liability stays at {inr(result.totalTax)}.
                </p>
              ) : (
                <>
                  <div className="row">
                    <span className="badge badge--muted">{plan.candidates.length} loss position(s)</span>
                    <span className="tag">−{inr(plan.totalLoss)} unrealised loss</span>
                    <span className="tag">{inr(plan.totalTaxSaved)} tax saved</span>
                    <span className={`badge ${plan.totalTaxSaved > 0 ? 'badge--ok' : 'badge--muted'}`}>
                      {pct(plan.effectiveSavingPct)} of the tax otherwise due
                    </span>
                  </div>
                  <ol className="tx__cands">
                    {plan.candidates.map((c, i) => (
                      <li className="tx__cand" key={c.holdingId}>
                        <div className="tx__cand-head">
                          <span className="tx__rank" aria-hidden="true">
                            {i + 1}
                          </span>
                          <span className="tx__sym">{c.symbol}</span>
                          <span className="tag">{c.broker}</span>
                          <span className={`badge ${c.taxSaved > 0 ? 'badge--ok' : 'badge--muted'}`}>
                            {c.taxSaved > 0 ? `Sell — saves ${inr(c.taxSaved)}` : 'Not worth selling'}
                          </span>
                        </div>
                        <div className="tx__cand-figs">
                          <span className="kv__k">
                            Unrealised loss <b className="kv__v">−{inr(c.unrealisedLoss)}</b>
                          </span>
                          <span className="kv__k">
                            Offsets <b className="kv__v">{c.offsets}</b>
                          </span>
                          <span className="kv__k">
                            Tax saved <b className="kv__v">{inr(c.taxSaved)}</b>
                          </span>
                        </div>
                        <p className="tx__cand-note">{c.note}</p>
                      </li>
                    ))}
                  </ol>
                </>
              )}

              <h3 className="tx__h">What to do before 31 March</h3>
              <ul className="tx__list">
                {plan.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>

              <p className="tx__foot">
                Every figure on this panel is an estimate, not tax advice. It prices unrealised
                positions you entered by hand at the rates in force after Budget 2024, and ignores
                STT, brokerage, surcharge, cess, set-off against other heads of income and any
                gains you already booked this year. Confirm with a chartered accountant before
                acting. Phase 2 replaces the hand-entered input with realised transactions pulled
                from NSDL/CDSL.
              </p>
            </div>
          </>
        )}
      </div>
    </section>
  )
}
