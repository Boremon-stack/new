import { useMemo, useState } from 'react'
import { inr, pct } from './lib/inr.js'
import { useSession } from './lib/useSession.js'
import { forecastBalance, parseGoal, planGoal, suggestInstruments } from './lib/forecast.js'
import './Brain.css'

const WINDOWS = [30, 60, 90]
const SLABS = [0, 5, 10, 15, 20, 25, 30]

const num = (v) => (Number.isFinite(+v) ? +v : 0)

const dayFmt = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
})
const showDay = (isoDay) => {
  const d = new Date(`${isoDay}T00:00:00.000Z`)
  return Number.isNaN(d.getTime()) ? isoDay : dayFmt.format(d)
}

// Status is carried by text first; the badge colour is only a second channel (a11y).
const TONE = { danger: 'badge--danger', warn: 'badge--warn', ok: 'badge--ok', info: 'badge--muted' }
const TONE_TEXT = { danger: 'Act now', warn: 'Watch', ok: 'Clear', info: 'Note' }

/* The projected balance as an inline SVG, no chart library.
   preserveAspectRatio="none" lets it fill any column width at a fixed height;
   vector-effect keeps the stroke an even weight through that stretch. */
const W = 720
const H = 160

function buildChart(series) {
  const vals = series.map((p) => p.balance)
  const hi = Math.max(...vals, 0)
  const lo = Math.min(...vals, 0)
  const span = hi - lo || 1
  const x = (i) => (series.length < 2 ? W / 2 : (i / (series.length - 1)) * W)
  const y = (v) => 8 + (1 - (v - lo) / span) * (H - 16)
  const points = series.map((p, i) => `${x(i).toFixed(2)},${y(p.balance).toFixed(2)}`).join(' ')
  return { points, area: `0,${H} ${points} ${W},${H}`, y, x, belowZero: lo < 0 }
}

