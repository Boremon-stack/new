// Indian numbering system (lakh / crore grouping) via the platform formatter.
const whole = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })

export const inr = (n) => whole.format(Number.isFinite(+n) ? +n : 0)
export const pct = (n) => `${Math.round(Number.isFinite(+n) ? +n : 0)}%`
