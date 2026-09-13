// Self-check for the Financial Brain engine: node --test src/lib/forecast.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { forecastBalance, parseGoal, planGoal, suggestInstruments, INSTRUMENTS } from './forecast.js'

const NOW = '2026-09-14'

const ACCOUNTS = [
  {
    id: 'acc-1',
    kind: 'BANK',
    institution: 'HDFC Bank',
    label: 'XXXX XXXX 4821',
    balance: 184500,
    linkedAt: '2026-09-01T00:00:00.000Z',
    meta: { accountType: 'Salary', ifsc: 'HDFC0001234', monthlyCredit: 95000 },
  },
  {
    id: 'acc-2',
    kind: 'FD',
    institution: 'SBI',
    label: 'XXXX 9032',
    balance: 500000,
    linkedAt: '2026-09-02T00:00:00.000Z',
    meta: { principal: 450000, rate: 7.1, tenureMonths: 24 },
  },
]

const OBLIGATIONS = [
  { id: 'o-1', kind: 'EMI', label: 'Home loan', amount: 32000, dayOfMonth: 5, accountId: 'acc-1', addedAt: NOW },
  { id: 'o-2', kind: 'SIP', label: 'Index SIP', amount: 10000, dayOfMonth: 2, accountId: 'acc-1', addedAt: NOW },
  { id: 'o-3', kind: 'RENT', label: 'Rent', amount: 24000, dayOfMonth: 28, accountId: 'acc-1', addedAt: NOW },
]

const PROFILE = {
  monthlyIncome: 95000,
  monthlyExpenses: 52000,
  emiLoad: 32000,
  dependents: 0,
  emergencyMonths: 4.5,
  horizonYears: 20,
}

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

/* ------------------------------------------------------------- 1. amounts */

test('parseGoal reads the whole Indian amount vocabulary', () => {
  const cases = [
    ['Save 5 Lakhs for a car by 2028', 500000],
    ['Save 5 lakh for a car by 2028', 500000],
    ['Save 5L for a car by 2028', 500000],
    ['Save ₹5,00,000 for a car by 2028', 500000],
    ['Save 500000 for a car by 2028', 500000],
    ['Save 50k for a phone by 2028', 50000],
    ['Save 2 crore for retirement by 2045', 20000000],
    ['Save 2Cr for retirement by 2045', 20000000],
    ['Save 1.5 lakhs for a laptop by 2028', 150000],
    ['Save 1.5L for a laptop by 2028', 150000],
    ['Save Rs 75,000 for a trip by 2028', 75000],
  ]
  for (const [text, expected] of cases) {
    const g = parseGoal(text, { now: NOW })
    assert.equal(g.ok, true, `${text} -> ${g.reason ?? ''}`)
    assert.equal(g.targetAmount, expected, text)
    assert.ok(Number.isInteger(g.targetAmount), `${text} must land on whole rupees`)
  }
})

/* --------------------------------------------------------------- 2. dates */

test('parseGoal reads the whole date vocabulary against a fixed now', () => {
  const cases = [
    ['Save 5L by 2028', '2028-12-31'],
    ['Save 5L by March 2027', '2027-03-31'],
    ['Save 5L by Mar 2027', '2027-03-31'],
    ['Save 5L by February 2028', '2028-02-29'], // leap year, last day of the month
    ['Save 5L in 3 years', '2029-09-14'],
    ['Save 5L in 18 months', '2028-03-14'],
    ['Save 5L by 31/12/2027', '2027-12-31'],
    ['Save 5L by 31-12-2027', '2027-12-31'],
  ]
  for (const [text, expected] of cases) {
    const g = parseGoal(text, { now: NOW })
    assert.equal(g.ok, true, `${text} -> ${g.reason ?? ''}`)
    assert.equal(g.targetDate, expected, text)
  }
  // "in 18 months" must be exactly 18 months of horizon, not 17 or 19.
  assert.equal(parseGoal('Save 5L in 18 months', { now: NOW }).horizonMonths, 18)
  assert.equal(parseGoal('Save 5L in 3 years', { now: NOW }).horizonMonths, 36)
})

/* ------------------------------------------------------- 3. the deck's line */

test("the deck's own example parses end to end", () => {
  const g = parseGoal('Save 5 Lakhs for a car by 2028', { now: NOW })
  assert.equal(g.ok, true, g.reason)
  assert.equal(g.targetAmount, 500000)
  assert.equal(g.targetDate, '2028-12-31')
  assert.equal(g.horizonMonths, 27)
  assert.match(g.label, /car/i)
  assert.ok(g.label.length <= 60, `label is a phrase, not a sentence: ${g.label}`)
  assert.equal(g.raw, 'Save 5 Lakhs for a car by 2028')
  assertAllFinite(g, 'goal')
})

/* --------------------------------------------------------- 4. graceful nos */

