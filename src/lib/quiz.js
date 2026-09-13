// FR-QUIZ-01/02/03 -- the 20-question risk profiler and its scoring engine.
//
// Every band, instrument and habit below is calibrated for Indian financial
// conditions: INR income/expense bands, EPF/PPF/NPS/ELSS, SIP in mutual funds,
// FD/RD, gold and LIC endowment, home-loan EMI, credit-card revolving balance,
// Section 80C / 80CCD(1B), HRA, UPI spending and demat/direct equity. No US
// retirement vehicles appear anywhere.
//
// Scoring is pure arithmetic -- no timers, no async (NFR-02).

/** FR-QUIZ-01: exactly 20 questions across the six PRD categories.
 *  Distribution: 3 Income, 4 Expenses, 3 Liabilities, 4 Savings,
 *  3 Investment Experience, 3 Risk Appetite.
 *  `score` is the risk contribution of the option; `value` is the numeric
 *  household fact the question establishes (INR, count, months or years). */
export const QUESTIONS = [
  // ---------------- Income (3) ----------------
  {
    id: 'Q1',
    category: 'Income',
    text: 'What is your monthly take-home (in-hand) income, after TDS and deductions?',
    options: [
      { label: 'Under ₹25,000', score: 0, value: 18000 },
      { label: '₹25,000–₹50,000', score: 2, value: 37500 },
      { label: '₹50,000–₹1,00,000', score: 4, value: 75000 },
      { label: '₹1,00,000–₹2,00,000', score: 6, value: 150000 },
      { label: 'Above ₹2,00,000', score: 8, value: 300000 },
    ],
  },
  {
    id: 'Q2',
    category: 'Income',
    text: 'How stable is that income?',
    options: [
      { label: 'Gig or freelance work — it changes every month', score: 0 },
      { label: 'Own business or professional practice, variable', score: 2 },
      { label: 'Private-sector salary, less than 2 years in the role', score: 4 },
      { label: 'Private-sector salary, steady for 2 years or more', score: 6 },
      { label: 'Government, PSU or pension income', score: 7 },
    ],
  },
  {
    id: 'Q3',
    category: 'Income',
    text: 'How many people depend on this income besides you?',
    options: [
      { label: 'Nobody — I am the only one', score: 6, value: 0 },
      { label: 'One dependent', score: 4, value: 1 },
      { label: 'Two dependents', score: 3, value: 2 },
      { label: 'Three dependents', score: 1, value: 3 },
      { label: 'Four or more dependents', score: 0, value: 4 },
    ],
  },

  // ---------------- Expenses (4) ----------------
  {
    id: 'Q4',
    category: 'Expenses',
    text: 'What do you spend in a normal month on household running costs — rent, groceries, utilities, school fees, travel?',
    options: [
      { label: 'Under ₹15,000', score: 6, value: 12000 },
      { label: '₹15,000–₹30,000', score: 5, value: 22500 },
      { label: '₹30,000–₹60,000', score: 3, value: 45000 },
      { label: '₹60,000–₹1,20,000', score: 1, value: 90000 },
      { label: 'Above ₹1,20,000', score: 0, value: 180000 },
    ],
  },
  {
    id: 'Q5',
    category: 'Expenses',
    text: 'What does housing cost you each month?',
    options: [
      { label: 'Rent above 40% of take-home pay', score: 0 },
      { label: 'Rent of 25–40% of take-home pay, HRA claimed', score: 2 },
      { label: 'Rent under 25% of take-home pay', score: 4 },
      { label: 'Living with family, no rent paid', score: 5 },
      { label: 'Own the home outright, no housing outgo', score: 6 },
    ],
  },
  {
    id: 'Q6',
    category: 'Expenses',
    text: 'How closely do you watch day-to-day UPI and card spending?',
    options: [
      { label: 'I tap UPI as needed and check the balance afterwards', score: 0 },
      { label: 'I skim the UPI and card statement at month end', score: 2 },
      { label: 'I set a monthly discretionary cap and mostly keep to it', score: 4 },
      { label: 'Every rupee is tracked against a category budget', score: 5 },
    ],
  },
  {
    id: 'Q7',
    category: 'Expenses',
    text: 'How do you meet the lumpy annual bills — festivals, school fees, insurance premiums, a family wedding?',
    options: [
      { label: 'On the credit card, or with a personal loan', score: 0 },
      { label: 'Out of that month’s salary, which leaves it strained', score: 1 },
      { label: 'Partly set aside through the year', score: 3 },
      { label: 'Fully provisioned in an RD or a sweep-in FD', score: 5 },
    ],
  },

  // ---------------- Liabilities (3) ----------------
  {
    id: 'Q8',
    category: 'Liabilities',
    text: 'What is your total monthly EMI outgo across every loan — home, car, personal, consumer durable?',
    options: [
      { label: 'No EMIs at all', score: 8, value: 0 },
      { label: 'Under ₹10,000', score: 6, value: 7000 },
      { label: '₹10,000–₹25,000', score: 4, value: 17500 },
      { label: '₹25,000–₹50,000', score: 2, value: 37500 },
      { label: 'Above ₹50,000', score: 0, value: 80000 },
    ],
  },
  {
    id: 'Q9',
    category: 'Liabilities',
    text: 'How do you handle the credit-card bill?',
    options: [
      { label: 'I revolve a balance most months and pay the interest', score: 0 },
      { label: 'I convert large purchases to card EMIs fairly often', score: 1 },
      { label: 'I carry a balance forward occasionally', score: 3 },
      { label: 'I clear the full statement every month, or use no card', score: 6 },
    ],
  },
  {
    id: 'Q10',
    category: 'Liabilities',
    text: 'Which borrowing is currently outstanding in your name?',
    options: [
      { label: 'A personal loan or credit-card debt', score: 0 },
      { label: 'A gold loan or a consumer-durable loan', score: 1 },
      { label: 'Only a car loan', score: 2 },
      { label: 'Only a home loan — secured, with 80C and 24(b) relief', score: 4 },
      { label: 'No borrowing at all', score: 6 },
    ],
  },

  // ---------------- Savings (4) ----------------
  {
    id: 'Q11',
    category: 'Savings',
    text: 'How many months of household expenses do you already hold as an emergency fund, in a savings account, FD or liquid fund?',
    options: [
      { label: 'None', score: 0, value: 0 },
      { label: 'Less than one month', score: 1, value: 0.5 },
      { label: 'One to three months', score: 3, value: 2 },
      { label: 'Three to six months', score: 5, value: 4.5 },
      { label: 'More than six months', score: 7, value: 9 },
    ],
  },
  {
    id: 'Q12',
    category: 'Savings',
    text: 'What share of take-home pay do you actually save or invest each month?',
    options: [
      { label: 'Nothing is left over', score: 0 },
      { label: 'Under 10%', score: 2 },
      { label: '10–20%', score: 4 },
      { label: '20–35%', score: 6 },
      { label: 'More than 35%', score: 8 },
    ],
  },
  {
    id: 'Q13',
    category: 'Savings',
    text: 'How do you use the Section 80C limit?',
    options: [
      { label: 'I am not sure what Section 80C covers', score: 0 },
      { label: 'Only the EPF my employer deducts', score: 2 },
      { label: 'EPF plus PPF or an LIC endowment policy', score: 3 },
      { label: '80C filled with ELSS and PPF, plus NPS under 80CCD(1B)', score: 5 },
    ],
  },
  {
    id: 'Q14',
    category: 'Savings',
    text: 'How automatic is your saving?',
    options: [
      { label: 'No standing arrangement — I invest whatever is left, when it is left', score: 0 },
      { label: 'An RD, or one FD booked near the end of the financial year', score: 2 },
      { label: 'One mutual-fund SIP, paused now and then', score: 4 },
      { label: 'Several SIPs on auto-debit, stepped up every year', score: 6 },
    ],
  },

  // ---------------- Investment Experience (3) ----------------
  {
    id: 'Q15',
    category: 'Investment Experience',
    text: 'How long have you been investing outside a bank account?',
    options: [
      { label: 'Never have — savings account and FD only', score: 0, value: 0 },
      { label: 'Less than 2 years', score: 2, value: 1 },
      { label: '2 to 5 years', score: 4, value: 3.5 },
      { label: '5 to 10 years', score: 5, value: 7 },
      { label: 'More than 10 years', score: 6, value: 12 },
    ],
  },
  {
    id: 'Q16',
    category: 'Investment Experience',
    text: 'Which of these do you already hold?',
    options: [
      { label: 'FD, RD and a savings account', score: 0 },
      { label: 'Also gold, or a LIC endowment policy', score: 1 },
      { label: 'Also PPF or NPS, and mutual-fund SIPs', score: 3 },
      { label: 'A demat account with direct equity holdings', score: 5 },
      { label: 'Equity plus derivatives, unlisted shares or crypto', score: 6 },
    ],
  },
  {
    id: 'Q17',
    category: 'Investment Experience',
    text: 'How comfortable are you reading a mutual-fund factsheet?',
    options: [
      { label: 'I would need someone to walk me through it', score: 0 },
      { label: 'I follow the NAV and not much else', score: 2 },
      { label: 'I compare expense ratio, category and rolling returns', score: 4 },
      { label: 'I read annual reports and rebalance my own allocation', score: 5 },
    ],
  },

  // ---------------- Risk Appetite (3) ----------------
  {
    id: 'Q18',
    category: 'Risk Appetite',
    text: 'When will you need the money you are investing now?',
    options: [
      { label: 'Within a year — it is already earmarked', score: 0, value: 1 },
      { label: 'In 1 to 3 years', score: 2, value: 2 },
      { label: 'In 3 to 7 years', score: 4, value: 5 },
      { label: 'In 7 to 15 years', score: 6, value: 10 },
      { label: 'More than 15 years away — retirement', score: 8, value: 20 },
    ],
  },
  {
    id: 'Q19',
    category: 'Risk Appetite',
    text: 'Your portfolio falls 20% in a single quarter. What do you do?',
    options: [
      { label: 'Sell everything and move it to an FD', score: 0 },
      { label: 'Pause the SIPs until the market settles', score: 2 },
      { label: 'Hold, and change nothing', score: 4 },
      { label: 'Keep the SIPs running exactly as planned', score: 6 },
      { label: 'Add a lump sum while units are cheap', score: 8 },
    ],
  },
  {
    id: 'Q20',
    category: 'Risk Appetite',
    text: 'Which statement fits you best?',
    options: [
      { label: 'Capital must not fall, even if returns trail inflation', score: 0 },
      { label: 'A small dip is acceptable for a little more than FD returns', score: 2 },
      { label: 'Moderate swings are fine for an inflation-beating return', score: 4 },
      { label: 'Large swings are fine — I am investing for long-term growth', score: 6 },
      { label: 'Maximum growth; a 30% drawdown would not change my plan', score: 8 },
    ],
  },
]

