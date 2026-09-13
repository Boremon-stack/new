import { useEffect, useMemo, useState } from 'react'
import { inr, pct } from './lib/inr.js'
import { buildBlueprint, analyzeSpending } from './lib/blueprint.js'
import './Blueprint.css'

// Status is carried by text first; the badge colour is only a second channel (a11y).
const STATUS = {
  over: { text: 'Over plan', badge: 'badge--danger' },
  under: { text: 'Under plan', badge: 'badge--warn' },
  on: { text: 'On plan', badge: 'badge--ok' },
}

const MODE_BADGE = {
  Conservative: 'badge--muted',
  Balanced: 'badge--ok',
  Aggressive: 'badge--warn',
}

export default function Blueprint({ quiz, accounts }) {
  const list = Array.isArray(accounts) ? accounts : []
  const stamp = quiz && typeof quiz === 'object' ? (quiz.completedAt ?? null) : null
  const [analysis, setAnalysis] = useState(null)

  // FR-BB-07: a retake stamps a new completedAt, so the previous spend read is stale -- drop it.
  useEffect(() => {
    setAnalysis(null)
  }, [stamp])

  // FR-BB-02: the blueprint is derived from the prop. No generate button, nothing to press.
  const plan = useMemo(() => (quiz && typeof quiz === 'object' ? buildBlueprint(quiz) : null), [quiz])

  // FR-BB-01: locked state.
  if (!plan) {
    return (
      <section className="panel" id="blueprint" aria-labelledby="bp-title">
        <div className="panel__head">
          <div>
            <h2 className="panel__title" id="bp-title">
              Budget Blueprint
            </h2>
            <p className="panel__sub">Complete the quiz to unlock your personalized automation plan.</p>
          </div>
          <div className="panel__actions">
            <span className="badge badge--muted">Locked</span>
          </div>
        </div>
        <div className="panel__body">
          <p className="empty">Awaiting analysis.</p>
        </div>
      </section>
    )
  }

  const invest = plan.allocations.find((a) => a.key === 'Investments')

  return (
    <section className="panel" id="blueprint" aria-labelledby="bp-title">
      <div className="panel__head">
        <div>
          <h2 className="panel__title" id="bp-title">
            Budget Blueprint
            {/* FR-BB-06 */}
            <span className={`badge ${MODE_BADGE[plan.mode] ?? 'badge--muted'}`}>{plan.mode} mode</span>
          </h2>
          <p className="panel__sub">
            Your {plan.mode} risk mode drove how aggressive this allocation is — it set the base split
            across Needs, Wants, Savings and Investments, and your EMI load, dependents, emergency
            fund and {quiz.profile?.horizonYears ?? 0}-year horizon then adjusted it.
          </p>
        </div>
        <div className="panel__actions">
          <span className="tag">{list.length} linked</span>
          {/* FR-BB-04 */}
          <button type="button" className="btn btn--primary" onClick={() => setAnalysis(analyzeSpending(quiz, list))}>
            Analyze and Automate Spending
          </button>
        </div>
      </div>

      <div className="panel__body">
        <div className="grid-2">
          <div className="stat">
            <div className="stat__k">Monthly income</div>
            <div className="stat__v">{inr(plan.monthlyIncome)}</div>
          </div>
          <div className="stat">
            <div className="stat__k">Savings rate</div>
            <div className="stat__v">{pct(plan.savingsRate)}</div>
          </div>
          <div className="stat">
            <div className="stat__k">Invested monthly</div>
            <div className="stat__v">{inr(invest?.amount ?? 0)}</div>
          </div>
        </div>

        {/* FR-BB-03: percentages and rupees, with a bar per bucket. */}
        <h3 className="bp__h">Monthly allocation</h3>
        <div className="bp__alloc">
          {plan.allocations.map((a) => (
            <div className="bp__alloc-row" key={a.key}>
              <div className="bp__alloc-top">
                <span className="bp__alloc-label">{a.label}</span>
                <span className="bp__alloc-figure">
                  {pct(a.pct)} · {inr(a.amount)}
                </span>
              </div>
              <div
                className="meter"
                role="img"
                aria-label={`${a.label}: ${pct(a.pct)} of monthly income, ${inr(a.amount)} per month`}
              >
                <div className="meter__fill" style={{ width: `${Math.max(0, Math.min(100, a.pct))}%` }} />
              </div>
              <p className="bp__alloc-note">{a.note}</p>
            </div>
          ))}
        </div>

        <hr className="sep" />

        <h3 className="bp__h">Inside the {inr(invest?.amount ?? 0)} Investments bucket</h3>
        <div className="stack">
          {plan.investmentSplit.map((s) => (
            <div className="kv" key={s.label}>
              <span className="kv__k">{s.label}</span>
              <span className="kv__v">
                {pct(s.pct)} · {inr(s.amount)}
              </span>
            </div>
          ))}
        </div>

        <hr className="sep" />

        <h3 className="bp__h">Guardrails</h3>
        <ul className="bp__list">
          {plan.guardrails.map((g) => (
            <li key={g}>{g}</li>
          ))}
        </ul>

        <hr className="sep" />

        {/* FR-BB-05 */}
        <div className="bp__result" aria-live="polite">
          {!analysis && (
            <p className="empty">
              Run <strong>Analyze and Automate Spending</strong> to compare the last 30 days of your
              linked accounts against this blueprint.
            </p>
          )}

          {analysis && analysis.sampleCount === 0 && (
            <p className="empty">
              No accounts are linked, so there is nothing to analyse — link a bank or fixed deposit
              account above first. No spend profile is invented from an empty portfolio.
            </p>
          )}

          {analysis && analysis.sampleCount > 0 && (
            <div className="stack">
              <div className="row">
                <span className="badge badge--ok">{analysis.windowLabel}</span>
                <span className="tag">{analysis.sampleCount} simulated transactions</span>
                <span className="tag">
                  {inr(analysis.totalActual)} actual vs {inr(analysis.totalPlanned)} planned
                </span>
              </div>

              <div className="bp__tablewrap">
                <table className="bp__table">
                  <caption>
                    Actual spending versus the planned blueprint — {analysis.windowLabel}, across{' '}
                    {list.length} linked account(s).
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Category</th>
                      <th scope="col" className="bp__num">
                        Planned
                      </th>
                      <th scope="col" className="bp__num">
                        Actual
                      </th>
                      <th scope="col" className="bp__num">
                        Difference
                      </th>
                      <th scope="col">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analysis.rows.map((r) => (
                      <tr key={r.key}>
                        <th scope="row">{r.label}</th>
                        <td className="bp__num">{inr(r.planned)}</td>
                        <td className="bp__num">{inr(r.actual)}</td>
                        <td className="bp__num">
                          {r.delta > 0 ? '+' : r.delta < 0 ? '−' : ''}
                          {inr(Math.abs(r.delta))}
                        </td>
                        <td>
                          <span className={`badge ${STATUS[r.status].badge}`}>{STATUS[r.status].text}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <th scope="row">Total</th>
                      <td className="bp__num">{inr(analysis.totalPlanned)}</td>
                      <td className="bp__num">{inr(analysis.totalActual)}</td>
                      <td className="bp__num">
                        {analysis.totalActual - analysis.totalPlanned > 0 ? '+' : '−'}
                        {inr(Math.abs(analysis.totalActual - analysis.totalPlanned))}
                      </td>
                      <td>
                        {analysis.totalActual > analysis.totalPlanned ? 'Over plan' : 'Within plan'}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              <h3 className="bp__h">What to change</h3>
              <ul className="bp__list">
                {analysis.insights.map((i) => (
                  <li key={i}>{i}</li>
                ))}
              </ul>
              <p className="bp__foot">
                Transactions are simulated deterministically from your linked accounts — FinNexus makes
                no live bank connection. Phase 2 replaces this with RBI Account Aggregator feeds.
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