test('unparseable text and past dates are refused with a reason, never a throw', () => {
  const bad = [
    'hello there',
    'buy a house someday',
    '',
    '   ',
    null,
    undefined,
    42,
    'save money',
    'by 2028',
  ]
  for (const text of bad) {
    const g = parseGoal(text, { now: NOW })
    assert.equal(g.ok, false, `${String(text)} should not parse`)
    assert.equal(typeof g.reason, 'string')
    assert.ok(g.reason.length > 10, `reason must be readable: ${g.reason}`)
  }

  const past = parseGoal('Save 5 Lakhs for a car by 2020', { now: NOW })
  assert.equal(past.ok, false)
  assert.match(past.reason, /not in the future|passed/i)

  const alsoPast = parseGoal('Save 5L by 01/01/2001', { now: NOW })
  assert.equal(alsoPast.ok, false)
  assert.match(alsoPast.reason, /not in the future|passed/i)

  // An amount with no deadline names the amount it did understand.
  const noDate = parseGoal('Save 5 Lakhs for a car', { now: NOW })
  assert.equal(noDate.ok, false)
  assert.match(noDate.reason, /deadline/i)
})

/* -------------------------------------------------------- 5. plan arithmetic */

test('planGoal: plain division at 0%, annuity below it at a positive rate', () => {
  const goal = parseGoal('Save 5 Lakhs for a car by 2028', { now: NOW })
  assert.equal(goal.ok, true)

  const flat = planGoal(goal, { monthlySurplus: 30000, annualReturnPct: 0, now: NOW })
  assert.equal(flat.monthsLeft, 27)
  assert.equal(flat.targetAmount, 500000)
  assert.equal(flat.requiredMonthly, 500000 / 27)
  assert.equal(flat.requiredMonthlyWithReturns, flat.requiredMonthly, '0% must fall back to plain division')
  assert.equal(flat.feasible, true)
  assert.equal(flat.shortfall, 0)

  const grown = planGoal(goal, { monthlySurplus: 30000, annualReturnPct: 12, now: NOW })
  assert.equal(grown.requiredMonthly, 500000 / 27)
  assert.ok(
    grown.requiredMonthlyWithReturns < grown.requiredMonthly,
    `returns must lower the instalment: ${grown.requiredMonthlyWithReturns} vs ${grown.requiredMonthly}`,
  )
  // Sanity-check the annuity against the closed form, independently computed.
  const r = 0.12 / 12
  const expected = (500000 * r) / (Math.pow(1 + r, 27) - 1)
  assert.ok(Math.abs(grown.requiredMonthlyWithReturns - expected) < 1e-6)

  // feasible flips around the surplus: 500000/27 = 18518.5...
  assert.equal(planGoal(goal, { monthlySurplus: 18000, annualReturnPct: 0, now: NOW }).feasible, false)
  assert.equal(planGoal(goal, { monthlySurplus: 19000, annualReturnPct: 0, now: NOW }).feasible, true)
  assert.equal(planGoal(goal, { monthlySurplus: 18518.52, annualReturnPct: 0, now: NOW }).feasible, true)

  const tight = planGoal(goal, { monthlySurplus: 18000, annualReturnPct: 0, now: NOW })
  assert.ok(Math.abs(tight.shortfall - (500000 / 27 - 18000)) < 1e-9)
  assert.match(tight.verdict, /Short by/)
  assert.match(flat.verdict, /Feasible/)

  // Junk in, no NaN out.
  for (const junk of [null, undefined, {}, { targetAmount: 'abc', targetDate: 'nope' }]) {
    const p = planGoal(junk, { monthlySurplus: NaN, annualReturnPct: undefined, now: NOW })
    assertAllFinite(p, 'plan')
    assert.ok(p.monthsLeft >= 1, 'monthsLeft never divides by zero')
  }
})

/* ------------------------------------------------------- 6. the projection */

