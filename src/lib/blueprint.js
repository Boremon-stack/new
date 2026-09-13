// Budget Blueprint engine -- FR-BB-02..06.
// Pure functions only: no Math.random(), no Date.now(), no I/O. Same inputs -> same output.
import { inr } from './inr.js'

const num = (v) => (Number.isFinite(+v) ? +v : 0)
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

// FR-BB-06: the risk mode sets the aggressiveness. Needs+Wants+Savings+Investments = 100 in every base.
const MODES = {
  Conservative: {
    base: { Needs: 55, Wants: 13, Savings: 22, Investments: 10 },
    invFloor: 3,
    sleeve: 'a small, debt-like investment sleeve',
    split: [
      ['PPF / EPF top-up', 30],
      ['Debt fund / RD', 30],
      ['Index fund SIP', 20],
      ['Sovereign Gold Bond', 10],
      ['ELSS (Section 80C)', 10],
    ],
  },
  Balanced: {
    base: { Needs: 50, Wants: 18, Savings: 17, Investments: 15 },
    invFloor: 4,
    sleeve: 'an even equity-and-debt core',
    split: [
      ['Equity mutual fund SIP', 30],
      ['Index fund SIP', 25],
      ['ELSS (Section 80C)', 15],
      ['PPF / EPF top-up', 15],
      ['Debt fund / RD', 15],
    ],
  },
  Aggressive: {
    base: { Needs: 45, Wants: 17, Savings: 12, Investments: 26 },
    invFloor: 6,
    sleeve: 'an equity-led sleeve',
    split: [
      ['Equity mutual fund SIP', 40],
      ['Index fund SIP', 30],
      ['ELSS (Section 80C)', 15],
      ['NPS Tier-I', 10],
      ['Sovereign Gold Bond', 5],
    ],
  },
}

const BUCKET_KEYS = ['Needs', 'Wants', 'Savings', 'Investments']

/* Split `total` into integers proportional to `weights` that sum to EXACTLY round(total).
   Largest-remainder (Hare quota): floor everything, then hand the leftover units to the
   largest fractional remainders. Chosen over "dump the drift into the biggest bucket" because
   no bucket can ever be pushed BELOW its floor -- that is what keeps Needs >= emiLoad and
   every bucket >= 0 after rounding. */
function apportion(weights, total) {
  const target = Math.round(num(total))
  const sum = weights.reduce((a, b) => a + Math.max(0, b), 0)
  if (!(sum > 0) || target <= 0) return weights.map(() => 0)
  const raw = weights.map((w) => (Math.max(0, w) / sum) * target)
  const out = raw.map((v) => Math.floor(v))
  let left = target - out.reduce((a, b) => a + b, 0)
  const order = raw
    .map((v, i) => [v - Math.floor(v), i])
    .sort((a, b) => b[0] - a[0] || a[1] - b[1])
  for (let k = 0; left > 0; k += 1, left -= 1) out[order[k % order.length][1]] += 1
  return out
}

// Move weight into Needs from the listed donors, each only down to its floor.
function carveNeeds(w, target, donors) {
  let need = target - w.Needs
  for (const [key, floor] of donors) {
    if (need <= 1e-9) break
    const give = Math.min(need, w[key] - floor)
    if (give > 0) {
      w[key] -= give
      w.Needs += give
      need -= give
    }
  }
}

