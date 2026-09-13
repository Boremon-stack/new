// Self-check for the Cross-Platform Tax Optimizer engine:
//   node --test src/lib/tax.test.mjs
// Asserts the things that actually break: the two holding-period boundaries, the Rs 1,25,000
// exemption arithmetic, the Sec 50AA slab treatment of debt MF, the Sec 74 loss-offset
// asymmetry, the 1 April financial-year cut, harvest ranking, and NaN-freedom on junk input.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LTCG_EXEMPTION, RATES, classify, computeTax, harvestPlan } from './tax.js'

const AS_OF = '2026-09-14'

// One holding. Override anything; gain = qty * (currentPrice - buyPrice).
const hold = (over) => ({
  id: 'h1',
  kind: 'EQUITY',
  broker: 'Zerodha',
  symbol: 'X',
  name: 'X Ltd',
  qty: 1,
  buyPrice: 100000,
  currentPrice: 100000,
  buyDate: '2024-01-01',
  addedAt: '2026-09-01T00:00:00.000Z',
  ...over,
})

// gain of exactly `g` rupees on a single unit
const gainOf = (g, over) => hold({ buyPrice: 100000, currentPrice: 100000 + g, ...over })

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

/* ---------- 1. holding-period boundaries ---------- */

test('equity turns long-term only AFTER 12 months; gold only after 24', () => {
  // Sec 2(42A): "more than" twelve months. Twelve months to the day is still short-term.
  assert.equal(classify(hold({ buyDate: '2025-09-14' }), '2026-09-14').term, 'SHORT')
  assert.equal(classify(hold({ buyDate: '2025-09-14' }), '2026-09-15').term, 'LONG')
  assert.equal(classify(hold({ kind: 'EQUITY_MF', buyDate: '2025-09-14' }), '2026-09-15').term, 'LONG')

  assert.equal(classify(hold({ kind: 'GOLD', buyDate: '2024-09-14' }), '2026-09-14').term, 'SHORT')
  assert.equal(classify(hold({ kind: 'GOLD', buyDate: '2024-09-14' }), '2026-09-15').term, 'LONG')
  // 23 months and change is nowhere near the gold threshold.
  assert.equal(classify(hold({ kind: 'GOLD', buyDate: '2024-10-14' }), '2026-09-15').term, 'SHORT')

  const c = classify(hold({ buyDate: '2025-09-14' }), '2026-09-15')
  assert.equal(c.months, 12)
  assert.equal(c.days, 366)
})

/* ---------- 2. the Rs 1,25,000 LTCG exemption ---------- */

test('equity LTCG under the exemption is untaxed; above it, 12.5% of the excess', () => {
  assert.equal(LTCG_EXEMPTION, 125000)

  const under = computeTax([gainOf(100000, { buyDate: '2024-01-01' })], { asOf: AS_OF, slabRate: 30 })
  assert.equal(under.longTerm.gain, 100000)
  assert.equal(under.longTerm.exemptionUsed, 100000)
  assert.equal(under.longTerm.taxable, 0)
  assert.equal(under.longTerm.tax, 0)
  assert.equal(under.totalTax, 0)

  const over = computeTax([gainOf(225000, { buyDate: '2024-01-01' })], { asOf: AS_OF, slabRate: 30 })
  assert.equal(over.longTerm.exemptionUsed, 125000)
  assert.equal(over.longTerm.taxable, 100000)
  assert.equal(over.longTerm.tax, 12500) // 12.5% of 1,00,000
  assert.equal(over.totalTax, 12500)
})

/* ---------- 3. equity STCG at 20% ---------- */

test('equity STCG is 20% flat, with no exemption', () => {
  const r = computeTax([gainOf(100000, { buyDate: '2026-06-01' })], { asOf: AS_OF, slabRate: 30 })
  assert.equal(r.byHolding[0].term, 'SHORT')
  assert.equal(r.shortTerm.gain, 100000)
  assert.equal(r.shortTerm.tax, 20000)
  assert.equal(r.longTerm.exemptionUsed, 0)
  assert.equal(r.totalTax, 20000)
})

/* ---------- 4. Sec 50AA: debt MF is slab, never 12.5% ---------- */

test('a debt fund held five years is taxed at slab, not at the long-term rate', () => {
  const five = gainOf(100000, { kind: 'DEBT_MF', buyDate: '2021-06-01', symbol: 'DEBTF' })
  assert.ok(classify(five, AS_OF).months >= 60, 'fixture should really be a five-year hold')

  const r = computeTax([five], { asOf: AS_OF, slabRate: 30 })
  assert.equal(r.slab.gain, 100000)
  assert.equal(r.slab.tax, 30000) // 30% slab on 1,00,000
  assert.equal(r.longTerm.gain, 0)
  assert.equal(r.longTerm.tax, 0)
  assert.equal(r.totalTax, 30000)
  assert.notEqual(r.totalTax, 12500, 'debt MF must not get the 12.5% long-term rate')

  // The slab actually applied is the one asked for.
  assert.equal(computeTax([five], { asOf: AS_OF, slabRate: 5 }).totalTax, 5000)
  // ...and defaults off quiz income when none is given: 95k/month = 11.4L a year.
  const auto = computeTax([five], { asOf: AS_OF, quiz: { profile: { monthlyIncome: 95000 } } })
  assert.equal(auto.slabRate, 20)
  assert.equal(computeTax([five], { asOf: AS_OF }).slabRate, 30)
})

