// Self-check for the Intelligent Liquidity Buffer: node --test src/lib/liquidity.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildCalendar, projectBalances, findCrunches, suggestTransfers } from './liquidity.js'

// 2026 is not a leap year: 01-01 + 90 days inclusive lands exactly on 03-31.
const FROM = '2026-01-01'
const W = { from: FROM, days: 90 }

const bank = (id, institution, balance, monthlyCredit = 0) => ({
  id,
  kind: 'BANK',
  institution,
  label: `XXXX XXXX ${id.slice(-4)}`,
  balance,
  linkedAt: '2026-01-01T00:00:00.000Z',
  meta: { accountType: 'Savings', ifsc: 'HDFC0000523', monthlyCredit },
})

const fd = (id, institution, principal) => ({
  id,
  kind: 'FD',
  institution,
  label: `FD-XXXX-${id.slice(-4)}`,
  balance: principal,
  linkedAt: '2026-01-01T00:00:00.000Z',
  meta: { principal, rate: 7.1, tenureMonths: 24, maturityOn: '2028-01-01T00:00:00.000Z', maturityValue: 517000 },
})

const ob = (id, kind, label, amount, dayOfMonth, accountId) => ({
  id,
  kind,
  label,
  amount,
  dayOfMonth,
  accountId,
  addedAt: '2026-01-01T00:00:00.000Z',
})

// Walk any returned structure and fail on the first non-finite number.
function assertAllFinite(value, path = 'root') {
  if (typeof value === 'number') {
    assert.ok(Number.isFinite(value), `${path} is not finite: ${value}`)
    return
  }
  if (typeof value === 'string') {
    assert.ok(!/NaN|Infinity|undefined/.test(value), `${path} leaked a bad number: ${value}`)
    return
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertAllFinite(v, `${path}[${i}]`))
    return
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) assertAllFinite(v, `${path}.${k}`)
  }
}

test('calendar: a monthly obligation expands across the window, sorted, all in range', () => {
  const accounts = [bank('BANK-1', 'HDFC Bank', 180000)]
  const cal = buildCalendar(accounts, [ob('o1', 'EMI', 'Home loan EMI', 24500, 15, 'BANK-1')], W)

  assert.equal(cal.from, '2026-01-01')
  assert.equal(cal.to, '2026-03-31')
  assert.equal(cal.days, 90)
  assert.equal(cal.events.length, 3, 'three monthly occurrences in a 90-day window')
  assert.deepEqual(
    cal.events.map((e) => e.date),
    ['2026-01-15', '2026-02-15', '2026-03-15'],
  )
  assert.equal(cal.totalOutflow, 24500 * 3)
  for (const e of cal.events) {
    assert.ok(e.date >= cal.from && e.date <= cal.to, `${e.date} outside window`)
    assert.equal(e.accountName, 'HDFC Bank XXXX XXXX NK-1')
  }
  const dates = cal.events.map((e) => e.date)
  assert.deepEqual(dates, [...dates].sort(), 'events must be sorted ascending')

  // 30 and 60 day horizons clip the same obligation to one and two occurrences.
  assert.equal(buildCalendar(accounts, [ob('o1', 'EMI', 'E', 1, 15, 'BANK-1')], { from: FROM, days: 30 }).events.length, 1)
  assert.equal(buildCalendar(accounts, [ob('o1', 'EMI', 'E', 1, 15, 'BANK-1')], { from: FROM, days: 60 }).events.length, 2)
})

test('day 28 lands in February too -- that is why the cap is 28', () => {
  const cal = buildCalendar(
    [bank('BANK-1', 'HDFC Bank', 500000)],
    [ob('o1', 'SIP', 'Index fund SIP', 10000, 28, 'BANK-1')],
    W,
  )
  assert.deepEqual(
    cal.events.map((e) => e.date),
    ['2026-01-28', '2026-02-28', '2026-03-28'],
  )
  // Out-of-range days are clamped into 1..28 rather than producing a phantom date.
  const clamped = buildCalendar(
    [bank('BANK-1', 'HDFC Bank', 500000)],
    [ob('o2', 'BILL', 'Junk day', 500, 31, 'BANK-1'), ob('o3', 'BILL', 'NaN day', 500, Number.NaN, 'BANK-1')],
    W,
  )
  for (const e of clamped.events) {
    const dom = Number(e.date.slice(8))
    assert.ok(dom >= 1 && dom <= 28, `dayOfMonth escaped the cap: ${e.date}`)
  }
})