export function buildBlueprint(quiz) {
  const q = quiz && typeof quiz === 'object' ? quiz : {}
  const p = q.profile && typeof q.profile === 'object' ? q.profile : {}
  const mode = MODES[q.mode] ? q.mode : 'Balanced'
  const cfg = MODES[mode]

  const monthlyIncome = Math.max(0, Math.round(num(p.monthlyIncome)))
  const expenses = clamp(num(p.monthlyExpenses), 0, monthlyIncome)
  const emi = clamp(num(p.emiLoad), 0, monthlyIncome)
  const dependents = clamp(Math.round(num(p.dependents)), 0, 12)
  const emergencyMonths = clamp(num(p.emergencyMonths), 0, 60)
  const horizonYears = clamp(num(p.horizonYears), 0, 60)

  const w = { ...cfg.base }
  const emiShare = monthlyIncome > 0 ? (emi / monthlyIncome) * 100 : 0

  // EMI is carved out of Needs; when it alone outgrows the bucket, Needs expands and the
  // discretionary buckets shrink -- Wants first, then the investment sleeve. Never negative.
  const needsTarget = Math.min(95, Math.max(w.Needs + Math.min(8, dependents * 2.5), emiShare + 2))
  carveNeeds(w, needsTarget, [
    ['Wants', 0],
    ['Investments', cfg.invFloor],
    ['Savings', 5],
    ['Investments', 0],
    ['Savings', 0],
  ])

  // Emergency fund under 3 months: divert a proportional slice of Investments into Savings
  // until the fund is built. Proportional, so the mode ordering survives.
  const efGap = clamp(3 - emergencyMonths, 0, 3) / 3
  if (efGap > 0) {
    const move = w.Investments * 0.45 * efGap
    w.Investments -= move
    w.Savings += move
  }

  // A long horizon buys more equity; a horizon under 5 years pulls it back into Savings.
  const hf = horizonYears >= 15 ? 1.18 : horizonYears >= 10 ? 1.08 : horizonYears >= 5 ? 1 : 0.82
  let shift = w.Investments * (hf - 1)
  if (shift > 0) {
    for (const [key, floor] of [['Wants', 0], ['Savings', 6]]) {
      const give = Math.min(shift, w[key] - floor)
      if (give > 0) {
        w[key] -= give
        w.Investments += give
        shift -= give
      }
    }
  } else if (shift < 0) {
    w.Investments += shift
    w.Savings -= shift
  }

  let weights = BUCKET_KEYS.map((k) => Math.max(0, num(w[k])))
  if (!(weights.reduce((a, b) => a + b, 0) > 0)) weights = BUCKET_KEYS.map((k) => cfg.base[k])

  const pcts = apportion(weights, 100)
  const amounts = apportion(pcts, monthlyIncome)
  const at = (k) => amounts[BUCKET_KEYS.indexOf(k)]

  const efTarget = expenses * 6
  const efHave = expenses * emergencyMonths
  const notes = {
    Needs: `Rent, EMI, groceries, utilities, transport, healthcare. Absorbs your ${inr(emi)} EMI load and leaves ${inr(Math.max(0, at('Needs') - emi))} for household running cost.`,
    Wants: 'Dining, Swiggy/Zomato, shopping, subscriptions. Treat it as a ceiling, not a target.',
    Savings:
      efGap > 0
        ? `Emergency fund comes first: ${emergencyMonths} of 6 months logged, ${inr(Math.max(0, efTarget - efHave))} still to build in a sweep FD or liquid fund.`
        : `Fund already at ${emergencyMonths} months (${inr(efHave)}). Keep the sweep for goals under three years.`,
    Investments: `${mode} mode: ${cfg.sleeve} over a ${horizonYears}-year horizon.`,
  }

  const allocations = BUCKET_KEYS.map((key, i) => ({
    key,
    label: key,
    pct: pcts[i],
    amount: amounts[i],
    note: notes[key],
  }))

  const investAmount = at('Investments')
  const splitPcts = apportion(cfg.split.map((s) => s[1]), 100)
  const splitAmounts = apportion(splitPcts, investAmount)
  const investmentSplit = cfg.split.map((s, i) => ({
    label: s[0],
    pct: splitPcts[i],
    amount: splitAmounts[i],
  }))

  const savingsRate = pcts[2] + pcts[3]
  const c80 =
    investmentSplit.filter((s) => /ELSS|PPF/.test(s.label)).reduce((a, s) => a + s.amount, 0) * 12
  const coverMult = dependents > 0 ? 12 : 10

  const guardrails = [
    `Emergency fund target is 6 months of expenses = ${inr(efTarget)}; you have logged ${emergencyMonths} months (${inr(efHave)}). Park it in a sweep FD, never in equity.`,
    `Hold total EMI under 40% of income (${inr(monthlyIncome * 0.4)}). You are at ${inr(emi)}, i.e. ${Math.round(emiShare)}% — ${emiShare > 40 ? 'prepay the costliest loan before taking on any new one' : 'there is room, but do not fill it'}.`,
    `Term cover of at least ${coverMult}x annual income = ${inr(monthlyIncome * 12 * coverMult)} with ${dependents} dependent(s), plus a family floater of ${inr(500000 + dependents * 300000)}.`,
    `Section 80C ceiling is ${inr(150000)} a year. The ELSS + PPF lines above route ${inr(c80)} — ${c80 >= 150000 ? 'the limit is already used, so send any surplus to the index SIP' : `${inr(150000 - c80)} of headroom is unused`}.`,
    `Keep Savings + Investments at or above ${savingsRate}% (${inr(at('Savings') + investAmount)} a month) and cap Wants at ${inr(at('Wants'))}.`,
  ]

  return { mode, monthlyIncome, allocations, savingsRate, investmentSplit, guardrails }
}