/* ---------- 5. Sec 74: the loss-offset asymmetry ---------- */

test('a long-term loss does NOT touch short-term gains', () => {
  const r = computeTax(
    [
      gainOf(100000, { id: 'g', buyDate: '2026-06-01', symbol: 'STGAIN' }),
      gainOf(-100000, { id: 'l', buyDate: '2024-01-01', symbol: 'LTLOSS' }),
    ],
    { asOf: AS_OF, slabRate: 30 },
  )
  assert.equal(r.shortTerm.gain, 100000)
  assert.equal(r.shortTerm.tax, 20000, 'STCG must stay fully taxed')
  assert.equal(r.longTerm.loss, 100000)
  assert.equal(r.totalTax, 20000)
  assert.equal(r.carryForward.longTerm, 100000, 'the LTCL has nowhere to go but forward')
  assert.equal(r.carryForward.shortTerm, 0)
  assert.equal(r.carryForward.expiresAfter, 'AY 2035-36') // FY 2026-27 -> AY 2027-28 + 8
})

test('a short-term loss DOES reduce long-term gains, and other short gains too', () => {
  // short loss against LTCG: 3,00,000 LTCG - 1,25,000 exempt = 1,75,000, less 1,00,000 of
  // short-term loss = 75,000 taxable at 12.5% = 9,375.
  const a = computeTax(
    [
      gainOf(300000, { id: 'g', buyDate: '2024-01-01', symbol: 'LTGAIN' }),
      gainOf(-100000, { id: 'l', buyDate: '2026-06-01', symbol: 'STLOSS' }),
    ],
    { asOf: AS_OF, slabRate: 30 },
  )
  assert.equal(a.longTerm.exemptionUsed, 125000)
  assert.equal(a.longTerm.taxable, 75000)
  assert.equal(a.totalTax, 9375)
  assert.equal(a.carryForward.shortTerm, 0)

  // ...and a slab-pool loss (debt MF, deemed short-term by Sec 50AA) sitting at a DIFFERENT
  // broker still offsets equity STCG: 1,00,000 - 50,000 = 50,000 at 20% = 10,000.
  const b = computeTax(
    [
      gainOf(100000, { id: 'g', broker: 'Zerodha', buyDate: '2026-06-01', symbol: 'STGAIN' }),
      gainOf(-50000, { id: 'l', broker: 'Groww', kind: 'DEBT_MF', buyDate: '2021-06-01', symbol: 'DEBTF' }),
    ],
    { asOf: AS_OF, slabRate: 30 },
  )
  assert.equal(b.shortTerm.tax, 10000)
  assert.equal(b.totalTax, 10000)
  assert.equal(b.byBroker.length, 2, 'both brokers must appear in the cross-broker view')
  assert.equal(b.byBroker.reduce((s, x) => s + x.gain, 0), 50000)
  assert.equal(b.byBroker.reduce((s, x) => s + x.tax, 0), b.totalTax)
})

/* ---------- 6. the 1 April financial-year cut ---------- */

test('the financial year turns over on 1 April', () => {
  assert.equal(computeTax([], { asOf: '2026-03-31' }).financialYear, 'FY 2025-26')
  assert.equal(computeTax([], { asOf: '2026-04-01' }).financialYear, 'FY 2026-27')
  assert.equal(computeTax([], { asOf: '2027-01-15' }).financialYear, 'FY 2026-27')
  assert.equal(computeTax([], { asOf: new Date(Date.UTC(2026, 3, 1)) }).financialYear, 'FY 2026-27')
  assert.equal(RATES.fyStartMonth, 4)
})

/* ---------- 7. harvesting: ranked by tax saved, not by loss size ---------- */

