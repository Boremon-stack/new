// FinNexus "Financial Brain" -- the deck's AI Layer, honestly labelled.
//
// ponytail: this is a deterministic rule-and-arithmetic engine, NOT a trained
// model. The balance curve is a calendar walk over declared credits, declared
// obligations and one expense figure spread evenly; the goal planner is the
// future-value-of-an-annuity formula; the instrument list is a static table
// with a scoring rule. Nothing here learns anything. Phase 2 replaces
// forecastBalance with a model trained on real RBI Account Aggregator
// transaction history -- seasonality, merchant categories, irregular salary
// dates, none of which exist in this data model. The return shape is the seam,
// so the UI does not change when that lands. Until then the UI says
// "rule-based projection", never "AI prediction".
//
// Pure: `from` / `now` are injected, never Date.now(), never Math.random().
import { inr, pct } from './inr.js'

const DAY = 86400000
const EPOCH = new Date(Date.UTC(1970, 0, 1))

const num = (v) => (Number.isFinite(+v) ? +v : 0)
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
// Normalise -0 away so two identical calls deep-equal under strict comparison.
const r2 = (v) => {
  if (!Number.isFinite(v)) return 0
  const x = Math.round(v * 100) / 100
  return x === 0 ? 0 : x
}

const utc = (y, m, d) => new Date(Date.UTC(y, m, d))
const iso = (d) => d.toISOString().slice(0, 10)
const daysInMonth = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate()

