// Cross-Platform Tax Optimizer engine -- pitch deck Module 3.
// Pure functions only: no Date.now(), no Math.random(), no I/O. `asOf` is always injected,
// so the same portfolio on the same date always produces the same liability.
//
// ponytail: every figure here is derived from UNREALISED positions typed into the Portfolio
// panel -- mark-to-market, not booked trades. No cost-basis lot history, no FIFO matching, no
// STT / brokerage / surcharge / cess, and no gains already realised earlier in the financial
// year. Phase 2 pulls realised transactions from NSDL/CDSL and replaces only the INPUT:
// classify / computeTax / harvestPlan keep their shapes.
import { inr } from './inr.js'

const num = (v) => (Number.isFinite(+v) ? +v : 0)

export const LTCG_EXEMPTION = 125000

/* Every rate and threshold as data, each with the provision it comes from, so a reviewer can
   check the numbers without reading a line of the logic below. Post Budget 2024 (Finance
   (No. 2) Act 2024, transfers on or after 23 Jul 2024). */
export const RATES = {
  // Sec 2(42A): listed equity shares and equity-oriented MF units are long-term only after
  // MORE THAN 12 months. 12 months exactly is still short-term.
  equityLongMonths: 12,
  // Sec 112A: LTCG on STT-paid equity / equity MF at 12.5% flat, no indexation.
  equityLtcgPct: 12.5,
  // Sec 111A: STCG on STT-paid equity / equity MF at 20% (was 15% before 23 Jul 2024).
  equityStcgPct: 20,
  // Sec 112A(2) proviso: the first Rs 1,25,000 of Sec 112A LTCG in a financial year is exempt.
  // Applies to equity / equity MF only -- Sec 112 gains (gold) get no such exemption.
  ltcgExemption: LTCG_EXEMPTION,
  // Sec 50AA (Finance Act 2023, units acquired on or after 01 Apr 2023): gains on a specified
  // mutual fund are DEEMED short-term whatever the holding period -- slab rate, no indexation,
  // no separate long-term rate. That is why DEBT_MF never classifies as long-term here.
  debtDeemedShort: true,
  // Sec 2(42A) for other capital assets: gold / SGB is long-term after MORE THAN 24 months.
  goldLongMonths: 24,
  // Sec 112 (post 23 Jul 2024): LTCG on other assets at 12.5% without indexation.
  goldLtcgPct: 12.5,
  // Gold held 24 months or less has no special rate: it is added to total income at slab.
  // Sec 74(1): a SHORT-term capital loss sets off against both STCG and LTCG; a LONG-term
  // capital loss sets off against LTCG only. This asymmetry drives the whole harvesting plan.
  shortLossOffsetsLong: true,
  longLossOffsetsShort: false,
  // Sec 74(2): unabsorbed capital loss carries forward 8 assessment years, and only if the
  // return is filed by the Sec 139(1) due date.
  carryForwardYears: 8,
  // Slab used when the caller supplies none. New regime, Finance Act 2025 (FY 2025-26 onward):
  // nil to 4L, 5% 4-8L, 10% 8-12L, 15% 12-16L, 20% 16-20L, 25% 20-24L, 30% above 24L.
  // The panel offers three settings, so the bands collapse to the top rate each span reaches.
  slabBands: [
    { upToAnnual: 800000, rate: 5 },
    { upToAnnual: 2000000, rate: 20 },
    { upToAnnual: null, rate: 30 },
  ],
  defaultSlabPct: 30,
  // The Indian financial year runs 1 April to 31 March; the exemption is per financial year.
  fyStartMonth: 4,
}

const KIND_SET = new Set(['EQUITY', 'EQUITY_MF', 'DEBT_MF', 'GOLD'])
const kindOf = (v) => (KIND_SET.has(v) ? v : 'EQUITY')

/* ---------- dates: never throw, never return NaN ---------- */

function toDate(v) {
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v : null
  if (typeof v !== 'string' || !v) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v)
  const d = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : new Date(v)
  return Number.isFinite(d.getTime()) ? d : null
}