test('harvestPlan ranks by tax saved and refuses to sell a loss that offsets an exempt gain', () => {
  const holdings = [
    gainOf(80000, { id: 'g1', broker: 'Zerodha', buyDate: '2024-01-01', symbol: 'LTGAIN' }),
    gainOf(100000, { id: 'g2', broker: 'Groww', buyDate: '2026-06-01', symbol: 'STGAIN' }),
    // the BIGGER raw loss, and worth nothing: long-term, and the LTCG is already exempt
    gainOf(-50000, { id: 'l1', broker: 'Zerodha', buyDate: '2024-01-01', symbol: 'LTLOSS' }),
    // the smaller loss, and the valuable one: short-term against 20% STCG
    gainOf(-40000, { id: 'l2', broker: 'Groww', buyDate: '2026-06-01', symbol: 'STLOSS' }),
  ]
  const p = harvestPlan(holdings, { asOf: AS_OF, slabRate: 30 })

  assert.equal(p.candidates.length, 2)
  assert.equal(p.candidates[0].symbol, 'STLOSS', 'the smaller loss ranks first because it saves more')
  assert.equal(p.candidates[0].taxSaved, 8000) // 20% of 40,000
  assert.match(p.candidates[0].offsets, /STCG/)

  assert.equal(p.candidates[1].symbol, 'LTLOSS')
  assert.equal(p.candidates[1].taxSaved, 0, 'offsets only an already-exempt LTCG')
  assert.match(p.candidates[1].note, /saves nothing this year/)
  assert.ok(
    p.candidates[0].unrealisedLoss < p.candidates[1].unrealisedLoss,
    'ranking must not be by raw loss size',
  )

  assert.equal(p.totalLoss, 90000)
  assert.equal(p.totalTaxSaved, 8000)
  assert.equal(Math.round(p.effectiveSavingPct), 40) // 8,000 of the 20,000 otherwise due
  assert.ok(p.notes.some((n) => /no statutory wash-sale rule/.test(n)), 'wash-sale caution present')
  assert.ok(p.notes.some((n) => /crosses broker boundaries/.test(n)), 'cross-broker offset stated')
  // Nothing is unabsorbed here, so no carry-forward claim may be made.
  assert.ok(!p.notes.some((n) => /carry it forward/.test(n)), 'no phantom carry-forward')
  assert.ok(p.notes.some((n) => /exemption for FY 2026-27 is unused/.test(n)), 'exemption headroom stated')

  // ...but when the loss really is unabsorbed, the carry-forward note appears with its expiry.
  const stranded = harvestPlan(
    [
      gainOf(100000, { id: 'g', buyDate: '2026-06-01', symbol: 'STGAIN' }),
      gainOf(-300000, { id: 'l', buyDate: '2024-01-01', symbol: 'LTLOSS' }),
    ],
    { asOf: AS_OF, slabRate: 30 },
  )
  assert.equal(stranded.candidates[0].taxSaved, 0, 'LTCL cannot reach a short-term gain')
  assert.ok(stranded.notes.some((n) => /carry it forward to AY 2035-36/.test(n)))
})

/* ---------- 8. junk in, no NaN out ---------- */

test('empty and junk input produce zeroed, finite structures without throwing', () => {
  const empty = computeTax([], { asOf: AS_OF })
  assert.equal(empty.totalGain, 0)
  assert.equal(empty.totalTax, 0)
  assert.deepEqual(empty.byHolding, [])
  assert.deepEqual(empty.byBroker, [])
  assert.equal(empty.shortTerm.tax, 0)
  assert.equal(empty.longTerm.exemptionUsed, 0)
  assert.equal(empty.carryForward.shortTerm, 0)
  assertAllFinite(empty, 'computeTax([])')

  const emptyPlan = harvestPlan([], { asOf: AS_OF })
  assert.deepEqual(emptyPlan.candidates, [])
  assert.equal(emptyPlan.totalTaxSaved, 0)
  assert.equal(emptyPlan.effectiveSavingPct, 0)
  assert.ok(emptyPlan.notes.length > 0)
  assertAllFinite(emptyPlan, 'harvestPlan([])')

  const junk = [
    { id: 'j1', kind: 'CRYPTO', broker: '', symbol: '', name: '', qty: 'abc', buyPrice: null, currentPrice: undefined, buyDate: 'not-a-date' },
    { id: 'j2', kind: 'GOLD', broker: 'Upstox', symbol: 'SGB', qty: 2, buyPrice: NaN, currentPrice: 5000 },
    { id: 'j3', kind: 'DEBT_MF', broker: 'Groww', symbol: 'D', qty: 1, buyPrice: 100000, currentPrice: 40000, buyDate: '' },
    null,
    'not a holding',
    gainOf(500000, { id: 'j4', broker: 'Angel One', buyDate: '2023-02-11', symbol: 'OK' }),
  ]
  for (const bad of [undefined, null, 'nope', 42, {}]) {
    assertAllFinite(computeTax(bad, { asOf: bad }), `computeTax(${String(bad)})`)
    assertAllFinite(harvestPlan(bad, undefined), `harvestPlan(${String(bad)})`)
  }

  const r = computeTax(junk, { asOf: AS_OF, slabRate: 30 })
  assert.equal(r.byHolding.length, 4, 'null and non-objects are dropped, not crashed on')
  assertAllFinite(r, 'computeTax(junk)')
  assertAllFinite(harvestPlan(junk, { asOf: AS_OF, slabRate: 30 }), 'harvestPlan(junk)')
  assertAllFinite(classify({}, 'garbage'), 'classify({})')
  assertAllFinite(RATES, 'RATES')

  // A missing or unparseable buyDate must not silently promote a position to long-term.
  assert.equal(r.byHolding.find((x) => x.holdingId === 'j1').term, 'SHORT')
  assert.equal(r.byHolding.find((x) => x.holdingId === 'j1').days, 0)
  assert.equal(r.byHolding.find((x) => x.holdingId === 'j2').gain, 10000) // NaN buyPrice -> 0
})