/** Midnight-UTC day for a Date or an ISO-ish string; `fallback` when unparseable. */
function toUTCDay(v, fallback) {
  if (v === null || v === undefined || v === '') return fallback
  const d = v instanceof Date ? v : new Date(v)
  if (Number.isNaN(d.getTime())) return fallback
  return utc(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

function addMonths(d, n) {
  const first = utc(d.getUTCFullYear(), d.getUTCMonth() + n, 1)
  const dim = daysInMonth(first.getUTCFullYear(), first.getUTCMonth())
  return utc(first.getUTCFullYear(), first.getUTCMonth(), Math.min(d.getUTCDate(), dim))
}

/** Whole calendar months from `a` to `b`; negative when `b` is earlier. */
function monthsBetween(a, b) {
  let m = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth())
  if (b.getUTCDate() < a.getUTCDate()) m -= 1
  return m
}

/* ---------------------------------------------------------------- projection */

/** Day-by-day cash projection over the linked BANK accounts.
 *  Assumptions, all stated in the UI: salary lands on the 1st (the data model
 *  carries no credit date), obligations debit on their dayOfMonth, and the
 *  monthly expense figure is spread evenly over the days of each month so the
 *  curve slopes instead of stepping. */
export function forecastBalance(accounts, obligations, opts = {}) {
  const list = (Array.isArray(accounts) ? accounts : []).filter((a) => a && typeof a === 'object')
  const bills = (Array.isArray(obligations) ? obligations : []).filter((o) => o && typeof o === 'object')
  const banks = list.filter((a) => a.kind === 'BANK')

  const from = toUTCDay(opts.from, EPOCH)
  const askedDays = Math.round(num(opts.days))
  const days = askedDays > 0 ? clamp(askedDays, 1, 366) : 30

  const monthlyCredit = banks.reduce((s, a) => s + Math.max(0, num(a.meta?.monthlyCredit)), 0)
  const opening = banks.reduce((s, a) => s + num(a.balance), 0)
  // No expense figure yet (quiz not taken): fall back to 60% of declared credit
  // rather than pretending spending is zero, which would draw a rising line.
  const spend =
    Number.isFinite(+opts.monthlyExpenses) && +opts.monthlyExpenses >= 0
      ? +opts.monthlyExpenses
      : monthlyCredit * 0.6

  const due = new Map()
  for (const o of bills) {
    const d = clamp(Math.round(num(o.dayOfMonth)) || 1, 1, 28)
    due.set(d, (due.get(d) ?? 0) + Math.max(0, num(o.amount)))
  }
  const monthlyObligations = [...due.values()].reduce((a, b) => a + b, 0)

  let balance = opening
  let min = null
  const series = []
  for (let i = 0; i < days; i += 1) {
    const d = new Date(from.getTime() + i * DAY)
    const dom = d.getUTCDate()
    const inflow = dom === 1 ? monthlyCredit : 0
    const outflow = (due.get(dom) ?? 0) + spend / daysInMonth(d.getUTCFullYear(), d.getUTCMonth())
    balance += inflow - outflow
    const row = { date: iso(d), balance: r2(balance), inflow: r2(inflow), outflow: r2(outflow) }
    series.push(row)
    if (!min || row.balance < min.balance) min = { balance: row.balance, date: row.date }
  }

  return {
    from: iso(from),
    to: series[series.length - 1].date,
    days,
    series,
    opening: r2(opening),
    closing: series[series.length - 1].balance,
    min,
    monthlyBurn: r2(monthlyObligations + spend),
    monthlyCredit: r2(monthlyCredit),
    monthlyObligations: r2(monthlyObligations),
  }
}

/* -------------------------------------------------------------- goal parsing */

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const MONTH_RE =
  'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t)?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?'

// Indian money vocabulary. 1 lakh = 1e5, 1 crore = 1e7.
const UNITS = {
  k: 1e3,
  thousand: 1e3,
  l: 1e5,
  lac: 1e5,
  lacs: 1e5,
  lakh: 1e5,
  lakhs: 1e5,
  cr: 1e7,
  crore: 1e7,
  crores: 1e7,
}
const UNIT_RE = '(lakhs?|lacs?|l|crores?|cr|k|thousand)'

// Ordered: a clause with an explicit unit or a rupee sign beats a bare number,
// so "2 cars, 5 lakhs" cannot be read as two rupees.
const AMOUNT_RULES = [
  { re: new RegExp(`(\\d[\\d,]*(?:\\.\\d+)?)\\s*${UNIT_RE}\\b`, 'i') },
  { re: new RegExp(`(?:₹|rs\\.?|inr)\\s*(\\d[\\d,]*(?:\\.\\d+)?)\\s*${UNIT_RE}?\\b`, 'i') },
  { re: /(\d[\d,]{3,}(?:\.\d+)?)\b/, min: 1000 },
]

// Dates are matched and removed BEFORE the amount, so "by 2028" and
// "in 18 months" can never be mistaken for rupees.
const DATE_RULES = [
  {
    // by 31/12/2027, 31-12-2027 -- day first, Indian convention
    re: /\b(?:by|before|until|till|on)?\s*(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})\b/i,
    take: (m) => {
      const d = +m[1]
      const mo = +m[2]
      const y = +m[3]
      if (mo < 1 || mo > 12 || d < 1 || y < 1900 || y > 2999 || d > daysInMonth(y, mo - 1)) return null
      return utc(y, mo - 1, d)
    },
  },
  {
    // in 3 years, in 18 months
    re: /\bin\s+(\d{1,3}(?:\.\d+)?)\s*(years?|yrs?|y|months?|mos?|m)\b/i,
    take: (m, now) => {
      const n = parseFloat(m[1])
      if (!Number.isFinite(n) || n <= 0) return null
      const months = m[2].toLowerCase().startsWith('y') ? Math.round(n * 12) : Math.round(n)
      return months > 0 ? addMonths(now, Math.min(months, 1200)) : null
    },
  },
  {
    // by March 2027 / Mar 2027 -- the last day of that month
    re: new RegExp(`\\b(?:by|before|until|till|in|around)?\\s*(${MONTH_RE})\\.?,?\\s*(\\d{4})\\b`, 'i'),
    take: (m) => {
      const mi = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase())
      const y = +m[2]
      if (mi < 0 || y < 1900 || y > 2999) return null
      return utc(y, mi, daysInMonth(y, mi))
    },
  },
  {
    // by 2028 -- 31 December of that year
    re: /\b(?:by|before|until|till|in|during)\s+(\d{4})\b/i,
    take: (m) => {
      const y = +m[1]
      return y >= 1900 && y <= 2999 ? utc(y, 11, 31) : null
    },
  },
]