const addMonths = (d, n) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, d.getUTCDate()))

function monthsBetween(from, to) {
  let m = (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth())
  if (to.getUTCDate() < from.getUTCDate()) m -= 1
  return Math.max(0, m)
}

// 1 Apr - 31 Mar. 2026-03-31 falls in FY 2025-26; 2026-04-01 starts FY 2026-27.
function fyStartYear(asOf) {
  const d = toDate(asOf)
  if (!d) return null
  return d.getUTCMonth() >= RATES.fyStartMonth - 1 ? d.getUTCFullYear() : d.getUTCFullYear() - 1
}

const yearLabel = (prefix, start) => `${prefix} ${start}-${String((start + 1) % 100).padStart(2, '0')}`

/* ---------- classification ---------- */

const longMonthsFor = (kind) => (kind === 'GOLD' ? RATES.goldLongMonths : RATES.equityLongMonths)

// Which of the three pools a position is taxed in. SLAB is short-term in CHARACTER (Sec 50AA
// deems debt MF short-term; gold under 24 months genuinely is), it just carries the slab rate
// instead of the Sec 111A rate -- so its losses offset long-term gains like any other STCL.
function bucketOf(kind, term) {
  if (kind === 'DEBT_MF') return 'SLAB'
  if (kind === 'GOLD') return term === 'LONG' ? 'LONG' : 'SLAB'
  return term === 'LONG' ? 'LONG' : 'SHORT'
}

export function classify(holding, asOf) {
  const h = holding && typeof holding === 'object' ? holding : {}
  const kind = kindOf(h.kind)
  const invested = num(h.qty) * num(h.buyPrice)
  const current = num(h.qty) * num(h.currentPrice)

  const from = toDate(h.buyDate)
  const to = toDate(asOf)
  let days = 0
  let months = 0
  // Sec 50AA leaves a debt MF short-term however long it is held, so it never flips.
  let term = 'SHORT'
  if (from && to) {
    days = Math.max(0, Math.floor((to.getTime() - from.getTime()) / 86400000))
    months = monthsBetween(from, to)
    if (kind !== 'DEBT_MF' && to.getTime() > addMonths(from, longMonthsFor(kind)).getTime()) {
      term = 'LONG'
    }
  }

  return { term, days, months, gain: current - invested, invested, current }
}

/* ---------- liability ---------- */

function resolveSlabRate(rate, quiz) {
  const r = +rate
  if (Number.isFinite(r) && r > 0) return r
  const monthly = num(quiz && quiz.profile ? quiz.profile.monthlyIncome : 0)
  if (monthly <= 0) return RATES.defaultSlabPct
  const annual = monthly * 12
  for (const b of RATES.slabBands) {
    if (b.upToAnnual === null || annual <= b.upToAnnual) return b.rate
  }
  return RATES.defaultSlabPct
}