/* ---------- FR-BB-04 / FR-BB-05: actual versus planned ---------- */

// ponytail: simulated transactions. There is no backend and account linking is UI-only
// (PRD Section 11, R-03/R-04), so the month of spend is synthesised deterministically from
// the linked account set. Phase 2 replaces this whole block with RBI Account Aggregator
// transaction feeds (PRD R-04) -- the row and insight shapes stay, only the source changes.
const CATEGORIES = [
  { key: 'rent', label: 'Rent / EMI', bucket: 'Needs', weight: 34, txs: 2, swing: 0.05, bias: 0 },
  { key: 'groceries', label: 'Groceries (Kirana / BigBasket)', bucket: 'Needs', weight: 24, txs: 9, swing: 0.26, bias: 0.04 },
  { key: 'utilities', label: 'Utilities & Recharge', bucket: 'Needs', weight: 12, txs: 4, swing: 0.18, bias: 0 },
  { key: 'transport', label: 'Transport (Fuel / Ola / Uber / Metro)', bucket: 'Needs', weight: 16, txs: 11, swing: 0.34, bias: 0.06 },
  { key: 'health', label: 'Healthcare', bucket: 'Needs', weight: 14, txs: 2, swing: 0.45, bias: -0.1 },
  { key: 'dining', label: 'Dining & Swiggy / Zomato', bucket: 'Wants', weight: 45, txs: 14, swing: 0.45, bias: 0.2 },
  { key: 'shopping', label: 'Shopping', bucket: 'Wants', weight: 38, txs: 6, swing: 0.5, bias: 0.12 },
  { key: 'subs', label: 'Subscriptions', bucket: 'Wants', weight: 17, txs: 5, swing: 0.12, bias: 0.08 },
  { key: 'sip', label: 'SIP / RD transfer', bucket: 'Investments', weight: 100, txs: 3, swing: 0.2, bias: -0.14 },
]

function hash32(s) {
  let h = 2166136261 >>> 0
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  return h >>> 0
}

// mulberry32 -- four lines, deterministic, good enough for a demo spend profile.
function prng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const NO_ACCOUNTS_LINE =
  'Link a bank or fixed deposit account first — nothing is simulated from an empty portfolio.'