/** FR-QUIZ-05 copy. `scoreRange` is inclusive on both ends. */
export const RISK_MODES = {
  Conservative: {
    label: 'Conservative',
    blurb:
      'Capital protection comes first. The blueprint leans on the emergency fund, FD/RD and PPF, with only a small equity SIP once the safety net is full.',
    scoreRange: [0, 33],
  },
  Balanced: {
    label: 'Balanced',
    blurb:
      'Growth, but with a floor under it. The blueprint splits between debt instruments and equity SIPs, keeping six months of expenses liquid.',
    scoreRange: [34, 66],
  },
  Aggressive: {
    label: 'Aggressive',
    blurb:
      'Long-horizon growth is the priority. The blueprint tilts heavily to equity SIPs and direct equity, accepting deep drawdowns along the way.',
    scoreRange: [67, 100],
  },
}

// Which question establishes which profile fact.
const FIELD_Q = {
  monthlyIncome: 'Q1',
  dependents: 'Q3',
  monthlyExpenses: 'Q4',
  emiLoad: 'Q8',
  emergencyMonths: 'Q11',
  horizonYears: 'Q18',
}

const MIN_RAW = QUESTIONS.reduce((s, q) => s + Math.min(...q.options.map((o) => o.score)), 0)
const MAX_RAW = QUESTIONS.reduce((s, q) => s + Math.max(...q.options.map((o) => o.score)), 0)

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n))
const nonNeg = (v) => (Number.isFinite(+v) ? Math.max(0, +v) : 0)