test('projectBalances is deterministic and every numeric leaf is finite', () => {
  const spreads = [
    [[bank('B1', 'HDFC Bank', 184500, 92000)], [ob('o1', 'EMI', 'Car EMI', 18400, 5, 'B1')]],
    [
      [bank('B1', 'HDFC Bank', 12000, 0), bank('B2', 'ICICI Bank', 0, 45000), fd('F1', 'SBI', 250000)],
      [ob('o1', 'RENT', 'Rent', 32000, 1, 'B2'), ob('o2', 'PREMIUM', 'Term cover', 2100, 22, 'B1')],
    ],
    // Hostile input: junk numbers, missing fields, an account id that matches nothing.
    [
      [bank('B1', 'Axis Bank', Number.NaN, undefined), { id: 'X', kind: 'BANK' }, null],
      [ob('o1', 'BILL', 'Broken', 'abc', 0, 'ghost'), { id: 'o2' }, undefined],
    ],
    [[], []],
  ]

  for (const [accounts, obligations] of spreads) {
    const a = projectBalances(accounts, obligations, W)
    const b = projectBalances(accounts, obligations, W)
    assert.deepEqual(a, b, 'two identical calls must deep-equal')
    assertAllFinite(a)
    assertAllFinite(buildCalendar(accounts, obligations, W))
    assertAllFinite(findCrunches(accounts, obligations, W))
    assertAllFinite(suggestTransfers(accounts, obligations, W))
  }

  const p = projectBalances(spreads[1][0], spreads[1][1], W)
  assert.equal(p.series.length, 90, 'one series point per day')
  assert.equal(p.accounts.length, 2, 'FD accounts are not projected as spendable')
  assert.ok(p.accounts.every((a) => a.id !== 'F1'))
})

test('Balance Blindness: funded account A, empty account B, debit scheduled on B', () => {
  const accounts = [bank('HDFC-1', 'HDFC Bank', 200000), bank('ICICI-2', 'ICICI Bank', 1000)]
  const obligations = [ob('emi', 'EMI', 'Home loan EMI', 25000, 5, 'ICICI-2')]

  const totalCash = 201000
  const totalDebits = 25000 * 3
  assert.ok(totalCash > totalDebits, 'the user is solvent in aggregate -- that is the whole point')

  const { crunches, worst } = findCrunches(accounts, obligations, W)
  assert.equal(crunches.length, 3, 'every occurrence bounces against the empty account')
  assert.equal(crunches[0].accountId, 'ICICI-2')
  assert.equal(crunches[0].date, '2026-01-05')
  assert.equal(crunches[0].balanceBefore, 1000)
  assert.equal(crunches[0].shortfall, 24000)
  assert.equal(worst.shortfall, 24000, 'a bounce does not debit, so misses do not compound')
  assert.ok(
    projectBalances(accounts, obligations, W).accounts.every((a) => a.minBalance >= 0),
    'an unfunded mandate is returned, not overdrawn',
  )

  const { transfers, unresolved } = suggestTransfers(accounts, obligations, W)
  assert.equal(unresolved.length, 0)
  assert.equal(transfers.length, 3)
  assert.equal(transfers[0].fromAccountId, 'HDFC-1')
  assert.equal(transfers[0].toAccountId, 'ICICI-2')
  assert.equal(transfers[0].amount, 24000)
  assert.deepEqual(transfers[0].covers, ['emi'])
  assert.equal(transfers[0].byDate, '2026-01-05')
})

test('an FD surplus never covers a debit -- that is an unresolved shortfall', () => {
  const accounts = [fd('SBI-FD', 'State Bank of India', 200000), bank('ICICI-2', 'ICICI Bank', 1000)]
  const obligations = [ob('emi', 'EMI', 'Home loan EMI', 25000, 5, 'ICICI-2')]

  const { crunches } = findCrunches(accounts, obligations, W)
  assert.equal(crunches.length, 3)

  const { transfers, unresolved } = suggestTransfers(accounts, obligations, W)
  assert.equal(transfers.length, 0, 'locked principal is not a funding source')
  assert.equal(unresolved.length, 3)
  assert.equal(unresolved[0].accountId, 'ICICI-2')
  assert.equal(unresolved[0].shortfall, 24000)
  assert.match(unresolved[0].reason, /fixed deposit/i)
})