const cut = (s, m) => `${s.slice(0, m.index)} ${s.slice(m.index + m[0].length)}`

// Verbs, prepositions and punctuation that wrap the purpose. "a" is deliberately
// absent from this list: "for a car" must survive as "a car".
const LEAD = new RegExp(
  '^(?:\\s*[-–—:,.;"\'()]+' +
    '|\\s*(?:i|we)\\s+(?:want|need|would\\s+like|wish|plan|hope)\\s+to\\b' +
    '|\\s*(?:want|need|wish|plan|hope)\\s+to\\b' +
    '|\\s*(?:save|saving|savings|buy|purchase|build|get|accumulate|collect|reach|make|target|goal|fund|put|set|aside|up|for|towards?|to|of|corpus|my|the)\\b)',
  'i',
)
const TRAIL = /(?:\s*(?:by|before|until|till|in|on|from|and|with|at|of)\b|\s*[-–—:,.;"'()]+)\s*$/i

function labelFrom(rest) {
  let s = String(rest).replace(/\s+/g, ' ').trim()
  for (let i = 0; i < 8; i += 1) {
    const next = s.replace(LEAD, '').replace(TRAIL, '').trim()
    if (next === s) break
    s = next
  }
  s = s.split(' ').filter(Boolean).slice(0, 8).join(' ')
  if (s.length > 60) s = `${s.slice(0, 57).trim()}...`
  return s || 'Savings goal'
}

/** Turn an Indian natural-language money goal into numbers.
 *  "Save 5 Lakhs for a car by 2028" -> 500000, 2028-12-31, "a car". */
export function parseGoal(text, opts = {}) {
  const raw = typeof text === 'string' ? text.trim() : ''
  const now = toUTCDay(opts.now, EPOCH)
  if (!raw) {
    return { ok: false, reason: 'Type a goal first — for example "Save 5 Lakhs for a car by 2028".' }
  }

  let rest = raw
  let target = null
  for (const rule of DATE_RULES) {
    const m = rest.match(rule.re)
    if (!m) continue
    const d = rule.take(m, now)
    if (!d) continue
    target = d
    rest = cut(rest, m)
    break
  }

  let amount = null
  for (const rule of AMOUNT_RULES) {
    const m = rest.match(rule.re)
    if (!m) continue
    const v = parseFloat(String(m[1]).replace(/,/g, ''))
    if (!Number.isFinite(v) || v <= 0) continue
    const total = Math.round(v * (m[2] ? UNITS[m[2].toLowerCase()] ?? 1 : 1))
    if (rule.min && total < rule.min) continue
    amount = total
    rest = cut(rest, m)
    break
  }

  if (amount === null) {
    return {
      ok: false,
      reason:
        'No rupee amount found. Write the figure as 5 Lakhs, 5L, ₹5,00,000, 50k or 2 crore — for example "Save 5 Lakhs for a car by 2028".',
    }
  }
  if (!target) {
    return {
      ok: false,
      reason: `Read the amount as ${inr(amount)} but found no deadline. Add one as "by 2028", "by March 2027", "in 3 years" or "by 31/12/2027".`,
    }
  }
  if (target.getTime() <= now.getTime()) {
    return {
      ok: false,
      reason: `That deadline (${iso(target)}) is not in the future — today is ${iso(now)}. Pick a later date.`,
    }
  }

  return {
    ok: true,
    label: labelFrom(rest),
    targetAmount: amount,
    targetDate: iso(target),
    horizonMonths: Math.max(0, monthsBetween(now, target)),
    raw,
  }
}

/* --------------------------------------------------------------- goal maths */

// Months of PMT at monthly rate r needed to reach fv.
function monthsToReach(fv, pmt, r) {
  if (!(pmt > 0) || !(fv > 0)) return 0
  if (!(r > 0)) return Math.ceil(fv / pmt)
  const n = Math.log(1 + (fv * r) / pmt) / Math.log(1 + r)
  return Number.isFinite(n) ? Math.max(1, Math.ceil(n)) : 0
}

/** Plain division and the SIP-style annuity figure, side by side.
 *  Future value of an ordinary annuity: FV = PMT * ((1+r)^n - 1) / r,
 *  so PMT = FV * r / ((1+r)^n - 1), falling back to FV/n when r is 0. */
export function planGoal(goal, opts = {}) {
  const g = goal && typeof goal === 'object' ? goal : {}
  const now = toUTCDay(opts.now, EPOCH)
  const target = toUTCDay(g.targetDate, null)
  const spanned = target ? monthsBetween(now, target) : Math.round(num(g.horizonMonths))
  const monthsLeft = clamp(Number.isFinite(spanned) ? spanned : 1, 1, 1200)

  const targetAmount = Math.max(0, Math.round(num(g.targetAmount)))
  const surplus = Math.max(0, num(opts.monthlySurplus))
  const r = clamp(num(opts.annualReturnPct), 0, 100) / 100 / 12

  const requiredMonthly = targetAmount / monthsLeft
  const growth = Math.pow(1 + r, monthsLeft)
  const withReturns =
    r > 0 && Number.isFinite(growth) && growth - 1 > 0 ? (targetAmount * r) / (growth - 1) : requiredMonthly
  const requiredMonthlyWithReturns = Number.isFinite(withReturns) ? withReturns : requiredMonthly

  const feasible = requiredMonthlyWithReturns <= surplus
  const shortfall = Math.max(0, requiredMonthlyWithReturns - surplus)
  const surplusUsedPct =
    surplus > 0 ? (requiredMonthlyWithReturns / surplus) * 100 : requiredMonthlyWithReturns > 0 ? 100 : 0

  let verdict
  if (surplus <= 0) {
    verdict = `No monthly surplus is on file, so the whole ${inr(requiredMonthlyWithReturns)} a month for ${monthsLeft} months would have to come from cutting something else. Complete the Risk Profile so the surplus is known.`
  } else if (feasible) {
    verdict = `Feasible: ${inr(requiredMonthlyWithReturns)} a month for ${monthsLeft} months reaches ${inr(targetAmount)}, using ${pct(surplusUsedPct)} of your ${inr(surplus)} surplus and leaving ${inr(surplus - requiredMonthlyWithReturns)} spare.`
  } else {
    const reachableRaw = r > 0 && Number.isFinite(growth) ? (surplus * (growth - 1)) / r : surplus * monthsLeft
    const reachable = Number.isFinite(reachableRaw) ? reachableRaw : 0
    const stretched = monthsToReach(targetAmount, surplus, r)
    verdict = `Short by ${inr(shortfall)} a month: the goal needs ${inr(requiredMonthlyWithReturns)} against a surplus of ${inr(surplus)}. At ${inr(surplus)} a month it lands in ${stretched} months instead of ${monthsLeft}, or hold the date and cut the target to ${inr(reachable)}.`
  }

  return {
    monthsLeft,
    targetAmount,
    requiredMonthly,
    requiredMonthlyWithReturns,
    feasible,
    shortfall,
    surplusUsedPct,
    verdict,
  }
}

/* ------------------------------------------------------------- instruments */

/* Real Indian instruments, described by lock-in and tax treatment rather than by
   a rate. Rates here are notified quarterly (small savings), reset half-yearly
   (FRSB) or repriced at will (bank deposits), so any number hardcoded into a demo
   is wrong within a quarter -- where a rate matters the entry says so and names
   the review cadence instead of quoting a figure that goes stale silently. */
export const INSTRUMENTS = [
  {
    key: 'liquid',
    name: 'Liquid / overnight mutual fund',
    kind: 'Debt mutual fund',
    lockInYears: 0,
    taxNote:
      'No lock-in, redemption typically T+1. Gains are taxed as income at your slab rate — no indexation since the 2023 debt-fund change.',
    riskBand: 'Low',
    bestFor: 'The emergency corpus, and any money needed inside twelve months.',
  },
  {
    key: 'rd',
    name: 'Bank recurring deposit',
    kind: 'Bank deposit',
    lockInYears: 1,
    taxNote:
      'Interest is taxed at your slab rate, with TDS above the annual threshold. The rate is indicative and repriced by the bank at every renewal — confirm it on the day you book.',
    riskBand: 'Low',
    bestFor: 'A fixed monthly amount for a goal one to three years out.',
  },
  {
    key: 'frsb',
    name: 'RBI Floating Rate Savings Bond',
    kind: 'Government bond',
    lockInYears: 7,
    taxNote:
      'Interest is fully taxable at your slab rate and paid half-yearly, so nothing compounds. The coupon is indicative only: it resets every six months against the NSC rate.',
    riskBand: 'Low',
    bestFor: 'Sovereign-credit income inside a conservative debt sleeve.',
  },
  {
    key: 'ppf',
    name: 'Public Provident Fund (PPF)',
    kind: 'Government small-savings scheme',
    lockInYears: 15,
    taxNote:
      'EEE — the contribution sits inside the ₹1,50,000 Section 80C ceiling, and both interest and maturity are exempt. The rate is notified quarterly by the Ministry of Finance, so treat any figure as indicative.',
    riskBand: 'Low',
    bestFor: 'The debt half of a long-horizon portfolio, and filling 80C.',
  },
  {
    key: 'epf',
    name: 'EPF / Voluntary Provident Fund top-up',
    kind: 'Retirement provident fund',
    lockInYears: 5,
    taxNote:
      'The employee contribution counts under Section 80C. Interest on contributions above the ₹2,50,000 annual threshold is taxable; withdrawal is tax-free after five years of continuous service. Locked until you exit service — five years is the planning floor used here.',
    riskBand: 'Low',
    bestFor: 'Salaried savers raising the debt allocation without opening anything new.',
  },
  {
    key: 'nps',
    name: 'NPS Tier-I',
    kind: 'Pension scheme',
    lockInYears: 15,
    taxNote:
      'An extra ₹50,000 deduction under Section 80CCD(1B), over and above the ₹1,50,000 of 80C. Locked until age 60 — fifteen years is the planning floor used here. At exit 60% of the corpus is tax-free and the remaining 40% must buy an annuity taxed as income.',
    riskBand: 'Medium',
    bestFor: 'Retirement money once the 80C ceiling is already full.',
  },
  {
    key: 'elss',
    name: 'ELSS equity fund',
    kind: 'Equity mutual fund',
    lockInYears: 3,
    taxNote:
      'Section 80C with the shortest lock-in in that basket, three years per instalment. Gains are equity LTCG after the lock-in; the exemption threshold and rate are revised in the Finance Act, so check the current year before redeeming.',
    riskBand: 'High',
    bestFor: 'Filling 80C with equity instead of with a deposit.',
  },
  {
    key: 'index_sip',
    name: 'Index fund SIP (Nifty 50 / Nifty 500)',
    kind: 'Equity mutual fund',
    lockInYears: 0,
    taxNote:
      'No lock-in and no deduction. Equity LTCG on redemption; a direct index plan costs a fraction of an active fund in expense ratio.',
    riskBand: 'High',
    bestFor: 'The growth engine for anything seven or more years away.',
  },
  {
    key: 'sgb',
    name: 'Sovereign Gold Bond',
    kind: 'Government bond',
    lockInYears: 8,
    taxNote:
      'Capital gains on redemption at maturity are exempt for individuals; the interest coupon is taxed at your slab rate. Issued in tranches, so availability is not continuous — check whether one is open, or buy on the exchange at a discount or premium.',
    riskBand: 'Medium',
    bestFor: 'Holding gold without making charges, storage or purity risk.',
  },
  {
    key: 'ssy',
    name: 'Sukanya Samriddhi Account',
    kind: 'Government small-savings scheme',
    lockInYears: 21,
    taxNote:
      'EEE and inside the ₹1,50,000 Section 80C ceiling. Only for a daughter under ten; matures 21 years from opening with a partial withdrawal allowed at 18. The rate is notified quarterly — indicative only.',
    riskBand: 'Low',
    bestFor: "A daughter's education or marriage corpus.",
  },
]

const MODE_FIT = {
  Conservative: { Low: 30, Medium: 12, High: 0 },
  Balanced: { Low: 20, Medium: 22, High: 16 },
  Aggressive: { Low: 10, Medium: 20, High: 30 },
}

// Bonus and one-line reason per instrument, both written against the user's own
// figures. `c` is the derived context built in suggestInstruments.
const RULES = {
  liquid: {
    bonus: (c) => (c.efGap > 0 ? 45 : 8),
    reason: (c) =>
      c.efGap > 0
        ? `Your emergency fund covers ${c.emergencyMonths} of 6 months on a ${inr(c.monthlyExpenses)} spend — ${inr(c.efShort)} still to park here before anything else locks up.`
        : `The fund already covers ${c.emergencyMonths} months (${inr(c.efHave)}); keep it where redemption is T+1, not in a five-year lock.`,
  },
  rd: {
    bonus: (c) => (c.horizonYears <= 3 ? 18 : 0) + (c.mode === 'Conservative' ? 6 : 0),
    reason: (c) =>
      `A ${c.horizonYears}-year horizon is too short for equity; an RD fixes a monthly amount out of your ${inr(c.surplus)} surplus with no market risk.`,
  },
  frsb: {
    bonus: (c) => (c.mode === 'Conservative' ? 10 : 0) + (c.slabRate >= 30 ? -8 : 0),
    reason: (c) =>
      c.slabRate >= 30
        ? `Sovereign credit, but the coupon is fully taxable — at a ${c.slabRate}% slab you keep only ${100 - c.slabRate}% of it, so it ranks below PPF for you.`
        : `${c.mode} mode over ${c.horizonYears} years: government credit risk, a seven-year lock, interest taxed at your ${c.slabRate}% slab.`,
  },
  ppf: {
    bonus: (c) => (c.horizonYears >= 15 ? 18 : 0) + (c.slabRate >= 20 ? 10 : 0) + (c.slabRate === 0 ? -10 : 0),
    reason: (c) =>
      `Your ${c.horizonYears}-year horizon clears the 15-year lock, and at a ${c.slabRate}% slab the EEE treatment is worth up to ${inr(c.c80Value)} a year against the ₹1,50,000 80C ceiling.`,
  },
  epf: {
    bonus: (c) => (c.monthlyIncome > 0 ? 6 : 0) + (c.slabRate >= 20 ? 8 : 0),
    reason: (c) =>
      `A VPF top-up raises the debt side without opening anything — even ${inr(Math.round(c.surplus * 0.1))} a month of your ${inr(c.surplus)} surplus counts towards 80C.`,
  },
  nps: {
    bonus: (c) => (c.horizonYears >= 15 ? 14 : 0) + (c.slabRate >= 30 ? 14 : 0) + (c.slabRate <= 5 ? -12 : 0),
    reason: (c) =>
      `The extra ₹50,000 under 80CCD(1B) is worth ${inr(Math.round(50000 * (c.slabRate / 100)))} a year at your ${c.slabRate}% slab, and a ${c.horizonYears}-year horizon can carry the lock to age 60.`,
  },
  elss: {
    bonus: (c) => (c.slabRate >= 20 ? 14 : 0) + (c.horizonYears >= 5 ? 8 : 0) + (c.mode === 'Conservative' ? -10 : 0),
    reason: (c) =>
      `Three years is the shortest 80C lock there is, and it suits ${c.mode} mode over ${c.horizonYears} years — the same ₹1,50,000 ceiling, in equity rather than a deposit.`,
  },
  index_sip: {
    bonus: (c) =>
      (c.horizonYears >= 7 ? 20 : 0) + (c.mode === 'Aggressive' ? 10 : 0) + (c.mode === 'Conservative' ? -8 : 0),
    reason: (c) =>
      `${c.horizonYears} years is long enough to sit through a drawdown, and nothing is locked — a SIP out of your ${inr(c.surplus)} surplus can be stepped up or stopped.`,
  },
  sgb: {
    bonus: (c) => (c.dependents > 0 ? 4 : 0) + (c.horizonYears >= 8 ? 8 : 0),
    reason: (c) =>
      `An eight-year hold sits inside your ${c.horizonYears}-year horizon, and gains at maturity are exempt — unlike jewellery, which costs making charges up front.`,
  },
  ssy: {
    bonus: (c) => (c.dependents > 0 ? 25 : 0),
    reason: (c) =>
      `With ${c.dependents} dependent(s): if one is a daughter under ten, this is EEE inside the same ₹1,50,000 80C ceiling, worth ${inr(c.c80Value)} a year at your ${c.slabRate}% slab.`,
  },
}

/** Filter and rank the table against this household. `profile` is the quiz
 *  profile with the mode folded in: { ...quiz.profile, mode: quiz.mode }. */
export function suggestInstruments(profile, opts = {}) {
  const p = profile && typeof profile === 'object' ? profile : {}
  const mode = MODE_FIT[p.mode] ? p.mode : 'Balanced'
  const monthlyIncome = Math.max(0, num(p.monthlyIncome))
  const monthlyExpenses = Math.max(0, num(p.monthlyExpenses))
  const emiLoad = Math.max(0, num(p.emiLoad))
  const dependents = clamp(Math.round(num(p.dependents)), 0, 12)
  const emergencyMonths = clamp(num(p.emergencyMonths), 0, 60)
  const horizonYears = clamp(num(p.horizonYears), 0, 60)
  const slabRate = clamp(Math.round(num(opts.slabRate)), 0, 50)

  const efTarget = monthlyExpenses * 6
  const efHave = monthlyExpenses * emergencyMonths
  const c = {
    mode,
    monthlyIncome,
    monthlyExpenses,
    emiLoad,
    dependents,
    emergencyMonths,
    horizonYears,
    slabRate,
    efTarget,
    efHave,
    efShort: Math.max(0, efTarget - efHave),
    efGap: emergencyMonths < 3 ? 1 : 0,
    surplus: Math.max(0, monthlyIncome - monthlyExpenses - emiLoad),
    c80Value: Math.round(150000 * (slabRate / 100)),
  }

  const scored = INSTRUMENTS
    // Sukanya Samriddhi needs a child; never offer it to a household with none.
    .filter((it) => (it.key === 'ssy' ? dependents > 0 : true))
    // Nothing may lock money up past the stated horizon.
    .filter((it) => it.lockInYears <= horizonYears)
    .map((it) => {
      const rule = RULES[it.key]
      const base = MODE_FIT[mode][it.riskBand] ?? 0
      // Until the emergency fund is built, anything that can fall in value or
      // cannot be reached the same week ranks below cash -- an unbuilt fund is
      // what forces a sale at the bottom.
      const efPenalty = c.efGap > 0 && (it.lockInYears > 0 || it.riskBand !== 'Low') ? -12 : 0
      return {
        ...it,
        score: base + (rule ? rule.bonus(c) : 0) + efPenalty,
        reason: rule ? rule.reason(c) : it.bestFor,
      }
    })

  // Never hand back an empty list: a very short horizon still needs somewhere
  // for the money to sit.
  const pool = scored.length
    ? scored
    : INSTRUMENTS.filter((it) => it.lockInYears === 0).map((it) => ({
        ...it,
        score: MODE_FIT[mode][it.riskBand] ?? 0,
        reason: RULES[it.key] ? RULES[it.key].reason(c) : it.bestFor,
      }))

  return pool.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key)).slice(0, 6)
}
