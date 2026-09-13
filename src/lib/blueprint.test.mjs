// Self-check for the Budget Blueprint engine: node --test src/lib/blueprint.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildBlueprint, analyzeSpending } from './blueprint.js'

const MODES = ['Conservative', 'Balanced', 'Aggressive']

const PROFILES = [
  { monthlyIncome: 28000, monthlyExpenses: 21000, emiLoad: 0, dependents: 0, emergencyMonths: 0, horizonYears: 3 },
  { monthlyIncome: 28000, monthlyExpenses: 24000, emiLoad: 16800, dependents: 3, emergencyMonths: 0, horizonYears: 2 },
  { monthlyIncome: 95000, monthlyExpenses: 52000, emiLoad: 0, dependents: 0, emergencyMonths: 6, horizonYears: 25 },
  { monthlyIncome: 95000, monthlyExpenses: 80000, emiLoad: 57000, dependents: 3, emergencyMonths: 0, horizonYears: 30 },
  { monthlyIncome: 450000, monthlyExpenses: 300000, emiLoad: 120000, dependents: 2, emergencyMonths: 4, horizonYears: 12 },
  { monthlyIncome: 7200, monthlyExpenses: 6800, emiLoad: 4300, dependents: 1, emergencyMonths: 1, horizonYears: 8 },
]

const quizOf = (mode, profile, completedAt = '2026-09-13T06:30:00.000Z') => ({
  answers: Array.from({ length: 20 }, (_, i) => i % 5),
  score: 50,
  mode,
  profile,
  completedAt,
})

const ACCOUNTS = [
  { id: 'acc-1', kind: 'BANK', institution: 'HDFC Bank', label: 'XXXX XXXX 4821', balance: 184500, linkedAt: '2026-09-01T00:00:00.000Z', meta: { accountType: 'Salary', ifsc: 'HDFC0001234', monthlyCredit: 95000 } },
  { id: 'acc-2', kind: 'FD', institution: 'SBI', label: 'XXXX 9032', balance: 500000, linkedAt: '2026-09-02T00:00:00.000Z', meta: { principal: 450000, rate: 7.1, tenureMonths: 24 } },
]

// Walk any returned structure and fail on the first non-finite number.
function assertAllFinite(value, path = 'root') {
  if (typeof value === 'number') {
    assert.ok(Number.isFinite(value), `${path} is not finite: ${value}`)
    return
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertAllFinite(v, `${path}[${i}]`))
    return
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) assertAllFinite(v, `${path}.${k}`)
  }
  if (typeof value === 'string') assert.ok(!/NaN|Infinity|undefined/.test(value), `${path} leaked a bad number: ${value}`)
}

test('allocations: pct sums to 100, amounts sum to income, nothing negative', () => {
  for (const mode of MODES) {
    for (const profile of PROFILES) {
      const b = buildBlueprint(quizOf(mode, profile))
      const where = `${mode} @ income ${profile.monthlyIncome} emi ${profile.emiLoad}`
      assert.deepEqual(
        b.allocations.map((a) => a.key),
        ['Needs', 'Wants', 'Savings', 'Investments'],
        where,
      )
      assert.equal(b.allocations.reduce((s, a) => s + a.pct, 0), 100, `pct sum: ${where}`)
      assert.equal(
        b.allocations.reduce((s, a) => s + a.amount, 0),
        b.monthlyIncome,
        `amount sum: ${where}`,
      )
      assert.equal(b.monthlyIncome, profile.monthlyIncome, `income echo: ${where}`)
      for (const a of b.allocations) {
        assert.ok(a.pct >= 0 && a.amount >= 0, `negative bucket ${a.key}: ${where}`)
        assert.ok(a.note.length > 0, `missing note ${a.key}: ${where}`)
      }
      assert.ok(b.guardrails.length >= 3 && b.guardrails.length <= 5, `guardrails: ${where}`)
    }
  }
})

test('investmentSplit: pct sums to 100, amounts finite and non-negative', () => {
  for (const mode of MODES) {
    for (const profile of PROFILES) {
      const b = buildBlueprint(quizOf(mode, profile))
      const where = `${mode} @ income ${profile.monthlyIncome}`
      assert.ok(b.investmentSplit.length >= 3 && b.investmentSplit.length <= 5, `lines: ${where}`)
      assert.equal(b.investmentSplit.reduce((s, s2) => s + s2.pct, 0), 100, `split pct: ${where}`)
      for (const line of b.investmentSplit) {
        assert.ok(Number.isFinite(line.amount) && line.amount >= 0, `split amount: ${where}`)
      }
      const invest = b.allocations.find((a) => a.key === 'Investments').amount
      assert.equal(b.investmentSplit.reduce((s, l) => s + l.amount, 0), invest, `split total: ${where}`)
    }
  }
})