export function computeTax(holdings, opts) {
  const list = (Array.isArray(holdings) ? holdings : []).filter((h) => h && typeof h === 'object')
  const o = opts && typeof opts === 'object' ? opts : {}
  const slabRate = resolveSlabRate(o.slabRate, o.quiz)
  const fy = fyStartYear(o.asOf)
  const financialYear = fy === null ? 'FY —' : yearLabel('FY', fy)

  const rows = list.map((h, i) => {
    const kind = kindOf(h.kind)
    const c = classify(h, o.asOf)
    return {
      ...c,
      holdingId: h.id == null ? `row-${i}` : String(h.id),
      symbol: String(h.symbol || h.name || '—'),
      broker: String(h.broker || 'Unlinked'),
      kind,
      bucket: bucketOf(kind, c.term),
      taxable: 0,
      tax: 0,
    }
  })

  const pool = { SHORT: { gain: 0, loss: 0 }, LONG: { gain: 0, loss: 0 }, SLAB: { gain: 0, loss: 0 } }
  let ltEquityNet = 0
  for (const r of rows) {
    const p = pool[r.bucket]
    if (r.gain >= 0) p.gain += r.gain
    else p.loss += -r.gain
    // The Sec 112A exemption covers equity / equity MF long-term gains only.
    if (r.bucket === 'LONG' && r.kind !== 'GOLD') ltEquityNet += r.gain
  }

  const net = (k) => pool[k].gain - pool[k].loss
  const gainAfterSelfOffset = { SHORT: Math.max(0, net('SHORT')), SLAB: Math.max(0, net('SLAB')), LONG: Math.max(0, net('LONG')) }

  // Sec 112A(2): exemption applies to the net equity LTCG, capped at Rs 1,25,000 per FY.
  const exemptionCap = Math.max(0, Math.min(LTCG_EXEMPTION, ltEquityNet))
  const exemptionUsed = Math.min(exemptionCap, gainAfterSelfOffset.LONG)

  const taxable = {
    SHORT: gainAfterSelfOffset.SHORT,
    SLAB: gainAfterSelfOffset.SLAB,
    LONG: Math.max(0, gainAfterSelfOffset.LONG - exemptionUsed),
  }

  // Sec 74(1) asymmetry. Short-term losses (equity STCL + the slab pool, which is short-term in
  // character) are deployable against ANY head; a long-term loss that survives its own pool has
  // nowhere left to go and simply carries forward.
  let shortLossPool = Math.max(0, -net('SHORT')) + Math.max(0, -net('SLAB'))
  const longCarry = Math.max(0, -net('LONG'))

  // The assessee chooses the order of set-off, so spend the loss where it kills the most tax:
  // highest effective rate first. Nothing is ever applied to the exempt slice of LTCG -- that
  // slice costs zero tax, so a loss spent there is a loss thrown away.
  const rateOf = { SHORT: RATES.equityStcgPct, SLAB: slabRate, LONG: RATES.equityLtcgPct }
  const order = ['SHORT', 'SLAB', 'LONG'].sort((a, b) => rateOf[b] - rateOf[a] || a.localeCompare(b))
  for (const key of order) {
    const use = Math.min(shortLossPool, taxable[key])
    taxable[key] -= use
    shortLossPool -= use
  }

  const tax = {
    SHORT: Math.round((taxable.SHORT * rateOf.SHORT) / 100),
    SLAB: Math.round((taxable.SLAB * rateOf.SLAB) / 100),
    LONG: Math.round((taxable.LONG * rateOf.LONG) / 100),
  }

  // Attribute the surviving taxable base back to the positions that created it, pro rata.
  // Losing positions carry zero -- they are the offset, not the liability.
  for (const key of ['SHORT', 'SLAB', 'LONG']) {
    const winners = rows.filter((r) => r.bucket === key && r.gain > 0)
    const sum = winners.reduce((a, r) => a + r.gain, 0)
    for (const r of winners) {
      r.taxable = sum > 0 ? Math.round(taxable[key] * (r.gain / sum)) : 0
      r.tax = Math.round((r.taxable * rateOf[key]) / 100)
    }
  }

  // Cross-broker aggregation -- the headline claim of the module.
  const brokers = new Map()
  for (const r of rows) {
    const b = brokers.get(r.broker) || { broker: r.broker, invested: 0, current: 0, gain: 0, tax: 0 }
    b.invested += r.invested
    b.current += r.current
    b.gain += r.gain
    b.tax += r.tax
    brokers.set(r.broker, b)
  }
  const byBroker = [...brokers.values()].sort(
    (a, b) => b.tax - a.tax || b.gain - a.gain || a.broker.localeCompare(b.broker),
  )

  return {
    financialYear,
    slabRate,
    byHolding: rows,
    byBroker,
    shortTerm: { gain: pool.SHORT.gain, loss: pool.SHORT.loss, net: net('SHORT'), tax: tax.SHORT },
    longTerm: {
      gain: pool.LONG.gain,
      loss: pool.LONG.loss,
      net: net('LONG'),
      exemptionUsed,
      taxable: taxable.LONG,
      tax: tax.LONG,
    },
    slab: { gain: pool.SLAB.gain, loss: pool.SLAB.loss, net: net('SLAB'), tax: tax.SLAB },
    totalGain: rows.reduce((a, r) => a + r.gain, 0),
    totalTax: tax.SHORT + tax.SLAB + tax.LONG,
    carryForward: {
      shortTerm: Math.round(shortLossPool),
      longTerm: Math.round(longCarry),
      // Sec 74(2): 8 assessment years after the AY this loss belongs to.
      expiresAfter:
        fy === null
          ? `${RATES.carryForwardYears} assessment years`
          : yearLabel('AY', fy + 1 + RATES.carryForwardYears),
    },
  }
}

