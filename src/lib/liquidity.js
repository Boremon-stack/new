// Intelligent Liquidity Buffer -- Module 1 of the pitch deck.
// Outflow tracking -> balance projection -> cash-crunch detection -> transfer advice.
//
// The failure this exists to catch is "Balance Blindness": funds sit in Account A
// while the EMI is scheduled against Account B, so a solvent user still bounces.
// Aggregate balance is therefore never the test -- per-account balance on the day is.
//
// Pure functions only: no Date.now(), no Math.random(), no I/O. Same inputs -> same output.
import { inr } from './inr.js'

const num = (v) => (Number.isFinite(+v) ? +v : 0)
const money = (v) => Math.round(num(v))
const ceil100 = (v) => Math.ceil(v / 100) * 100
const floor100 = (v) => Math.floor(v / 100) * 100

const DAY_MS = 86400000
const pad = (n) => String(n).padStart(2, '0')
const isoOf = (ms) => {
  const d = new Date(ms)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

/* `from` is an ISO date string or a Date. A bare YYYY-MM-DD is read digit-wise rather
   than through Date parsing, so the window never slides a day in a non-UTC timezone.
   An unparseable `from` falls back to the epoch -- deterministic, and callers pass a
   real date. Everything downstream runs in UTC. */
function parseFrom(from) {
  if (typeof from === 'string') {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(from.trim())
    if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3])
  }
  const d = from instanceof Date ? from : new Date(String(from ?? ''))
  const t = d.getTime()
  if (!Number.isFinite(t)) return Date.UTC(1970, 0, 1)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

const accountName = (a) => {
  const n = [a.institution, a.label].filter((s) => typeof s === 'string' && s.trim()).join(' ')
  return n || `Account ${String(a.id ?? '')}` || 'Unnamed account'
}

const NOT_LINKED = 'Not linked to any account'

/* ---------- the one engine every exported function reads from ---------- */