test('forecastBalance is deterministic, correctly sized and always finite', () => {
  for (const days of [30, 60, 90]) {
    const a = forecastBalance(ACCOUNTS, OBLIGATIONS, { from: NOW, days, monthlyExpenses: 52000 })
    const b = forecastBalance(ACCOUNTS, OBLIGATIONS, { from: NOW, days, monthlyExpenses: 52000 })
    assert.deepEqual(a, b, `two identical calls must agree at ${days} days`)
    assert.equal(a.series.length, days)
    assert.equal(a.days, days)
    assert.equal(a.from, NOW)
    assert.equal(a.to, a.series[days - 1].date)
    assert.equal(a.closing, a.series[days - 1].balance)
    // Only BANK money is spendable: the 500000 FD must not appear in the opening.
    assert.equal(a.opening, 184500)
    assert.ok(a.min.balance <= a.closing || a.min.balance <= a.opening)
    assert.ok(a.series.some((p) => p.date === a.min.date))
    assertAllFinite(a, `forecast@${days}`)
  }

  // A spread of hostile inputs: empty arrays, a missing expense figure (null
  // quiz), junk fields, a start date at month end.
  const inputs = [
    [[], [], { from: NOW, days: 30 }],
    [[], OBLIGATIONS, { from: NOW, days: 90, monthlyExpenses: 0 }],
    [ACCOUNTS, [], { from: NOW, days: 60 }],
    [ACCOUNTS, OBLIGATIONS, { from: '2026-01-31', days: 90 }],
    [ACCOUNTS, OBLIGATIONS, { from: NOW, days: 30, monthlyExpenses: undefined }],
    [null, null, {}],
    [undefined, undefined, undefined],
    [[{ kind: 'BANK', balance: 'abc', meta: { monthlyCredit: null } }], [{ amount: NaN, dayOfMonth: 99 }], { from: NOW, days: 30 }],
    [[{ kind: 'BANK', balance: 5000 }], [{ kind: 'EMI', amount: 90000, dayOfMonth: 3 }], { from: NOW, days: 90, monthlyExpenses: 40000 }],
  ]
  for (const [acc, obl, opts] of inputs) {
    const f = forecastBalance(acc, obl, opts)
    assertAllFinite(f, 'forecast')
    assert.ok(f.series.length >= 1)
    assert.equal(f.series.length, f.days)
    assert.equal(typeof f.min.date, 'string')
    for (const p of f.series) {
      assert.match(p.date, /^\d{4}-\d{2}-\d{2}$/)
      assert.ok(p.inflow >= 0 && p.outflow >= 0)
    }
  }

  // The dip is real, not cosmetic: 5000 of cash against a 90000 EMI goes negative.
  const broke = forecastBalance([{ kind: 'BANK', balance: 5000 }], [{ amount: 90000, dayOfMonth: 3 }], {
    from: NOW,
    days: 30,
    monthlyExpenses: 40000,
  })
  assert.ok(broke.min.balance < 0, 'a 90000 debit against 5000 of cash must project below zero')
})

/* ------------------------------------------------------- 7. the instruments */

const REQUIRED_KEYS = ['key', 'name', 'kind', 'lockInYears', 'taxNote', 'riskBand', 'bestFor']

test('suggestInstruments ranks for every mode and never mis-suggests Sukanya', () => {
  assert.ok(INSTRUMENTS.length >= 10)
  for (const it of INSTRUMENTS) {
    for (const k of REQUIRED_KEYS) assert.ok(k in it, `${it.key} is missing ${k}`)
    assert.ok(Number.isFinite(it.lockInYears) && it.lockInYears >= 0)
    assert.ok(['Low', 'Medium', 'High'].includes(it.riskBand), it.key)
  }

  for (const mode of ['Conservative', 'Balanced', 'Aggressive']) {
    for (const slabRate of [0, 5, 20, 30]) {
      for (const dependents of [0, 2]) {
        for (const emergencyMonths of [0, 4.5]) {
          const out = suggestInstruments(
            { ...PROFILE, mode, dependents, emergencyMonths },
            { slabRate },
          )
          const where = `${mode}/slab ${slabRate}/dep ${dependents}/ef ${emergencyMonths}`
          assert.ok(out.length > 0, `empty list for ${where}`)
          for (const s of out) {
            for (const k of REQUIRED_KEYS) assert.ok(k in s, `${where}: ${s.key} is missing ${k}`)
            assert.equal(typeof s.reason, 'string')
            assert.ok(s.reason.length > 20, `${where}: ${s.key} has no real reason`)
            assert.ok(Number.isFinite(s.score))
            assert.ok(s.lockInYears <= PROFILE.horizonYears, `${where}: ${s.key} locks past the horizon`)
          }
          // Ranked, descending.
          for (let i = 1; i < out.length; i += 1) {
            assert.ok(out[i - 1].score >= out[i].score, `${where}: not ranked at index ${i}`)
          }
          if (dependents === 0) {
            assert.ok(!out.some((s) => s.key === 'ssy'), `${where}: Sukanya offered with no dependents`)
          }
          // An unbuilt emergency fund puts cash first.
          if (emergencyMonths === 0) {
            assert.equal(out[0].key, 'liquid', `${where}: cash must outrank every lock-in`)
          }
          assertAllFinite(out, `instruments ${where}`)
        }
      }
    }
  }

  // A two-year horizon cannot be handed a fifteen-year lock.
  const short = suggestInstruments({ ...PROFILE, mode: 'Aggressive', horizonYears: 2 }, { slabRate: 30 })
  assert.ok(short.length > 0)
  assert.ok(short.every((s) => s.lockInYears <= 2), 'short horizon leaked a long lock-in')

  // Junk profile: still a list, still finite, still no throw.
  for (const junk of [null, undefined, {}, { mode: 'Nonsense' }]) {
    const out = suggestInstruments(junk, {})
    assert.ok(Array.isArray(out))
    assertAllFinite(out, 'instruments(junk)')
  }
})
