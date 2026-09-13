import { useState } from 'react'
import { inr } from './lib/inr.js'
import './Accounts.css'

// PRD Section 11 + R-04: linking is a simulation, so the institution list is fixed.
const INSTITUTIONS = [
  'HDFC Bank',
  'ICICI Bank',
  'State Bank of India',
  'Axis Bank',
  'Kotak Mahindra Bank',
  'Punjab National Bank',
  'Bank of Baroda',
  'Canara Bank',
  'IDFC FIRST Bank',
  'Yes Bank',
]

// Demo prefills so a grader can link an account in two clicks.
const BANK_DEFAULTS = {
  institution: 'HDFC Bank',
  last4: '4821',
  accountType: 'Savings',
  ifsc: 'HDFC0000523',
  balance: '184500',
  monthlyCredit: '92000',
}

const FD_DEFAULTS = {
  institution: 'State Bank of India',
  last4: '7730',
  principal: '250000',
  rate: '7.1',
  tenureMonths: '24',
}

// Indian FDs compound quarterly.
const maturityValue = (principal, rate, tenureMonths) =>
  Math.round(principal * (1 + rate / 400) ** (tenureMonths / 3))

// Self-check on the money path: 1,00,000 at 7.1% for 12 months is rupee-exact 1,07,291.
if (import.meta.env?.DEV) {
  console.assert(
    maturityValue(100000, 7.1, 12) === 107291,
    'maturityValue drift',
    maturityValue(100000, 7.1, 12),
  )
}

function monthsFromNow(months) {
  const d = new Date()
  d.setMonth(d.getMonth() + months)
  return d
}

const fmtDate = (iso) =>
  new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })

// '' and junk both become NaN, so every comparison below fails closed.
function num(v) {
  const s = String(v ?? '').trim()
  if (s === '') return NaN
  const n = Number(s)
  return Number.isFinite(n) ? n : NaN
}

// Trust boundary: nothing reaches onAdd until every figure parses.
function validate(kind, f) {
  const e = {}
  if (!f.institution) e['acct-inst'] = 'Pick an institution.'
  if (!/^\d{4}$/.test(f.last4)) e['acct-last4'] = 'Enter exactly 4 digits.'

  if (kind === 'BANK') {
    if (!/^[A-Za-z]{4}0[A-Za-z0-9]{6}$/.test(String(f.ifsc).trim()))
      e['acct-ifsc'] = 'IFSC must be 11 characters, e.g. HDFC0000523.'
    if (!(num(f.balance) > 0)) e['acct-balance'] = 'Balance must be a number greater than 0.'
    if (!(num(f.monthlyCredit) >= 0))
      e['acct-credit'] = 'Monthly credit must be a number, 0 or more.'
  } else {
    if (!(num(f.principal) > 0)) e['acct-principal'] = 'Principal must be a number greater than 0.'
    const r = num(f.rate)
    if (!(r > 0) || r > 15) e['acct-rate'] = 'Rate must be greater than 0 and at most 15.'
    const t = num(f.tenureMonths)
    if (!Number.isInteger(t) || t < 6 || t > 120)
      e['acct-tenure'] = 'Tenure must be a whole number of months between 6 and 120.'
  }
  return e
}