/** FR-QUIZ-03: reduce the 20 responses to a score, a mode and the household
 *  facts the Budget Blueprint divides by. A missing or out-of-range answer
 *  falls back to option 0, so a sparse array never throws. */
export function deriveRiskMode(answers) {
  const pick = {}
  let raw = 0
  for (let i = 0; i < QUESTIONS.length; i += 1) {
    const q = QUESTIONS[i]
    const given = answers?.[i]
    const idx = Number.isInteger(given) && given >= 0 && given < q.options.length ? given : 0
    pick[q.id] = q.options[idx]
    raw += pick[q.id].score
  }

  const fact = (field) => nonNeg(pick[FIELD_Q[field]].value)

  // Every figure below is finite and >= 0; income is forced > 0 because the
  // Blueprint divides by it.
  const monthlyIncome = Math.max(1, Math.round(fact('monthlyIncome')))
  const monthlyExpenses = Math.round(Math.min(fact('monthlyExpenses'), 0.95 * monthlyIncome))
  const emiLoad = Math.round(Math.min(fact('emiLoad'), 0.6 * monthlyIncome))
  const dependents = Math.round(fact('dependents'))
  const emergencyMonths = fact('emergencyMonths')
  const horizonYears = fact('horizonYears')

  const emiRatio = emiLoad / monthlyIncome
  const surplusRatio = (monthlyIncome - monthlyExpenses - emiLoad) / monthlyIncome

  // Normalise the raw risk contribution onto 0..100, then dock it for the
  // household stresses that make equity exposure unwise regardless of appetite.
  const base = ((raw - MIN_RAW) / (MAX_RAW - MIN_RAW)) * 100
  let penalty = 0
  if (emiRatio > 0.4) penalty += 18
  else if (emiRatio > 0.25) penalty += 9
  if (emergencyMonths < 1) penalty += 15
  else if (emergencyMonths < 3) penalty += 7
  if (surplusRatio < 0.1) penalty += 10
  if (dependents >= 3) penalty += 6

  const score = clamp(Math.round(base - penalty), 0, 100)

  let mode = score < 34 ? 'Conservative' : score > 66 ? 'Aggressive' : 'Balanced'

  // Indian-household safety rule, applied after the bands and deliberately
  // overriding a high appetite: a family servicing EMIs above 40% of take-home
  // pay, or with under a month of expenses in hand, has no capacity to sit
  // through an equity drawdown -- one missed EMI or one hospital bill forces a
  // sale at the bottom. Such a profile is capped at Balanced however the
  // questions were answered.
  if (mode === 'Aggressive' && (emiRatio > 0.4 || emergencyMonths < 1)) mode = 'Balanced'

  return {
    score,
    mode,
    profile: { monthlyIncome, monthlyExpenses, emiLoad, dependents, emergencyMonths, horizonYears },
  }
}