function simulate(accounts, obligations, options, repair) {
  const opts = options && typeof options === 'object' ? options : {}
  const rawDays = opts.days === undefined || opts.days === null ? 90 : num(opts.days)
  const days = Math.min(366, Math.max(1, Math.round(rawDays) || 90))
  const start = parseFrom(opts.from)
  const end = start + (days - 1) * DAY_MS

  // Only a BANK account holds spendable cash. An FD is principal locked to a maturity
  // date; it can never cover a debit, which is exactly what makes test 5 an unresolved
  // shortfall rather than a transfer.
  const seen = new Set()
  const banks = (Array.isArray(accounts) ? accounts : [])
    .filter((a) => a && typeof a === 'object' && a.kind === 'BANK')
    .map((a) => ({
      id: String(a.id ?? ''),
      name: accountName(a),
      opening: money(a.balance),
      credit: Math.max(0, money(a.meta && a.meta.monthlyCredit)),
    }))
    .filter((b) => b.id !== '' && !seen.has(b.id) && seen.add(b.id))

  const byId = new Map(banks.map((b) => [b.id, b]))

  const obs = (Array.isArray(obligations) ? obligations : [])
    .filter((o) => o && typeof o === 'object')
    .map((o) => ({
      id: String(o.id ?? ''),
      kind: String(o.kind ?? 'BILL'),
      label: String(o.label ?? 'Untitled obligation'),
      amount: Math.max(0, money(o.amount)),
      // The emitter caps dayOfMonth at 28 so every month including February has the day.
      dom: Math.min(28, Math.max(1, Math.round(num(o.dayOfMonth)) || 1)),
      accountId: String(o.accountId ?? ''),
    }))

  // Expand each monthly obligation across the window: walk the calendar months the
  // window touches and keep the occurrences that land inside it.
  const events = []
  const endD = new Date(end)
  const endY = endD.getUTCFullYear()
  const endM = endD.getUTCMonth() + 1
  const startD = new Date(start)
  for (const o of obs) {
    let y = startD.getUTCFullYear()
    let m = startD.getUTCMonth() + 1
    while (y < endY || (y === endY && m <= endM)) {
      const ms = Date.UTC(y, m - 1, o.dom)
      if (ms >= start && ms <= end) {
        const bank = byId.get(o.accountId)
        events.push({
          ms,
          date: isoOf(ms),
          obligationId: o.id,
          kind: o.kind,
          label: o.label,
          amount: o.amount,
          accountId: o.accountId,
          accountName: bank ? bank.name : NOT_LINKED,
        })
      }
      m += 1
      if (m > 12) {
        m = 1
        y += 1
      }
    }
  }
  events.sort((a, b) => a.ms - b.ms || (a.obligationId < b.obligationId ? -1 : a.obligationId > b.obligationId ? 1 : 0))

  const bal = new Map(banks.map((b) => [b.id, b.opening]))
  const minBal = new Map(banks.map((b) => [b.id, b.opening]))
  const minDate = new Map(banks.map((b) => [b.id, isoOf(start)]))
  const series = []
  const crunches = []
  const transfers = []
  const unresolved = []
  const unlinkedSeen = new Set()

  const donorsFor = (targetId) =>
    banks
      .filter((b) => b.id !== targetId && bal.get(b.id) > 0)
      .sort((a, b) => bal.get(b.id) - bal.get(a.id) || (a.id < b.id ? -1 : 1))

  function apply(ev) {
    const bank = byId.get(ev.accountId)
    if (!bank) {
      // Surfaced, never dropped: a debit pointed at nothing is a configuration hole,
      // and the whole amount is at risk. Reported once per obligation, not once per month.
      if (!unlinkedSeen.has(ev.obligationId)) {
        unlinkedSeen.add(ev.obligationId)
        unresolved.push({
          date: ev.date,
          accountId: ev.accountId,
          accountName: NOT_LINKED,
          obligationId: ev.obligationId,
          label: ev.label,
          amount: ev.amount,
          balanceBefore: 0,
          shortfall: ev.amount,
          reason: `${ev.label} debits ${inr(ev.amount)} on day ${Number(ev.date.slice(8))} of each month but is not attached to a linked bank account, so no balance can be checked against it and the whole amount is at risk. Pick the debiting account in the panel above.`,
        })
      }
      return
    }
    const before = bal.get(bank.id)
    if (ev.amount > 0 && ev.amount > before) {
      const shortfall = ev.amount - before
      let covered = false
      crunches.push({
        date: ev.date,
        accountId: bank.id,
        accountName: bank.name,
        obligationId: ev.obligationId,
        label: ev.label,
        amount: ev.amount,
        balanceBefore: before,
        shortfall,
      })
      if (repair) {
        // Round the ask up to the nearest 100 so the advice is a number a human
        // actually types into a transfer screen.
        const needed = ceil100(shortfall)
        const picks = []
        let left = needed
        for (const d of donorsFor(bank.id)) {
          if (left <= 0) break
          const take = Math.min(left, floor100(bal.get(d.id)))
          if (take > 0) {
            picks.push([d, take])
            left -= take
          }
        }
        if (left > 0) {
          unresolved.push({
            date: ev.date,
            accountId: bank.id,
            accountName: bank.name,
            obligationId: ev.obligationId,
            label: ev.label,
            amount: ev.amount,
            balanceBefore: before,
            shortfall,
            reason: `No linked bank account holds a spendable surplus on ${ev.date}, so ${inr(shortfall)} cannot be moved from anywhere. This is a genuine cash shortfall, not a transfer problem — money held in a fixed deposit is locked and does not count.`,
          })
        } else {
          covered = true
          for (const [d, take] of picks) {
            bal.set(d.id, bal.get(d.id) - take)
            bal.set(bank.id, bal.get(bank.id) + take)
            transfers.push({
              byDate: ev.date,
              fromAccountId: d.id,
              fromName: d.name,
              toAccountId: bank.id,
              toName: bank.name,
              amount: take,
              covers: [ev.obligationId],
              reason: `${ev.label} debits ${inr(ev.amount)} from ${bank.name} on ${ev.date}, which will hold ${inr(before)} — ${inr(shortfall)} short. ${d.name} has the cash.`,
            })
          }
        }
      }
      if (!covered) return
    }
    // A bounced mandate does not move money -- the bank returns it and charges a fee.
    // So the debit only lands once the balance (or a transfer) actually covers it;
    // deficits never compound across months, which would overstate every later shortfall.
    // ponytail: the return fee itself is not modelled, there being no rate for it in the
    // data model. Upgrade: a per-institution bounceCharge, debited here on a return.
    bal.set(bank.id, bal.get(bank.id) - ev.amount)
  }

  let ei = 0
  for (let i = 0; i < days; i += 1) {
    const ms = start + i * DAY_MS
    const date = isoOf(ms)
    // ponytail: salary is credited on day 1 of each month. The account model carries
    // meta.monthlyCredit but no date for it, so the 1st is an assumption, stated in the
    // UI. Upgrade: a `creditDay` field on the BANK account, credited on that day instead.
    if (new Date(ms).getUTCDate() === 1) {
      for (const b of banks) if (b.credit > 0) bal.set(b.id, bal.get(b.id) + b.credit)
    }
    while (ei < events.length && events[ei].ms <= ms) {
      apply(events[ei])
      ei += 1
    }
    const byAccount = {}
    let total = 0
    for (const b of banks) {
      const v = bal.get(b.id)
      byAccount[b.id] = v
      total += v
      if (v < minBal.get(b.id)) {
        minBal.set(b.id, v)
        minDate.set(b.id, date)
      }
    }
    series.push({ date, byAccount, total })
  }

  return {
    from: isoOf(start),
    to: isoOf(end),
    days,
    events,
    totalOutflow: events.reduce((s, e) => s + e.amount, 0),
    series,
    accounts: banks.map((b) => ({
      id: b.id,
      name: b.name,
      opening: b.opening,
      closing: bal.get(b.id),
      minBalance: minBal.get(b.id),
      minDate: minDate.get(b.id),
    })),
    crunches,
    transfers,
    unresolved,
  }
}