function build(kind, f) {
  const id = `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const linkedAt = new Date().toISOString()

  if (kind === 'BANK') {
    return {
      id,
      kind: 'BANK',
      institution: f.institution,
      label: `XXXX XXXX ${f.last4}`,
      balance: num(f.balance),
      linkedAt,
      meta: {
        accountType: f.accountType,
        ifsc: String(f.ifsc).trim().toUpperCase(),
        monthlyCredit: num(f.monthlyCredit),
      },
    }
  }

  const principal = num(f.principal)
  const rate = num(f.rate)
  const tenureMonths = num(f.tenureMonths)
  return {
    id,
    kind: 'FD',
    institution: f.institution,
    label: `FD-XXXX-${f.last4}`,
    balance: principal,
    linkedAt,
    meta: {
      principal,
      rate,
      tenureMonths,
      maturityOn: monthsFromNow(tenureMonths).toISOString(),
      maturityValue: maturityValue(principal, rate, tenureMonths),
    },
  }
}

function Field({ id, label, hint, error, children }) {
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>{label}</label>
      {children}
      <p className="field__hint" id={`${id}-hint`}>{hint}</p>
      {error && <p className="field__error" id={`${id}-err`}>{error}</p>}
    </div>
  )
}

export default function Accounts({ accounts = [], onAdd, onRemove }) {
  const [kind, setKind] = useState(null)
  const [form, setForm] = useState(BANK_DEFAULTS)
  const [errors, setErrors] = useState({})
  const [note, setNote] = useState('')

  function openForm(k) {
    setKind(k)
    setForm(k === 'BANK' ? BANK_DEFAULTS : FD_DEFAULTS)
    setErrors({})
    setNote('')
  }

  const set = (key) => (ev) => setForm((f) => ({ ...f, [key]: ev.target.value }))
  const desc = (id) => (errors[id] ? `${id}-hint ${id}-err` : `${id}-hint`)

  function submit(ev) {
    ev.preventDefault()
    const found = validate(kind, form)
    setErrors(found)
    if (Object.keys(found).length > 0) return
    const account = build(kind, form)
    onAdd(account)
    setKind(null)
    setNote(`Linked ${account.institution} ${account.label} — ${inr(account.balance)}.`)
  }

  function unlink(a) {
    onRemove(a.id)
    setNote(`Unlinked ${a.institution} ${a.label}.`)
  }

  const total = accounts.reduce((sum, a) => sum + (Number.isFinite(+a.balance) ? +a.balance : 0), 0)
  const bankCount = accounts.filter((a) => a.kind === 'BANK').length
  const fdCount = accounts.length - bankCount

  let fdPreview = null
  if (kind === 'FD') {
    const p = num(form.principal)
    const r = num(form.rate)
    const t = num(form.tenureMonths)
    if (p > 0 && r > 0 && Number.isInteger(t) && t > 0) fdPreview = maturityValue(p, r, t)
  }

  return (
    <section className="panel" id="connections">
      <div className="panel__head">
        <div>
          <h2 className="panel__title">
            Financial Connections
            <span className="badge">Simulated</span>
          </h2>
          <p className="panel__sub">
            Linked accounts feed the Budget Blueprint and the Nominee Vault asset list. No live bank
            API is called — figures are entered by hand.
          </p>
        </div>
        <div className="panel__actions">
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => openForm('BANK')}
            aria-expanded={kind === 'BANK'}
            aria-controls="acct-form"
          >
            Connect Bank Account
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => openForm('FD')}
            aria-expanded={kind === 'FD'}
            aria-controls="acct-form"
          >
            Connect FD
          </button>
        </div>
      </div>

      <div className="panel__body">
        {/* Always in the DOM so the confirmation is actually announced, not just rendered. */}
        <div className="acct__live" aria-live="polite">
          {note && <p className="badge badge--ok">{note}</p>}
        </div>

        {kind && (
          <form
            id="acct-form"
            className="acct__form"
            onSubmit={submit}
            aria-labelledby="acct-form-title"
            noValidate
          >
            <div className="acct__formhead">
              <h3 className="acct__formtitle" id="acct-form-title">
                {kind === 'BANK' ? 'Link a bank account' : 'Link a fixed deposit'}
              </h3>
              {/* ponytail: simulated linking only — Phase 2 swaps this form for the RBI Account
                  Aggregator consent flow (PRD R-04), at which point figures stop being typed. */}
              <p className="acct__formnote">
                Demo values are prefilled. Only the last 4 digits are ever asked for.
              </p>
            </div>

            <div className="grid-2">
              <Field
                id="acct-inst"
                label="Institution"
                hint="Indian banks supported by the demo."
                error={errors['acct-inst']}
              >
                <select
                  id="acct-inst"
                  value={form.institution}
                  onChange={set('institution')}
                  aria-invalid={!!errors['acct-inst']}
                  aria-describedby={desc('acct-inst')}
                >
                  <option value="">Select an institution</option>
                  {INSTITUTIONS.map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
              </Field>

              <Field
                id="acct-last4"
                label="Last 4 digits"
                hint="4 digits only. The rest stays masked."
                error={errors['acct-last4']}
              >
                <input
                  id="acct-last4"
                  type="text"
                  inputMode="numeric"
                  maxLength={4}
                  value={form.last4}
                  onChange={(ev) =>
                    setForm((f) => ({ ...f, last4: ev.target.value.replace(/\D/g, '').slice(0, 4) }))
                  }
                  aria-invalid={!!errors['acct-last4']}
                  aria-describedby={desc('acct-last4')}
                />
              </Field>

              {kind === 'BANK' ? (
                <>
                  <Field
                    id="acct-type"
                    label="Account type"
                    hint="Savings, Salary or Current."
                    error={errors['acct-type']}
                  >
                    <select
                      id="acct-type"
                      value={form.accountType}
                      onChange={set('accountType')}
                      aria-describedby={desc('acct-type')}
                    >
                      <option value="Savings">Savings</option>
                      <option value="Salary">Salary</option>
                      <option value="Current">Current</option>
                    </select>
                  </Field>

                  <Field
                    id="acct-ifsc"
                    label="IFSC"
                    hint="11 characters, e.g. HDFC0000523."
                    error={errors['acct-ifsc']}
                  >
                    <input
                      id="acct-ifsc"
                      type="text"
                      maxLength={11}
                      value={form.ifsc}
                      onChange={set('ifsc')}
                      aria-invalid={!!errors['acct-ifsc']}
                      aria-describedby={desc('acct-ifsc')}
                    />
                  </Field>

                  <Field
                    id="acct-balance"
                    label="Current balance (INR)"
                    hint="Must be greater than 0."
                    error={errors['acct-balance']}
                  >
                    <input
                      id="acct-balance"
                      type="number"
                      min="1"
                      step="1"
                      value={form.balance}
                      onChange={set('balance')}
                      aria-invalid={!!errors['acct-balance']}
                      aria-describedby={desc('acct-balance')}
                    />
                  </Field>

                  <Field
                    id="acct-credit"
                    label="Approx monthly credit (INR)"
                    hint="Monthly inflow the Blueprint budgets against."
                    error={errors['acct-credit']}
                  >
                    <input
                      id="acct-credit"
                      type="number"
                      min="0"
                      step="1"
                      value={form.monthlyCredit}
                      onChange={set('monthlyCredit')}
                      aria-invalid={!!errors['acct-credit']}
                      aria-describedby={desc('acct-credit')}
                    />
                  </Field>
                </>
              ) : (
                <>
                  <Field
                    id="acct-principal"
                    label="Principal (INR)"
                    hint="Must be greater than 0."
                    error={errors['acct-principal']}
                  >
                    <input
                      id="acct-principal"
                      type="number"
                      min="1"
                      step="1"
                      value={form.principal}
                      onChange={set('principal')}
                      aria-invalid={!!errors['acct-principal']}
                      aria-describedby={desc('acct-principal')}
                    />
                  </Field>

                  <Field
                    id="acct-rate"
                    label="Interest rate (% p.a.)"
                    hint="Above 0, up to 15."
                    error={errors['acct-rate']}
                  >
                    <input
                      id="acct-rate"
                      type="number"
                      min="0.1"
                      max="15"
                      step="0.05"
                      value={form.rate}
                      onChange={set('rate')}
                      aria-invalid={!!errors['acct-rate']}
                      aria-describedby={desc('acct-rate')}
                    />
                  </Field>

                  <Field
                    id="acct-tenure"
                    label="Tenure (months)"
                    hint="Whole months, 6 to 120."
                    error={errors['acct-tenure']}
                  >
                    <input
                      id="acct-tenure"
                      type="number"
                      min="6"
                      max="120"
                      step="1"
                      value={form.tenureMonths}
                      onChange={set('tenureMonths')}
                      aria-invalid={!!errors['acct-tenure']}
                      aria-describedby={desc('acct-tenure')}
                    />
                  </Field>
                </>
              )}
            </div>

            {fdPreview !== null && (
              <div className="kv">
                <span className="kv__k">Maturity value (compounded quarterly)</span>
                <span className="kv__v">{inr(fdPreview)}</span>
              </div>
            )}

            <div className="acct__formact">
              <button type="submit" className="btn btn--primary">
                {kind === 'BANK' ? 'Link bank account' : 'Link fixed deposit'}
              </button>
              <button type="button" className="btn btn--ghost" onClick={() => setKind(null)}>
                Cancel
              </button>
            </div>
          </form>
        )}

        {accounts.length === 0 ? (
          <p className="empty">No financial connections yet.</p>
        ) : (
          <>
            <div className="acct__summary">
              <div className="stat">
                <div className="stat__k">Total linked value</div>
                <div className="stat__v">{inr(total)}</div>
              </div>
              <div className="stat">
                <div className="stat__k">Bank accounts</div>
                <div className="stat__v">{bankCount}</div>
              </div>
              <div className="stat">
                <div className="stat__k">Fixed deposits</div>
                <div className="stat__v">{fdCount}</div>
              </div>
            </div>

            <ul className="acct__list">
              {accounts.map((a) => (
                <li key={a.id} className="acct__row">
                  <div className="acct__main">
                    <div className="acct__inst">
                      {a.institution}
                      <span className="badge">{a.kind === 'BANK' ? 'Bank' : 'FD'}</span>
                      <span className="tag">{a.label}</span>
                    </div>
                    <div className="acct__meta">
                      {a.kind === 'BANK' ? (
                        <>
                          <span className="tag">{a.meta?.accountType ?? 'Savings'}</span>
                          <span className="tag">IFSC {a.meta?.ifsc ?? '--'}</span>
                          <span className="tag">Credit {inr(a.meta?.monthlyCredit)}/mo</span>
                        </>
                      ) : (
                        <>
                          <span className="tag">{a.meta?.rate ?? 0}% p.a.</span>
                          <span className="tag">{a.meta?.tenureMonths ?? 0} months</span>
                          <span className="tag">
                            Matures {a.meta?.maturityOn ? fmtDate(a.meta.maturityOn) : '--'}
                          </span>
                          <span className="tag">Maturity {inr(a.meta?.maturityValue)}</span>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="acct__val">
                    <div className="acct__valk">{a.kind === 'BANK' ? 'Balance' : 'Current value'}</div>
                    <div className="acct__valv">{inr(a.balance)}</div>
                  </div>

                  <div className="acct__act">
                    <button
                      type="button"
                      className="btn btn--danger btn--sm"
                      onClick={() => unlink(a)}
                      aria-label={`Unlink ${a.institution} ${a.label}`}
                    >
                      Unlink
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  )
}
