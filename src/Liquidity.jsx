import { useMemo, useState } from 'react'
import { inr } from './lib/inr.js'
import { liquidityPlan } from './lib/liquidity.js'
import './Liquidity.css'

const HORIZONS = [30, 60, 90]

const pad = (n) => String(n).padStart(2, '0')

// The window starts today. Built from local parts so the first day is the user's today,
// not UTC's; everything after this is pure and lives in lib/liquidity.js.
function todayISO() {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const at = (iso) => new Date(`${iso}T00:00:00Z`)
const day = (iso) => at(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', timeZone: 'UTC' })
const dayYear = (iso) =>
  at(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })
const monthLabel = (iso) => at(iso).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' })

/* Balance trajectory, one account per sparkline. No chart library: a polyline and a
   dashed zero baseline is the whole requirement. The baseline is dashed rather than
   coloured so "below zero" survives greyscale, and the figure is repeated as text. */
function Spark({ account, values }) {
  const W = 320
  const H = 54
  if (values.length === 0) return null
  const lo = Math.min(0, ...values)
  const hi = Math.max(lo + 1, ...values)
  const span = hi - lo
  const y = (v) => H - ((v - lo) / span) * H
  const step = values.length > 1 ? W / (values.length - 1) : 0
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${(i * step).toFixed(1)} ${y(v).toFixed(1)}`).join(' ')
  const below = account.minBalance < 0

  return (
    <svg
      className="lq__spark"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`${account.name}: opening balance ${inr(account.opening)}, lowest projected balance ${inr(
        account.minBalance,
      )} on ${dayYear(account.minDate)}, closing ${inr(account.closing)}.`}
    >
      <line
        x1="0"
        x2={W}
        y1={y(0).toFixed(1)}
        y2={y(0).toFixed(1)}
        stroke="var(--ink-3)"
        strokeWidth="1"
        strokeDasharray="4 4"
        vectorEffect="non-scaling-stroke"
      />
      <path
        d={d}
        fill="none"
        stroke={below ? 'var(--danger)' : 'var(--accent)'}
        strokeWidth="1.5"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}

export default function Liquidity({ accounts, obligations }) {
  const [days, setDays] = useState(90)
  const list = useMemo(
    () => (Array.isArray(accounts) ? accounts : []).filter((a) => a && typeof a === 'object'),
    [accounts],
  )
  const debits = useMemo(
    () => (Array.isArray(obligations) ? obligations : []).filter((o) => o && typeof o === 'object'),
    [obligations],
  )
  const from = useMemo(() => todayISO(), [])

  const banks = list.filter((a) => a.kind === 'BANK')
  const lockedFd = list
    .filter((a) => a.kind === 'FD')
    .reduce((s, a) => s + (Number.isFinite(+a.balance) ? +a.balance : 0), 0)

  const view = useMemo(() => {
    // Every figure below comes from ONE simulation pass. Reading the crunches from
    // an un-repaired pass and the transfers from a repaired one made the alert print
    // a shortfall and a transfer amount that described different months.
    const plan = liquidityPlan(list, debits, { from, days })
    const calendar = plan
    const projection = plan
    const { crunches, worst, transfers, unresolved } = plan
    const alerts = crunches
      .map((c) => ({
        ...c,
        moves: transfers.filter((t) => t.byDate === c.date && t.covers.includes(c.obligationId)),
      }))
      .filter((a) => a.moves.length > 0)

    // One tbody per month, so the calendar reads as a calendar and not a flat ledger.
    const months = []
    for (const e of calendar.events) {
      const key = e.date.slice(0, 7)
      const last = months[months.length - 1]
      if (last && last.key === key) last.rows.push(e)
      else months.push({ key, label: monthLabel(e.date), rows: [e] })
    }
    for (const m of months) m.total = m.rows.reduce((s, r) => s + r.amount, 0)

    const lowest = projection.accounts.reduce((w, a) => (w && w.minBalance <= a.minBalance ? w : a), null)
    return { calendar, projection, crunches, worst, unresolved, alerts, months, lowest }
  }, [list, debits, from, days])

  const { calendar, projection, crunches, unresolved, alerts, months, lowest } = view

  const horizonControl = (
    <div className="lq__horizon" role="group" aria-label="Projection horizon">
      {HORIZONS.map((d) => (
        <button
          key={d}
          type="button"
          className={`btn btn--sm${d === days ? ' btn--primary' : ''}`}
          aria-pressed={d === days}
          onClick={() => setDays(d)}
        >
          {d} days
        </button>
      ))}
    </div>
  )

  // Nothing is invented from an empty portfolio: say which half is missing and where it lives.
  if (banks.length === 0 || debits.length === 0) {
    const missing =
      banks.length === 0 && debits.length === 0
        ? 'No bank account is linked and no recurring debit has been added yet.'
        : banks.length === 0
          ? 'No bank account is linked. Fixed deposits are locked principal and hold no spendable cash, so there is no balance to project against.'
          : 'No recurring debit has been added yet, so there is no outflow calendar to build.'
    const where =
      banks.length === 0
        ? 'Link a savings or current account in the Connections panel above.'
        : 'Add your EMIs, SIPs, premiums, rent and bills in the Portfolio panel above.'

    return (
      <section className="panel" id="liquidity" aria-labelledby="lq-title">
        <div className="panel__head">
          <div>
            <h2 className="panel__title" id="lq-title">
              Intelligent Liquidity Buffer
              <span className="badge badge--muted">Locked</span>
            </h2>
            <p className="panel__sub">
              Maps every recurring debit onto one calendar, projects each account forward day by day,
              and names the transfer that prevents a bounce.
            </p>
          </div>
        </div>
        <div className="panel__body">
          <p className="empty">
            {missing}
            <br />
            {where}
          </p>
        </div>
      </section>
    )
  }

  return (
    <section className="panel" id="liquidity" aria-labelledby="lq-title">
      <div className="panel__head">
        <div>
          <h2 className="panel__title" id="lq-title">
            Intelligent Liquidity Buffer
            {crunches.length > 0 || unresolved.length > 0 ? (
              <span className="badge badge--danger">
                {crunches.length + unresolved.length} alert{crunches.length + unresolved.length === 1 ? '' : 's'}
              </span>
            ) : (
              <span className="badge badge--ok">No bounce predicted</span>
            )}
          </h2>
          <p className="panel__sub">
            {banks.length} bank account(s) and {debits.length} recurring debit(s), projected from{' '}
            {dayYear(calendar.from)} to {dayYear(calendar.to)}. A debit is checked against{' '}
            <strong>its own account</strong> on its own date — money sitting in another account does
            not stop a bounce.
          </p>
        </div>
        <div className="panel__actions">{horizonControl}</div>
      </div>

      <div className="panel__body">
        <div className="grid-2">
          <div className="stat">
            <div className="stat__k">Outflow over {days} days</div>
            <div className="stat__v">{inr(calendar.totalOutflow)}</div>
            <p className="lq__statnote">{calendar.events.length} scheduled debits</p>
          </div>
          <div className="stat">
            <div className="stat__k">Predicted bounces</div>
            <div className="stat__v">{crunches.length + unresolved.length}</div>
            <p className="lq__statnote">
              {crunches.length + unresolved.length === 0
                ? 'Every debit is covered on its date.'
                : `${alerts.length} fixable by transfer, ${unresolved.length} not`}
            </p>
          </div>
          <div className="stat">
            <div className="stat__k">Lowest projected balance</div>
            <div className="stat__v">{inr(lowest ? lowest.minBalance : 0)}</div>
            <p className="lq__statnote">
              {lowest ? `${lowest.name} on ${dayYear(lowest.minDate)}` : 'No bank account projected'}
            </p>
          </div>
          <div className="stat">
            <div className="stat__k">Locked in fixed deposits</div>
            <div className="stat__v">{inr(lockedFd)}</div>
            <p className="lq__statnote">Not liquid — never counted towards covering a debit.</p>
          </div>
        </div>

        <p className="lq__assume">
          Salary and other monthly credits are assumed to land on the <strong>1st of each month</strong>.
          Linked accounts record a monthly credit amount but no credit date, so the 1st is an
          assumption, not your data. A debit dated before your real pay day will read as a crunch here.
        </p>

        <hr className="sep" />

        {/* Alerts first: the bounce and its fix are the point of the module. */}
        <h3 className="lq__h">Smart alerts</h3>
        <div className="lq__alerts" aria-live="polite">
          {crunches.length === 0 && unresolved.length === 0 && (
            <p className="empty">
              No cash-crunch in the next {days} days. Every scheduled debit is covered by the balance
              in its own account on its own date.
            </p>
          )}

          {unresolved.map((u) => (
            <div className="lq__alert lq__alert--critical" key={`u-${u.obligationId}-${u.date}`}>
              <div className="lq__alert-top">
                <span className="badge badge--danger">Cannot be fixed by a transfer</span>
                <span className="tag">{day(u.date)}</span>
              </div>
              <p className="lq__alert-line">
                <strong>{u.label}</strong> — {inr(u.amount)} due {dayYear(u.date)} on {u.accountName}, short
                by <strong>{inr(u.shortfall)}</strong>.
              </p>
              <p className="lq__alert-why">{u.reason}</p>
            </div>
          ))}

          {alerts.map((a) => (
            <div className="lq__alert" key={`c-${a.obligationId}-${a.date}`}>
              <div className="lq__alert-top">
                <span className="badge badge--warn">Bounce predicted</span>
                <span className="tag">{day(a.date)}</span>
              </div>
              <p className="lq__alert-line">
                <strong>{a.label}</strong> — {inr(a.amount)} debits {a.accountName} on {dayYear(a.date)},
                which will hold {inr(a.balanceBefore)}. Short by <strong>{inr(a.shortfall)}</strong>.
              </p>
              {a.moves.map((t, i) => (
                <p className="lq__alert-fix" key={`${t.fromAccountId}-${i}`}>
                  Move <strong>{inr(t.amount)}</strong> from {t.fromName} to {t.toName} before{' '}
                  {day(t.byDate)}.
                </p>
              ))}
            </div>
          ))}
        </div>

        <hr className="sep" />

        {/* Calendar second: the full outflow map the alerts were read off. */}
        <h3 className="lq__h">Master outflow calendar</h3>
        <div className="lq__tablewrap">
          <table className="lq__table">
            <caption>
              Every recurring debit from {dayYear(calendar.from)} to {dayYear(calendar.to)}, grouped by
              month — {calendar.events.length} debits totalling {inr(calendar.totalOutflow)}.
            </caption>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Type</th>
                <th scope="col">Obligation</th>
                <th scope="col">Debits from</th>
                <th scope="col" className="lq__num">
                  Amount
                </th>
              </tr>
            </thead>
            {months.map((m) => (
              <tbody key={m.key}>
                <tr className="lq__monthrow">
                  <th scope="colgroup" colSpan={5}>
                    {m.label} — {inr(m.total)} across {m.rows.length} debit{m.rows.length === 1 ? '' : 's'}
                  </th>
                </tr>
                {m.rows.map((e, i) => (
                  <tr key={`${e.obligationId}-${e.date}-${i}`}>
                    <td className="lq__num">{day(e.date)}</td>
                    <td>
                      <span className="tag">{e.kind}</span>
                    </td>
                    <th scope="row">{e.label}</th>
                    <td>{e.accountName}</td>
                    <td className="lq__num">{inr(e.amount)}</td>
                  </tr>
                ))}
              </tbody>
            ))}
            <tfoot>
              <tr>
                <th scope="row" colSpan={4}>
                  Total outflow over {days} days
                </th>
                <td className="lq__num">{inr(calendar.totalOutflow)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        <hr className="sep" />

        <h3 className="lq__h">Balance trajectory per account</h3>
        <div className="lq__tracks">
          {projection.accounts.map((a) => (
            <div className="lq__track" key={a.id}>
              <div className="lq__track-top">
                <span className="lq__track-name">{a.name}</span>
                <span className="lq__track-figure">
                  {inr(a.opening)} → {inr(a.closing)}
                </span>
              </div>
              <Spark account={a} values={projection.series.map((s) => s.byAccount[a.id] ?? 0)} />
              <p className="lq__track-note">
                Lowest {inr(a.minBalance)} on {dayYear(a.minDate)}
                {a.minBalance < 0 ? ' — below zero, the dashed line is ₹0.' : '. Dashed line is ₹0.'}
              </p>
            </div>
          ))}
        </div>

        <p className="lq__foot">
          Balances, credits and debits are projected from your linked accounts and the obligations you
          entered; FinNexus makes no live bank connection, so no real transfer is initiated. Phase 2
          replaces the projection input with RBI Account Aggregator balance feeds.
        </p>
      </div>
    </section>
  )
}