/* ---------- the four public views ---------- */

// Master calendar of every recurring debit in the window, sorted by date.
export function buildCalendar(accounts, obligations, options) {
  const s = simulate(accounts, obligations, options, false)
  return {
    from: s.from,
    to: s.to,
    days: s.days,
    events: s.events.map((e) => ({
      date: e.date,
      obligationId: e.obligationId,
      kind: e.kind,
      label: e.label,
      amount: e.amount,
      accountId: e.accountId,
      accountName: e.accountName,
    })),
    totalOutflow: s.totalOutflow,
  }
}

// Day-by-day balance per BANK account: opening balance, monthly credit in, debits out.
export function projectBalances(accounts, obligations, options) {
  const s = simulate(accounts, obligations, options, false)
  return { series: s.series, accounts: s.accounts }
}

// A crunch is a debit that exceeds its own account's projected balance -- the bounce.
export function findCrunches(accounts, obligations, options) {
  const { crunches } = simulate(accounts, obligations, options, false)
  const worst = crunches.reduce((w, c) => (w && w.shortfall >= c.shortfall ? w : c), null)
  return { crunches, worst }
}

/**
 * One pass, one world.
 *
 * `findCrunches` and `suggestTransfers` answer deliberately different questions --
 * "what breaks if you do nothing" versus "what to move if you act" -- and their
 * figures legitimately differ, because a transfer made in October changes what
 * November opens with. Read from separate passes they are both right; rendered on
 * the same alert they contradict each other, which is how the UI came to print
 * "short by Rs 25,900" directly above "move Rs 34,500".
 *
 * The component takes every figure it displays from this one repaired pass, so the
 * numbers on screen always describe the same scenario: the one where the user
 * follows the advice.
 */
export function liquidityPlan(accounts, obligations, options) {
  const s = simulate(accounts, obligations, options, true)
  const worst = s.crunches.reduce((w, c) => (w && w.shortfall >= c.shortfall ? w : c), null)
  return {
    from: s.from,
    to: s.to,
    days: s.days,
    events: s.events,
    totalOutflow: s.totalOutflow,
    series: s.series,
    accounts: s.accounts,
    crunches: s.crunches,
    worst,
    transfers: s.transfers,
    unresolved: s.unresolved,
  }
}

// For each crunch, the exact intra-account move that prevents it.
export function suggestTransfers(accounts, obligations, options) {
  const s = simulate(accounts, obligations, options, true)
  return { transfers: s.transfers, unresolved: s.unresolved }
}