export default function Brain({ accounts, obligations, quiz }) {
  const list = useMemo(
    () => (Array.isArray(accounts) ? accounts : []).filter((a) => a && typeof a === 'object'),
    [accounts],
  )
  const bills = useMemo(
    () => (Array.isArray(obligations) ? obligations : []).filter((o) => o && typeof o === 'object'),
    [obligations],
  )
  const profile =
    quiz && typeof quiz === 'object' && quiz.profile && typeof quiz.profile === 'object' ? quiz.profile : null

  const [days, setDays] = useState(30)
  const [slabRate, setSlabRate] = useState(20)
  const [annualReturnPct, setAnnualReturnPct] = useState(10)
  const [text, setText] = useState('')
  const [result, setResult] = useState(null)
  const [goals, setGoals] = useSession('fx.goals', [])

  // The engine never reads the clock. The component does it once, here, and
  // injects the day -- that is the whole reason forecast.js stays pure.
  const today = useMemo(() => {
    const d = new Date()
    return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())).toISOString().slice(0, 10)
  }, [])

  const banks = list.filter((a) => a.kind === 'BANK')
  const monthlyCredit = banks.reduce((s, a) => s + Math.max(0, num(a.meta?.monthlyCredit)), 0)
  const monthlyExpenses = profile ? Math.max(0, num(profile.monthlyExpenses)) : Math.round(monthlyCredit * 0.6)
  const monthlyIncome = profile ? Math.max(0, num(profile.monthlyIncome)) : monthlyCredit
  const emiLoad = profile ? Math.max(0, num(profile.emiLoad)) : 0
  const surplus = profile ? Math.max(0, monthlyIncome - monthlyExpenses - emiLoad) : 0

  const fc = useMemo(
    () => forecastBalance(list, bills, { from: today, days, monthlyExpenses }),
    [list, bills, today, days, monthlyExpenses],
  )
  const chart = useMemo(() => buildChart(fc.series), [fc])

  const instruments = useMemo(
    () => (profile ? suggestInstruments({ ...profile, mode: quiz.mode }, { slabRate }) : []),
    [profile, quiz, slabRate],
  )

  const savedPlans = useMemo(
    () =>
      (Array.isArray(goals) ? goals : []).map((g) => ({
        ...g,
        plan: planGoal(g, { monthlySurplus: surplus, annualReturnPct, now: today }),
      })),
    [goals, surplus, annualReturnPct, today],
  )

  /* Autonomous monitoring: every flag names the number that triggered it. */
  const flags = useMemo(() => {
    const out = []

    if (banks.length === 0) {
      out.push({
        key: 'no-bank',
        tone: 'info',
        title: 'Nothing to project',
        body: 'No bank account is linked, so the opening balance is ₹0. Link one in Connections — a fixed deposit is not spendable cash and is excluded on purpose.',
      })
    } else if (fc.min.balance < 0) {
      out.push({
        key: 'dip',
        tone: 'danger',
        title: 'Projected shortfall',
        body: `The ${fc.days}-day projection crosses zero and bottoms at ${inr(fc.min.balance)} on ${showDay(fc.min.date)}, against an opening balance of ${inr(fc.opening)}. Move a debit after the 1st or top the account up before that date.`,
      })
    } else if (fc.min.balance < fc.monthlyBurn / 2) {
      out.push({
        key: 'thin',
        tone: 'warn',
        title: 'Thin buffer',
        body: `The low point is ${inr(fc.min.balance)} on ${showDay(fc.min.date)} — under half of one month's burn of ${inr(fc.monthlyBurn)}. One unplanned bill puts the account overdrawn.`,
      })
    } else {
      out.push({
        key: 'clear',
        tone: 'ok',
        title: 'Projection stays positive',
        body: `The low point over ${fc.days} days is ${inr(fc.min.balance)} on ${showDay(fc.min.date)}, closing at ${inr(fc.closing)}.`,
      })
    }

    if (bills.length > 0) {
      const share = monthlyCredit > 0 ? (fc.monthlyObligations / monthlyCredit) * 100 : 0
      out.push({
        key: 'oblig',
        tone: share > 60 ? 'danger' : share > 40 ? 'warn' : 'ok',
        title: 'Committed outgo',
        body:
          monthlyCredit > 0
            ? `${bills.length} standing debit(s) take ${inr(fc.monthlyObligations)} a month — ${pct(share)} of the ${inr(monthlyCredit)} credited to your linked accounts.`
            : `${bills.length} standing debit(s) take ${inr(fc.monthlyObligations)} a month, and no monthly credit is recorded on any linked account to meet them.`,
      })
    }

    const sipTotal = bills
      .filter((o) => o.kind === 'SIP')
      .reduce((s, o) => s + Math.max(0, num(o.amount)), 0)
    if (sipTotal > 0 && fc.min.balance < sipTotal) {
      out.push({
        key: 'sip',
        tone: 'warn',
        title: 'SIP the projection cannot cover',
        body: `SIP mandates total ${inr(sipTotal)} a month, but the projected low point is ${inr(fc.min.balance)}. A bounced auto-debit costs a penalty and breaks the step-up — move the SIP to the 2nd, right behind the salary credit.`,
      })
    }

    if (profile) {
      const months = num(profile.emergencyMonths)
      const target = monthlyExpenses * 6
      out.push({
        key: 'ef',
        tone: months < 3 ? 'danger' : months < 6 ? 'warn' : 'ok',
        title: 'Emergency fund',
        body: `${months} month(s) logged against a 6-month target of ${inr(target)} on a ${inr(monthlyExpenses)} spend — ${inr(Math.max(0, target - monthlyExpenses * months))} still to build.`,
      })

      const emiShare = monthlyIncome > 0 ? (emiLoad / monthlyIncome) * 100 : 0
      out.push({
        key: 'emi',
        tone: emiShare > 40 ? 'danger' : emiShare > 25 ? 'warn' : 'ok',
        title: 'EMI load',
        body: `${inr(emiLoad)} of EMIs against ${inr(monthlyIncome)} of income is ${pct(emiShare)}; the working ceiling is 40% (${inr(monthlyIncome * 0.4)}).`,
      })

      out.push({
        key: '80c',
        tone: slabRate > 0 ? 'warn' : 'info',
        title: 'Section 80C headroom',
        body:
          slabRate > 0
            ? `Nothing in your linked accounts is an 80C instrument — only bank and FD balances — so up to ${inr(150000)} of the ceiling looks unused. At a ${slabRate}% slab that is ${inr(Math.round(150000 * (slabRate / 100)))} of tax a year, plus ${inr(Math.round(50000 * (slabRate / 100)))} more if NPS 80CCD(1B) is also empty.`
            : `At a 0% slab there is no tax to save, so treat the ₹1,50,000 80C ceiling as irrelevant and pick instruments on lock-in and risk alone.`,
      })
    } else {
      out.push({
        key: 'noquiz',
        tone: 'info',
        title: 'No risk profile on file',
        body: 'Income, expenses, EMI load and emergency fund are unknown until the Risk Profile quiz is done, so the emergency-fund, EMI and 80C checks cannot run.',
      })
    }

    const idle = fc.opening - monthlyExpenses * 6
    if (monthlyExpenses > 0 && idle > 0) {
      out.push({
        key: 'idle',
        tone: 'warn',
        title: 'Idle cash',
        body: `${inr(fc.opening)} sits in savings against a 6-month buffer of ${inr(monthlyExpenses * 6)} — ${inr(idle)} is earning a savings-account rate when it does not need to be that liquid.`,
      })
    }

    return out.slice(0, 6)
  }, [banks.length, bills, fc, monthlyCredit, monthlyExpenses, monthlyIncome, emiLoad, profile, slabRate])

  function onPlan(e) {
    e.preventDefault()
    const parsed = parseGoal(text, { now: today })
    setResult(
      parsed.ok
        ? { ...parsed, plan: planGoal(parsed, { monthlySurplus: surplus, annualReturnPct, now: today }) }
        : parsed,
    )
  }

  function keepGoal() {
    if (!result || !result.ok) return
    const { label, targetAmount, targetDate, horizonMonths, raw } = result
    setGoals((g) => [
      ...(Array.isArray(g) ? g : []),
      { id: `goal-${Date.now()}`, label, targetAmount, targetDate, horizonMonths, raw },
    ])
    setText('')
    setResult(null)
  }

  const chartLabel = `Rule-based balance projection over ${fc.days} days. Opens at ${inr(fc.opening)} on ${showDay(fc.from)}, closes at ${inr(fc.closing)} on ${showDay(fc.to)}. Lowest point ${inr(fc.min.balance)} on ${showDay(fc.min.date)}.`

  return (
    <section className="panel" id="brain" aria-labelledby="br-title">
      <div className="panel__head">
        <div>
          <h2 className="panel__title" id="br-title">
            Financial Brain
            <span className="badge badge--muted">Rule-based projection</span>
          </h2>
          <p className="panel__sub">
            Arithmetic over the figures you entered — a calendar walk of credits, standing debits and
            spread expenses, plus an annuity formula for goals. No model is trained and nothing is
            predicted; Phase 2 replaces the projection with a model fitted to real Account Aggregator
            transaction history.
          </p>
        </div>
        <div className="panel__actions">
          <span className="tag">{banks.length} bank account(s)</span>
          <span className="tag">{bills.length} standing debit(s)</span>
        </div>
      </div>

      <div className="panel__body">
        {/* ---------------------------------------------- balance projection */}
        <h3 className="br__h" id="br-proj">
          Balance projection
        </h3>

        <div className="row br__seg" role="group" aria-label="Projection window">
          {WINDOWS.map((d) => (
            <button
              key={d}
              type="button"
              className={`btn btn--sm ${d === days ? 'btn--primary' : ''}`}
              aria-pressed={d === days}
              onClick={() => setDays(d)}
            >
              {d} days
            </button>
          ))}
        </div>

        {banks.length === 0 ? (
          <p className="empty">
            No bank account is linked, so there is no spendable balance to project. Link one under
            Connections — fixed deposits are held out of this curve on purpose, they are not cash.
          </p>
        ) : (
          <>
            <div className="grid-2">
              <div className="stat">
                <div className="stat__k">Opening</div>
                <div className="stat__v">{inr(fc.opening)}</div>
              </div>
              <div className="stat">
                <div className="stat__k">Closing, day {fc.days}</div>
                <div className="stat__v">{inr(fc.closing)}</div>
              </div>
              <div className="stat">
                <div className="stat__k">Lowest point</div>
                <div className="stat__v">{inr(fc.min.balance)}</div>
              </div>
              <div className="stat">
                <div className="stat__k">Monthly burn</div>
                <div className="stat__v">{inr(fc.monthlyBurn)}</div>
              </div>
            </div>

            <div className="br__chartwrap">
              <svg
                className="br__chart"
                viewBox={`0 0 ${W} ${H}`}
                preserveAspectRatio="none"
                role="img"
                aria-label={chartLabel}
              >
                <polygon points={chart.area} fill="var(--accent-bg)" />
                {chart.belowZero && (
                  <line
                    x1="0"
                    x2={W}
                    y1={chart.y(0)}
                    y2={chart.y(0)}
                    stroke="var(--danger)"
                    strokeWidth="1.5"
                    strokeDasharray="6 5"
                    vectorEffect="non-scaling-stroke"
                  />
                )}
                <polyline
                  points={chart.points}
                  fill="none"
                  stroke="var(--accent)"
                  strokeWidth="2"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
                <line
                  x1={chart.x(fc.series.findIndex((p) => p.date === fc.min.date))}
                  x2={chart.x(fc.series.findIndex((p) => p.date === fc.min.date))}
                  y1="0"
                  y2={H}
                  stroke="var(--ink-3)"
                  strokeWidth="1"
                  strokeDasharray="3 4"
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
            </div>

            <div className="row br__legend">
              <span className="tag">{showDay(fc.from)}</span>
              <span className="tag">Low {inr(fc.min.balance)} on {showDay(fc.min.date)}</span>
              <span className="tag">{showDay(fc.to)}</span>
              {chart.belowZero && (
                <span className="badge badge--danger">Crosses zero — dashed line is ₹0</span>
              )}
            </div>

            <p className="br__note">
              Assumptions, stated rather than hidden: each account&apos;s monthly credit
              ({inr(fc.monthlyCredit)} in total) lands on the 1st, because the data model carries no
              salary date; standing debits hit on their own day of the month; and{' '}
              {inr(monthlyExpenses)} of {profile ? 'declared' : 'estimated'} monthly expenses is spread
              evenly across each month&apos;s days, which is why the line slopes instead of stepping.
              {!profile && ' With no risk profile, that expense figure is 60% of the credited amount.'}
            </p>
          </>
        )}

        <hr className="sep" />

        {/* ----------------------------------------------------- goal planner */}
        <h3 className="br__h" id="br-goals">
          Goal planner
        </h3>

        {!profile && (
          <p className="empty">
            The planner needs a monthly surplus to answer &ldquo;can I afford this?&rdquo;, and that
            comes from your income, expenses and EMI load — none of which are known yet. Complete the{' '}
            <a href="#quiz">Risk Profile</a> quiz first. Goals still parse and save below; they are
            planned against a ₹0 surplus until then.
          </p>
        )}

        <form className="br__goalform" onSubmit={onPlan}>
          <div className="field">
            <label className="field__label" htmlFor="br-goal-input">
              Goal, in plain words
            </label>
            <input
              id="br-goal-input"
              name="goal"
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Save 5 Lakhs for a car by 2028"
              aria-describedby="br-goal-hint"
            />
            <p className="field__hint" id="br-goal-hint">
              Amounts as 5 Lakhs, 5L, ₹5,00,000, 50k or 2 crore. Deadlines as &ldquo;by 2028&rdquo;,
              &ldquo;by March 2027&rdquo;, &ldquo;in 18 months&rdquo; or &ldquo;by 31/12/2027&rdquo;.
            </p>
          </div>
          <div className="field br__ret">
            <label className="field__label" htmlFor="br-return">
              Assumed annual return %
            </label>
            <input
              id="br-return"
              name="annualReturn"
              type="number"
              min="0"
              max="30"
              step="0.5"
              value={annualReturnPct}
              onChange={(e) => setAnnualReturnPct(num(e.target.value))}
              aria-describedby="br-return-hint"
            />
            <p className="field__hint" id="br-return-hint">
              Your assumption, not a forecast. 0 gives the plain division.
            </p>
          </div>
          <button type="submit" className="btn btn--primary">
            Plan this goal
          </button>
        </form>

        <div className="br__echo" aria-live="polite">
          {!result && (
            <p className="empty">
              Type a goal and press <strong>Plan this goal</strong>. The reading is echoed back before
              any arithmetic, so you can see exactly what was understood.
            </p>
          )}

          {result && !result.ok && (
            <div className="stack">
              <span className="badge badge--danger">Could not read that</span>
              <p className="br__reason">{result.reason}</p>
            </div>
          )}

          {result && result.ok && (
            <div className="stack">
              <div className="row">
                <span className="badge badge--ok">Understood</span>
                <span className="tag">
                  {inr(result.targetAmount)} for {result.label} by {showDay(result.targetDate)} —{' '}
                  {result.plan.monthsLeft} months
                </span>
              </div>
              <div className="grid-2">
                <div className="stat">
                  <div className="stat__k">Plain division</div>
                  <div className="stat__v">{inr(result.plan.requiredMonthly)}</div>
                </div>
                <div className="stat">
                  <div className="stat__k">SIP at {annualReturnPct}%</div>
                  <div className="stat__v">{inr(result.plan.requiredMonthlyWithReturns)}</div>
                </div>
                <div className="stat">
                  <div className="stat__k">Your surplus</div>
                  <div className="stat__v">{inr(surplus)}</div>
                </div>
              </div>
              <div className="meter" role="img" aria-label={`Uses ${pct(result.plan.surplusUsedPct)} of the monthly surplus`}>
                <div
                  className="meter__fill"
                  style={{ width: `${Math.max(0, Math.min(100, result.plan.surplusUsedPct))}%` }}
                />
              </div>
              <p className="br__reason">
                <span className={`badge ${result.plan.feasible ? 'badge--ok' : 'badge--danger'}`}>
                  {result.plan.feasible ? 'Within surplus' : 'Over surplus'}
                </span>{' '}
                {result.plan.verdict}
              </p>
              <div className="row">
                <button type="button" className="btn btn--sm" onClick={keepGoal}>
                  Keep this goal
                </button>
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => setResult(null)}>
                  Discard
                </button>
              </div>
            </div>
          )}
        </div>

        {savedPlans.length > 0 && (
          <div className="br__goals">
            {savedPlans.map((g) => (
              <div className="br__goal" key={g.id}>
                <div className="br__goal-top">
                  <strong>{g.label}</strong>
                  <span className="tag">
                    {inr(g.targetAmount)} by {showDay(g.targetDate)}
                  </span>
                  <span className={`badge ${g.plan.feasible ? 'badge--ok' : 'badge--warn'}`}>
                    {g.plan.feasible ? 'On track' : `Short ${inr(g.plan.shortfall)}/month`}
                  </span>
                  <button
                    type="button"
                    className="btn btn--danger btn--sm"
                    onClick={() => setGoals((all) => (Array.isArray(all) ? all : []).filter((x) => x.id !== g.id))}
                  >
                    Remove
                  </button>
                </div>
                <div className="kv">
                  <span className="kv__k">
                    {g.plan.monthsLeft} months left · SIP at {annualReturnPct}%
                  </span>
                  <span className="kv__v">{inr(g.plan.requiredMonthlyWithReturns)} / month</span>
                </div>
                <p className="br__reason">{g.plan.verdict}</p>
              </div>
            ))}
          </div>
        )}

        <hr className="sep" />

        {/* ------------------------------------------- instrument suggestions */}
        <h3 className="br__h" id="br-inst">
          Instruments for this profile
        </h3>

        {!profile ? (
          <p className="empty">
            Instrument ranking depends on your risk mode, horizon, dependents and emergency fund.
            Complete the <a href="#quiz">Risk Profile</a> quiz to unlock it.
          </p>
        ) : (
          <>
            <div className="row br__slab">
              <div className="field">
                <label className="field__label" htmlFor="br-slab">
                  Your marginal income-tax slab
                </label>
                <select id="br-slab" value={slabRate} onChange={(e) => setSlabRate(num(e.target.value))}>
                  {SLABS.map((s) => (
                    <option key={s} value={s}>
                      {s}%
                    </option>
                  ))}
                </select>
                <p className="field__hint">
                  Entered by you, never inferred from income — slab boundaries change every Budget.
                </p>
              </div>
            </div>

            <div className="br__inst">
              {instruments.map((it) => (
                <div className="br__instrow" key={it.key}>
                  <div className="br__goal-top">
                    <strong>{it.name}</strong>
                    <span className="tag">{it.kind}</span>
                    <span className="badge badge--muted">{it.riskBand} risk</span>
                    <span className="badge">
                      {it.lockInYears === 0 ? 'No lock-in' : `${it.lockInYears}-year lock-in`}
                    </span>
                  </div>
                  <p className="br__reason">{it.reason}</p>
                  <p className="br__note">{it.taxNote}</p>
                </div>
              ))}
            </div>
            <p className="br__note">
              Ranked by {quiz.mode} mode against a {num(profile.horizonYears)}-year horizon,{' '}
              {num(profile.dependents)} dependent(s), {num(profile.emergencyMonths)} month(s) of
              emergency fund and a {slabRate}% slab. Anything whose lock-in runs past that horizon is
              dropped, not merely down-ranked. No interest rates are quoted: small-savings rates are
              notified quarterly and deposit rates are repriced at will, so a number hardcoded here
              would be wrong within a quarter.
            </p>
          </>
        )}

        <hr className="sep" />

        {/* ------------------------------------------------------- watchlist */}
        <h3 className="br__h" id="br-watch">
          Watchlist
        </h3>
        <p className="br__note">
          Derived on every render from the accounts, standing debits and profile above — the deck&apos;s
          &ldquo;autonomous monitoring&rdquo;, minus the claim that it runs while the app is shut.
          Background alerting needs a server, which Phase 1 does not have.
        </p>

        <div className="br__flags">
          {flags.map((f) => (
            <div className="br__flag" key={f.key}>
              <div className="br__goal-top">
                <strong>{f.title}</strong>
                <span className={`badge ${TONE[f.tone]}`}>{TONE_TEXT[f.tone]}</span>
              </div>
              <p className="br__reason">{f.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