export function analyzeSpending(quiz, accounts) {
  const list = (Array.isArray(accounts) ? accounts : []).filter((a) => a && typeof a === 'object')
  if (!quiz || typeof quiz !== 'object' || list.length === 0) {
    return {
      windowLabel: 'Last 30 days',
      totalPlanned: 0,
      totalActual: 0,
      rows: [],
      insights: [NO_ACCOUNTS_LINE],
      sampleCount: 0,
    }
  }

  const plan = buildBlueprint(quiz)
  const bucket = (name) => plan.allocations.find((a) => a.key === name)?.amount ?? 0

  const seed = hash32(
    `${list
      .map((a) => `${String(a.id ?? '')}|${String(a.kind ?? '')}|${Math.round(num(a.balance))}`)
      .join(';')}@${String(quiz.completedAt ?? '')}#${plan.mode}`,
  )
  const rnd = prng(seed)

  // Planned per category: each bucket's rupees split across its categories, bucket sum preserved.
  const planned = {}
  for (const name of ['Wants', 'Investments']) {
    const cats = CATEGORIES.filter((c) => c.bucket === name)
    const parts = apportion(cats.map((c) => c.weight), bucket(name))
    cats.forEach((c, i) => {
      planned[c.key] = parts[i]
    })
  }

  // Needs is special: the Rent/EMI line can never be planned below the EMI the user declared,
  // so it takes its floor first and the rest of Needs is apportioned around it.
  const needsTotal = bucket('Needs')
  const p = quiz.profile && typeof quiz.profile === 'object' ? quiz.profile : {}
  const rentWeight = CATEGORIES.find((c) => c.key === 'rent').weight
  planned.rent = Math.min(
    needsTotal,
    Math.max(Math.round((needsTotal * rentWeight) / 100), Math.round(clamp(num(p.emiLoad), 0, needsTotal))),
  )
  const restNeeds = CATEGORIES.filter((c) => c.bucket === 'Needs' && c.key !== 'rent')
  const restParts = apportion(restNeeds.map((c) => c.weight), needsTotal - planned.rent)
  restNeeds.forEach((c, i) => {
    planned[c.key] = restParts[i]
  })

  let sampleCount = 0
  const rows = CATEGORIES.map((c) => {
    const plannedAmt = planned[c.key] ?? 0
    const drift = Math.max(0.1, 1 + c.bias + (rnd() * 2 - 1) * c.swing)
    const count = Math.max(1, Math.round(c.txs * (0.7 + rnd() * 0.6)))
    const actual = plannedAmt > 0 ? Math.max(0, Math.round(plannedAmt * drift)) : 0
    if (actual > 0) sampleCount += count
    const delta = actual - plannedAmt
    const status = Math.abs(delta) <= plannedAmt * 0.05 ? 'on' : delta > 0 ? 'over' : 'under'
    return { key: c.key, label: c.label, planned: plannedAmt, actual, delta, status }
  })

  const totalPlanned = rows.reduce((a, r) => a + r.planned, 0)
  const totalActual = rows.reduce((a, r) => a + r.actual, 0)
  const gap = totalActual - totalPlanned

  const over = rows.filter((r) => r.status === 'over').sort((a, b) => b.delta - a.delta)
  const sip = rows.find((r) => r.key === 'sip')
  const wantsKeys = CATEGORIES.filter((c) => c.bucket === 'Wants').map((c) => c.key)
  const wantsOver = rows
    .filter((r) => wantsKeys.includes(r.key))
    .reduce((a, r) => a + Math.max(0, r.delta), 0)
  const savingsAmt = bucket('Savings')

  const insights = [
    `${sampleCount} transactions across ${list.length} linked account(s): ${inr(totalActual)} spent against a plan of ${inr(totalPlanned)} — ${inr(Math.abs(gap))} ${gap > 0 ? 'over' : 'under'}.`,
  ]
  for (const r of over.slice(0, 2)) {
    insights.push(
      `${r.label} ran ${inr(r.delta)} over plan (${inr(r.actual)} against ${inr(r.planned)}). Cap that category at ${inr(r.planned)} and route the excess to the SIP auto-debit.`,
    )
  }
  if (sip && sip.delta < 0) {
    insights.push(
      `SIP / RD transfer is ${inr(-sip.delta)} short of the planned ${inr(sip.planned)}. Move the standing instruction to the 2nd of the month so it debits before discretionary spend.`,
    )
  } else if (sip) {
    insights.push(
      `SIP / RD transfer is funded at ${inr(sip.actual)} against a plan of ${inr(sip.planned)} — leave that mandate alone.`,
    )
  }
  if (wantsOver > 0 && savingsAmt > 0) {
    insights.push(
      `Wants overspend of ${inr(wantsOver)} has eaten ${Math.round((wantsOver / savingsAmt) * 100)}% of your ${inr(savingsAmt)} Savings bucket. Sweep that amount out on salary day instead of at month end.`,
    )
  }
  const under = rows.filter((r) => r.status === 'under').sort((a, b) => a.delta - b.delta)[0]
  if (insights.length < 3 && under) {
    insights.push(
      `${under.label} came in ${inr(-under.delta)} under plan — reallocate it to the ${plan.mode === 'Conservative' ? 'PPF / EPF top-up' : 'index fund SIP'} rather than letting it drift.`,
    )
  }
  if (insights.length < 3) {
    insights.push('Every category is inside its 5% band. Hold the blueprint and re-run next month.')
  }

  return {
    windowLabel: 'Last 30 days',
    totalPlanned,
    totalActual,
    rows,
    insights: insights.slice(0, 6),
    sampleCount,
  }
}
