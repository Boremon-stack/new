// Self-check for the risk engine. Run: node --test src/lib/quiz.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { QUESTIONS, RISK_MODES, deriveRiskMode } from './quiz.js'

const MODES = Object.keys(RISK_MODES)
const argIdx = (q, cmp) => q.options.reduce((best, o, i) => (cmp(o.score, q.options[best].score) ? i : best), 0)
const LOWEST = QUESTIONS.map((q) => argIdx(q, (a, b) => a < b))
const HIGHEST = QUESTIONS.map((q) => argIdx(q, (a, b) => a > b))

test('FR-QUIZ-01: 20 well-formed questions covering all six categories', () => {
  assert.equal(QUESTIONS.length, 20)
  assert.deepEqual(
    QUESTIONS.map((q) => q.id),
    Array.from({ length: 20 }, (_, i) => `Q${i + 1}`),
  )
  assert.equal(new Set(QUESTIONS.map((q) => q.id)).size, 20)
  for (const q of QUESTIONS) {
    assert.ok(q.options.length >= 3, `${q.id} needs >= 3 options`)
    assert.ok(q.text.length > 0, `${q.id} needs text`)
    for (const o of q.options) {
      assert.ok(Number.isFinite(o.score), `${q.id} option "${o.label}" has a non-numeric score`)
      assert.ok(typeof o.label === 'string' && o.label.length > 0)
    }
  }
  assert.deepEqual(
    [...new Set(QUESTIONS.map((q) => q.category))].sort(),
    ['Expenses', 'Income', 'Investment Experience', 'Liabilities', 'Risk Appetite', 'Savings'],
  )
})

test('FR-QUIZ-03: the extremes land in the outer bands', () => {
  assert.equal(deriveRiskMode(LOWEST).mode, 'Conservative')
  assert.equal(deriveRiskMode(HIGHEST).mode, 'Aggressive')
})

test('every option of every question keeps score in 0..100 and mode valid', () => {
  QUESTIONS.forEach((q, qi) => {
    q.options.forEach((_, oi) => {
      const answers = QUESTIONS.map(() => 0)
      answers[qi] = oi
      const { score, mode } = deriveRiskMode(answers)
      assert.ok(Number.isInteger(score) && score >= 0 && score <= 100, `${q.id}/${oi} score ${score}`)
      assert.ok(MODES.includes(mode), `${q.id}/${oi} mode ${mode}`)
    })
  })
})

test('profile invariants the Blueprint divides by', () => {
  const sets = [
    QUESTIONS.map(() => 0),
    LOWEST,
    HIGHEST,
    QUESTIONS.map((q, i) => (i * 7 + 3) % q.options.length),
    QUESTIONS.map((q, i) => (i * 3 + 1) % q.options.length),
    QUESTIONS.map((q) => q.options.length - 1),
  ]
  for (const answers of sets) {
    const { profile } = deriveRiskMode(answers)
    for (const [k, v] of Object.entries(profile)) {
      assert.ok(Number.isFinite(v) && v >= 0, `${k} = ${v}`)
    }
    assert.ok(profile.monthlyIncome > 0)
    assert.ok(profile.monthlyExpenses <= 0.95 * profile.monthlyIncome + 1, 'expense clamp')
    assert.ok(profile.emiLoad <= 0.6 * profile.monthlyIncome + 1, 'EMI clamp')
    assert.ok(Number.isInteger(profile.dependents))
  }
})

test('safety cap: a heavy EMI load is never Aggressive', () => {
  const incomeQ = QUESTIONS.findIndex((q) => q.id === 'Q1')
  const emiQ = QUESTIONS.findIndex((q) => q.id === 'Q8')
  const worstEmi = argIdx(QUESTIONS[emiQ], (a, b) => a < b)
  let tripped = 0
  QUESTIONS[incomeQ].options.forEach((_, band) => {
    const answers = [...HIGHEST]
    answers[incomeQ] = band
    answers[emiQ] = worstEmi
    const { mode, profile } = deriveRiskMode(answers)
    if (profile.emiLoad / profile.monthlyIncome > 0.4) {
      tripped += 1
      assert.notEqual(mode, 'Aggressive', `income band ${band} with a heavy EMI stayed Aggressive`)
    }
  })
  assert.ok(tripped > 0, 'no answer set actually exercised the cap')
})

test('a sparse answers array does not throw', () => {
  assert.ok(MODES.includes(deriveRiskMode([]).mode))
  assert.ok(MODES.includes(deriveRiskMode([3, null, undefined, 99, -1]).mode))
})