test('an obligation pointing at no account is surfaced, not dropped', () => {
  const accounts = [bank('HDFC-1', 'HDFC Bank', 200000)]
  const obligations = [ob('ghost', 'SIP', 'Orphan SIP', 5000, 10, 'nope-9'), ob('blank', 'BILL', 'No account', 900, 12, '')]

  const cal = buildCalendar(accounts, obligations, W)
  assert.equal(cal.events.length, 6, 'orphan debits still appear on the calendar')
  assert.ok(cal.events.every((e) => e.accountName === 'Not linked to any account'))

  const { unresolved } = suggestTransfers(accounts, obligations, W)
  const ids = unresolved.map((u) => u.obligationId)
  assert.ok(ids.includes('ghost') && ids.includes('blank'), 'both orphans reported')
  assert.equal(unresolved.length, 2, 'reported once per obligation, not once per month')
  assert.equal(unresolved[0].shortfall, 5000, 'the whole amount is at risk, not a partial gap')
})

test('empty inputs return empty structures without throwing', () => {
  for (const [a, o] of [[[], []], [null, null], [undefined, undefined], [[bank('B', 'HDFC Bank', 5000)], []], [[], [ob('x', 'EMI', 'E', 100, 3, 'B')]]]) {
    const cal = buildCalendar(a, o, W)
    assert.equal(cal.totalOutflow, cal.events.reduce((s, e) => s + e.amount, 0))
    const { crunches, worst } = findCrunches(a, o, W)
    const { transfers } = suggestTransfers(a, o, W)
    if (!Array.isArray(a) || a.length === 0) {
      assert.deepEqual(projectBalances(a, o, W).accounts, [])
      assert.equal(crunches.length, 0)
      assert.equal(worst, null)
      assert.equal(transfers.length, 0)
    }
    assertAllFinite(projectBalances(a, o, W))
  }
  // Default horizon is 90 days when none is given.
  assert.equal(buildCalendar([], [], { from: FROM }).days, 90)
  assert.equal(buildCalendar([], [], { from: FROM }).to, '2026-03-31')
})

test('transfers are positive, rounded to 100, and cover their shortfall', () => {
  const accounts = [
    bank('A', 'HDFC Bank', 143761, 0),
    bank('B', 'ICICI Bank', 237, 0),
    bank('C', 'Axis Bank', 4111, 0),
    fd('F', 'SBI', 900000),
  ]
  const obligations = [
    ob('o1', 'EMI', 'Car EMI', 18437, 4, 'B'),
    ob('o2', 'SIP', 'Index SIP', 7333, 11, 'C'),
    ob('o3', 'PREMIUM', 'Term premium', 2189, 19, 'B'),
  ]

  const { crunches } = findCrunches(accounts, obligations, W)
  const { transfers, unresolved } = suggestTransfers(accounts, obligations, W)
  assert.ok(crunches.length > 0, 'the fixture must actually crunch')
  assert.equal(unresolved.length, 0)

  for (const t of transfers) {
    assert.ok(t.amount > 0, `transfer not positive: ${t.amount}`)
    assert.equal(t.amount % 100, 0, `transfer not rounded to 100: ${t.amount}`)
    assert.notEqual(t.fromAccountId, t.toAccountId)
    assert.notEqual(t.fromAccountId, 'F', 'an FD is never a source')
  }

  // Each crunch is cleared by the transfers landing on its date for its obligation.
  // A repaired account is drained to the rupee by earlier debits, so its gap can only be
  // wider than the unrepaired one -- the advice therefore always over-covers, never under.
  for (const c of crunches) {
    const covering = transfers.filter((t) => t.byDate === c.date && t.covers.includes(c.obligationId))
    assert.ok(covering.length > 0, `${c.label} on ${c.date} got no transfer`)
    const moved = covering.reduce((s, t) => s + t.amount, 0)
    assert.ok(moved >= c.shortfall, `${c.label} on ${c.date}: moved ${moved} < shortfall ${c.shortfall}`)
    assert.equal(moved % 100, 0, `${c.label} on ${c.date}: combined move ${moved} not rounded to 100`)
  }
})