test('Aggressive invests strictly more than Conservative on the same profile', () => {
  for (const profile of PROFILES) {
    const cons = buildBlueprint(quizOf('Conservative', profile))
    const bal = buildBlueprint(quizOf('Balanced', profile))
    const agg = buildBlueprint(quizOf('Aggressive', profile))
    const inv = (b) => b.allocations.find((a) => a.key === 'Investments').pct
    assert.ok(
      inv(agg) > inv(cons),
      `Aggressive ${inv(agg)}% not > Conservative ${inv(cons)}% @ income ${profile.monthlyIncome}`,
    )
    assert.ok(inv(bal) >= inv(cons), `Balanced ${inv(bal)}% < Conservative ${inv(cons)}%`)
  }
})

test('heavy EMI keeps Wants non-negative and Needs at least the EMI load', () => {
  for (const mode of MODES) {
    const profile = { monthlyIncome: 60000, monthlyExpenses: 55000, emiLoad: 36000, dependents: 3, emergencyMonths: 0, horizonYears: 20 }
    const b = buildBlueprint(quizOf(mode, profile))
    const get = (k) => b.allocations.find((a) => a.key === k)
    assert.ok(get('Wants').amount >= 0, `${mode} Wants negative`)
    assert.ok(
      get('Needs').amount >= profile.emiLoad,
      `${mode} Needs ${get('Needs').amount} < EMI ${profile.emiLoad}`,
    )
  }
})

test('analyzeSpending is deterministic and account-set sensitive', () => {
  const quiz = quizOf('Balanced', PROFILES[2])
  const a = analyzeSpending(quiz, ACCOUNTS)
  const b = analyzeSpending(quiz, ACCOUNTS.map((x) => ({ ...x })))
  assert.deepEqual(a, b)
  assert.ok(a.sampleCount > 0)
  assert.equal(a.rows.length, 9)

  const other = analyzeSpending(quiz, [ACCOUNTS[0]])
  assert.notEqual(other.totalActual, a.totalActual)
  assert.equal(other.totalPlanned, a.totalPlanned) // plan depends on the quiz, not the accounts

  // rows are internally consistent
  for (const r of a.rows) {
    assert.equal(r.delta, r.actual - r.planned, r.key)
    const expected = Math.abs(r.delta) <= r.planned * 0.05 ? 'on' : r.delta > 0 ? 'over' : 'under'
    assert.equal(r.status, expected, r.key)
  }
  assert.equal(a.rows.reduce((s, r) => s + r.planned, 0), a.totalPlanned)
  assert.equal(a.rows.reduce((s, r) => s + r.actual, 0), a.totalActual)
  assert.ok(a.insights.length >= 3 && a.insights.length <= 6, `insights ${a.insights.length}`)
})

test('empty account list and null quiz do not throw', () => {
  const empty = analyzeSpending(quizOf('Aggressive', PROFILES[0]), [])
  assert.equal(empty.sampleCount, 0)
  assert.deepEqual(empty.rows, [])
  assert.equal(empty.totalActual, 0)
  assert.equal(empty.totalPlanned, 0)
  assert.deepEqual(analyzeSpending(null, ACCOUNTS).rows, [])
  assert.deepEqual(analyzeSpending(undefined, undefined).rows, [])
})

test('no NaN anywhere, including from junk input', () => {
  for (const mode of MODES) {
    for (const profile of PROFILES) {
      assertAllFinite(buildBlueprint(quizOf(mode, profile)), `build(${mode})`)
      assertAllFinite(analyzeSpending(quizOf(mode, profile), ACCOUNTS), `analyze(${mode})`)
    }
  }
  const junkQuiz = { mode: 'Nonsense', profile: { monthlyIncome: '95000', monthlyExpenses: undefined, emiLoad: NaN, dependents: null, emergencyMonths: 'x', horizonYears: Infinity } }
  const junk = buildBlueprint(junkQuiz)
  assertAllFinite(junk, 'build(junk)')
  assert.equal(junk.mode, 'Balanced')
  assert.equal(junk.allocations.reduce((s, a) => s + a.pct, 0), 100)
  assert.equal(junk.allocations.reduce((s, a) => s + a.amount, 0), junk.monthlyIncome)
  assertAllFinite(buildBlueprint(null), 'build(null)')
  assertAllFinite(buildBlueprint({ mode: 'Balanced', profile: { monthlyIncome: 0 } }), 'build(zero)')
  assertAllFinite(
    analyzeSpending(junkQuiz, [{ id: 'x' }, null, { id: 'y', balance: 'abc', kind: 'FD' }]),
    'analyze(junk accounts)',
  )
})