/* ---------- tax-loss harvesting ---------- */

const TERM_WORD = { SHORT: 'short-term', LONG: 'long-term' }

function offsetLabel(before, after, slabRate) {
  const parts = []
  if (after.slab.tax < before.slab.tax) parts.push(`slab-rate gains at ${slabRate}%`)
  if (after.shortTerm.tax < before.shortTerm.tax) parts.push(`STCG at ${RATES.equityStcgPct}%`)
  if (after.longTerm.tax < before.longTerm.tax) parts.push(`LTCG at ${RATES.equityLtcgPct}%`)
  return parts.join(' and ')
}

export function harvestPlan(holdings, opts) {
  const list = (Array.isArray(holdings) ? holdings : []).filter((h) => h && typeof h === 'object')
  const o = opts && typeof opts === 'object' ? opts : {}
  const full = computeTax(list, o)
  const slabRate = full.slabRate

  // Baseline: what the gains alone would cost if no loss were realised.
  const keep = list.filter((_, i) => full.byHolding[i].gain >= 0)
  const losers = list.map((_, i) => i).filter((i) => full.byHolding[i].gain < 0)
  const grossTax = computeTax(keep, o).totalTax

  // ponytail: O(n^2) re-runs of a pure function over a hand-entered portfolio -- a few dozen
  // rows at worst, so a marginal-value engine would be code nobody reads. Rank each candidate
  // by its STANDALONE saving, then re-price the list in that order so the per-row figures sum
  // to the real total. Swap to incremental accounting only if a broker feed makes n large.
  const ranked = losers
    .map((i) => ({ i, saved: grossTax - computeTax([...keep, list[i]], o).totalTax }))
    .sort(
      (a, b) =>
        b.saved - a.saved ||
        -full.byHolding[a.i].gain - -full.byHolding[b.i].gain ||
        full.byHolding[a.i].symbol.localeCompare(full.byHolding[b.i].symbol),
    )

  const chosen = [...keep]
  let before = computeTax(chosen, o)
  const candidates = []
  for (const { i } of ranked) {
    const row = full.byHolding[i]
    const after = computeTax([...chosen, list[i]], o)
    const taxSaved = before.totalTax - after.totalTax
    const unrealisedLoss = -row.gain
    const offsets = offsetLabel(before, after, slabRate)
    const word = TERM_WORD[row.term] || 'short-term'

    // A loss that buys no tax relief either carries forward or is simply swallowed by gains
    // that were already exempt. Say which, rather than asserting the flattering one.
    const carried =
      after.carryForward.shortTerm +
      after.carryForward.longTerm -
      (before.carryForward.shortTerm + before.carryForward.longTerm)

    let note
    if (taxSaved > 0) {
      note = `Sell: ${inr(unrealisedLoss)} of ${word} loss on ${row.symbol} at ${row.broker} cancels ${offsets}, cutting the estimated bill by ${inr(taxSaved)}.`
    } else if (carried > 0) {
      note = `Hold: ${row.bucket === 'LONG' ? 'a long-term loss offsets long-term gains only, and there are none left to offset' : 'no taxable gain is left for this loss to absorb'} — selling ${row.symbol} saves nothing this year, it only adds ${inr(carried)} to the carry-forward pool.`
    } else {
      note = `Hold: the ${inr(unrealisedLoss)} ${word} loss on ${row.symbol} would be absorbed against gains already covered by the ${inr(LTCG_EXEMPTION)} exemption — selling saves nothing this year and spends a loss that is worth more against a future taxable gain.`
    }

    candidates.push({
      holdingId: row.holdingId,
      symbol: row.symbol,
      broker: row.broker,
      kind: row.kind,
      term: row.term,
      unrealisedLoss,
      offsets: offsets || 'nothing taxable this year — the loss carries forward instead',
      taxSaved,
      note,
    })
    chosen.push(list[i])
    before = after
  }

  const totalLoss = candidates.reduce((a, c) => a + c.unrealisedLoss, 0)
  const totalTaxSaved = grossTax - full.totalTax
  const effectiveSavingPct = grossTax > 0 ? (totalTaxSaved / grossTax) * 100 : 0

  const worth = candidates.filter((c) => c.taxSaved > 0)
  const idle = candidates.filter((c) => c.taxSaved <= 0)
  const exemptionLeft = Math.max(0, LTCG_EXEMPTION - full.longTerm.exemptionUsed)
  const carry = full.carryForward.shortTerm + full.carryForward.longTerm
  const notes = []

  if (candidates.length === 0) {
    notes.push(
      `No position is showing an unrealised loss, so there is nothing to harvest. The estimated liability stays at ${inr(full.totalTax)} for ${full.financialYear}.`,
    )
  } else if (worth.length === 0) {
    notes.push(
      `None of the ${candidates.length} losing position(s) is worth selling this year: ${inr(totalLoss)} of loss would offset nothing taxable and would only be carried forward.`,
    )
  } else {
    notes.push(
      `Selling the ${worth.length} flagged position(s) realises ${inr(worth.reduce((a, c) => a + c.unrealisedLoss, 0))} of losses and cuts the estimated liability from ${inr(grossTax)} to ${inr(full.totalTax)} — ${inr(totalTaxSaved)} saved, ${Math.round(effectiveSavingPct)}% of the tax otherwise due.`,
    )
    const lossBrokers = [...new Set(worth.map((c) => c.broker))]
    const gainBrokers = [...new Set(full.byHolding.filter((r) => r.gain > 0).map((r) => r.broker))]
    const crossed = gainBrokers.filter((b) => !lossBrokers.includes(b))
    if (lossBrokers.length > 0 && crossed.length > 0) {
      notes.push(
        `The offset crosses broker boundaries: losses sitting at ${lossBrokers.join(', ')} cancel gains booked at ${crossed.join(', ')}. Income tax is assessed on the person, not on the demat account — but only a unified view shows you the pairing.`,
      )
    }
  }

  for (const c of idle) notes.push(c.note)

  if (exemptionLeft > 0) {
    notes.push(
      `${inr(exemptionLeft)} of the ${inr(LTCG_EXEMPTION)} long-term equity exemption for ${full.financialYear} is unused. Booking up to ${inr(exemptionLeft)} of LTCG before 31 March costs nothing in tax, and resets the cost basis upward.`,
    )
  }

  notes.push(
    `India has no statutory wash-sale rule for listed equity, so the same scrip can be bought back immediately — what resets is the holding period. A repurchased lot starts a fresh ${RATES.equityLongMonths}-month clock, so a position that was long-term at ${RATES.equityLtcgPct}% comes back short-term at ${RATES.equityStcgPct}%.`,
  )

  if (carry > 0) {
    notes.push(
      `${inr(carry)} of loss cannot be absorbed in ${full.financialYear} (${inr(full.carryForward.shortTerm)} short-term, ${inr(full.carryForward.longTerm)} long-term). File the return by the due date to carry it forward to ${full.carryForward.expiresAfter}; a late return forfeits it.`,
    )
  }

  return { candidates, totalLoss, totalTaxSaved, effectiveSavingPct, notes }
}
