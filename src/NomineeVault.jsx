import { useEffect, useRef, useState } from 'react'
import {
  DEFAULT_VAULT,
  INACTIVITY_DAYS,
  buildAssetLines,
  formatCountdown,
  mailtoHref,
  renderEmail,
} from './lib/vault.js'
import { CRYPTO_PARAMS, openVault, sealVault } from './lib/crypto.js'
import './NomineeVault.css'

const DAY_MS = 24 * 60 * 60 * 1000

// R-06: a real pattern check, not a presence check. The recipient address is
// the only thing between this vault and mailing a stranger, so it is validated
// before Preview, Simulate and Open Draft Mail are reachable at all.
const EMAIL_RE = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/

const PLACEHOLDERS = ['recipientName', 'recipientEmail', 'assetList', 'customMessage', 'date', 'inactivityDays']

const KIND_LABEL = { PREVIEW: 'Preview only', SIMULATED: 'Simulated dispatch', AUTO: 'Automatic dispatch' }

// ISO -> '2026-09-13 04:21:07 UTC'. Deliberately not toLocaleString: the
// dispatch log is evidence, so it reads the same on every machine.
const stamp = (iso) => `${String(iso ?? '').replace('T', ' ').slice(0, 19)} UTC`

export default function NomineeVault({ vault, onChange, accounts, deadline, onClose }) {
  // A vault rehydrated from an older sessionStorage shape still has to render.
  const v = { ...DEFAULT_VAULT, ...(vault || {}) }
  const dispatches = Array.isArray(v.dispatches) ? v.dispatches.filter(Boolean) : []

  const [nowTs, setNowTs] = useState(() => Date.now())
  const [shown, setShown] = useState(null) // { kind, to, subject, body }
  const [notice, setNotice] = useState('')
  const panelRef = useRef(null)
  const autoRef = useRef(false)

  // AES-256-GCM sealing of the disclosure payload. The passphrase lives in
  // component state for the length of the interaction and is never persisted,
  // never logged, and never placed in the vault object.
  const [passphrase, setPassphrase] = useState('')
  const [sealed, setSealed] = useState(null)
  const [opened, setOpened] = useState('')
  const [cryptoError, setCryptoError] = useState('')
  const [working, setWorking] = useState(false)

  // FR-NV-03: exactly one 1000ms interval, cleared on unmount.
  useEffect(() => {
    const id = setInterval(() => setNowTs(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  // Accessibility: the dialog takes focus on mount, Escape dismisses it.
  useEffect(() => {
    panelRef.current?.focus()
  }, [])

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const recipientName = v.recipientName.trim()
  const recipientEmail = v.recipientEmail.trim()
  const nameError = recipientName ? '' : 'A recipient name is required before this vault can dispatch anything.'
  const emailError = !recipientEmail
    ? 'A recipient email is required before this vault can dispatch anything.'
    : EMAIL_RE.test(recipientEmail)
      ? ''
      : `"${recipientEmail}" is not a valid email address. Use the form name@example.com.`
  const ready = !nameError && !emailError

  const msLeft = deadline == null ? INACTIVITY_DAYS * DAY_MS : deadline - nowTs
  const expired = deadline != null && msLeft <= 0
  const daysLeft = Math.max(0, Math.ceil(msLeft / DAY_MS))

  const autoRecord = dispatches.find((d) => d.kind === 'AUTO')
  const accountLines = buildAssetLines(accounts)
  const linkedCount = Array.isArray(accounts) ? accounts.length : 0
  const draft = renderEmail({ vault: v, accounts, now: nowTs })

  // FR-NV-10: dispatch once, the moment the countdown hits zero.
  // Three guards, because one is not enough: `autoRecord` is read from the
  // sessionStorage-backed vault so a remount (or a StrictMode double mount)
  // sees the earlier send, `autoRef` blocks the next one-second tick before
  // that state lands, and the updater below re-checks `prev` so two concurrent
  // calls still append a single record.
  //
  // ponytail: client-side dead-man's switch -- it only fires while this tab is
  // open, so a user who closes the browser is never mailed. Ceiling accepted
  // for v1.0 (PRD R-01, R-02); Phase 2 moves the trigger to a server cron with
  // Nodemailer/SendGrid, at which point this effect deletes itself.
  useEffect(() => {
    if (!expired || !ready || autoRecord || autoRef.current) return
    autoRef.current = true

    const at = nowTs
    const mail = renderEmail({ vault: v, accounts, now: at })
    const record = { at: new Date(at).toISOString(), kind: 'AUTO', ...mail }

    onChange((prev) => {
      const list = Array.isArray(prev?.dispatches) ? prev.dispatches.filter(Boolean) : []
      if (list.some((d) => d.kind === 'AUTO')) return prev
      return { ...DEFAULT_VAULT, ...prev, dispatches: [...list, record] }
    })
    setShown({ kind: 'AUTO', ...mail })
    setNotice(`Inactivity protocol fired. The asset summary was dispatched to ${mail.to}.`)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fires on the edge only
  }, [expired, ready, autoRecord])

  // Every edit goes straight back up to App, which persists it (FR-NV-12).
  const edit = (key) => (e) => {
    const value = e.target.value
    onChange((prev) => ({ ...DEFAULT_VAULT, ...prev, [key]: value }))
  }

  function fillFromAccounts() {
    onChange((prev) => ({ ...DEFAULT_VAULT, ...prev, assetList: accountLines }))
    setNotice(
      accountLines
        ? `Asset list filled from ${linkedCount} linked account${linkedCount === 1 ? '' : 's'}.`
        : 'There are no linked accounts yet, so there was nothing to fill in.',
    )
  }

  function restoreTemplate() {
    onChange((prev) => ({
      ...DEFAULT_VAULT,
      ...prev,
      subject: DEFAULT_VAULT.subject,
      template: DEFAULT_VAULT.template,
    }))
    setNotice('Default subject line and body template restored.')
  }

  async function handleSeal() {
    setCryptoError('')
    setOpened('')
    setWorking(true)
    try {
      const mail = renderEmail({ vault: v, accounts, now: Date.now() })
      setSealed(await sealVault(mail.body, passphrase))
    } catch (err) {
      setSealed(null)
      setCryptoError(err.message)
    } finally {
      setWorking(false)
    }
  }

  async function handleOpen() {
    setCryptoError('')
    setWorking(true)
    try {
      setOpened(await openVault(sealed, passphrase))
    } catch (err) {
      setOpened('')
      setCryptoError(err.message)
    } finally {
      setWorking(false)
    }
  }

  function previewEmail() {
    setShown({ kind: 'PREVIEW', ...renderEmail({ vault: v, accounts, now: Date.now() }) })
    setNotice('Preview rendered below from the current template. Nothing was sent.')
  }

  // FR-NV-08: the real dispatch path, minus the wait.
  function simulateTrigger() {
    const at = Date.now()
    const mail = renderEmail({ vault: v, accounts, now: at })
    onChange((prev) => {
      const list = Array.isArray(prev?.dispatches) ? prev.dispatches.filter(Boolean) : []
      return { ...DEFAULT_VAULT, ...prev, dispatches: [...list, { at: new Date(at).toISOString(), kind: 'SIMULATED', ...mail }] }
    })
    setShown({ kind: 'SIMULATED', ...mail })
    setNotice(`Simulated dispatch recorded for ${mail.to}. No email left this machine.`)
  }

  return (
    <div className="overlay">
      <section
        className="panel nv"
        role="dialog"
        aria-modal="true"
        aria-labelledby="nv-title"
        tabIndex={-1}
        ref={panelRef}
      >
        <header className="panel__head">
          <div className="nv__head-text">
            <h2 className="panel__title" id="nv-title">
              Nominee Vault
              <span className="badge badge--secure">Settings</span>
              {autoRecord ? (
                <span className="badge badge--danger">Dispatched</span>
              ) : (
                <span className="badge badge--warn">Armed</span>
              )}
            </h2>
            {/* FR-NV-02: the protocol sentence, with the live recipient name. */}
            <p className="panel__sub">
              {`after ${INACTIVITY_DAYS} days without login, ${recipientName || '[Recipient Name]'} receives your asset summary email.`}
            </p>
          </div>
          <div className="panel__actions">
            <button type="button" className="btn btn--ghost btn--sm" aria-label="Close Settings" onClick={onClose}>
              x
            </button>
          </div>
        </header>

        <div className="panel__body">
          {autoRecord && (
            <div className="nv__fired" role="status">
              <strong>Inactivity protocol fired.</strong> The asset summary was dispatched to{' '}
              <span className="kv__v">{autoRecord.to}</span> at {stamp(autoRecord.at)}. It will not fire again for this
              session.
            </div>
          )}

          {/* FR-NV-03 / FR-NV-04 */}
          <div className="nv__clock">
            <div className="nv__clock-k">Inactivity countdown</div>
            <div className="nv__clock-v" role="timer" aria-live="off">
              {formatCountdown(msLeft)}
            </div>
            <p className="field__hint" aria-live="polite">
              {deadline == null
                ? `The ${INACTIVITY_DAYS}-day window starts at your next login.`
                : expired
                  ? 'The inactivity window has elapsed.'
                  : `Approximately ${daysLeft} ${daysLeft === 1 ? 'day remains' : 'days remain'} before the nominee email is dispatched.`}
            </p>
            <p className="field__hint">
              Every successful login restarts the {INACTIVITY_DAYS}-day window, so this countdown returns to{' '}
              <span className="tag">{formatCountdown(INACTIVITY_DAYS * DAY_MS)}</span> each time you sign in.
            </p>
          </div>

          <p className="nv__notice" aria-live="polite">
            {notice}
          </p>

          {/* FR-NV-05 */}
          <div className="grid-2">
            <div className="field">
              <label className="field__label" htmlFor="nv-name">
                Recipient Name
              </label>
              <input
                id="nv-name"
                type="text"
                autoComplete="off"
                placeholder="Asha Rao"
                value={v.recipientName}
                onChange={edit('recipientName')}
                aria-invalid={nameError ? 'true' : 'false'}
                aria-describedby={nameError ? 'nv-name-err' : undefined}
              />
              {nameError && (
                <p className="field__error" id="nv-name-err" role="alert">
                  {nameError}
                </p>
              )}
            </div>

            <div className="field">
              <label className="field__label" htmlFor="nv-email">
                Recipient Email
              </label>
              <input
                id="nv-email"
                type="email"
                autoComplete="off"
                placeholder="asha@example.com"
                value={v.recipientEmail}
                onChange={edit('recipientEmail')}
                aria-invalid={emailError ? 'true' : 'false'}
                aria-describedby={emailError ? 'nv-email-err' : undefined}
              />
              {emailError && (
                <p className="field__error" id="nv-email-err" role="alert">
                  {emailError}
                </p>
              )}
            </div>
          </div>

          <div className="field">
            <div className="nv__field-head">
              <label className="field__label" htmlFor="nv-assets">
                Asset List
              </label>
              {/* FR-NV-11 */}
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={fillFromAccounts}
                disabled={!accountLines}
              >
                Use my linked accounts
              </button>
            </div>
            <textarea
              id="nv-assets"
              rows={5}
              value={v.assetList}
              onChange={edit('assetList')}
              placeholder={accountLines || 'One asset per line.'}
            />
            <p className="field__hint">
              {linkedCount === 0
                ? 'No linked accounts yet. Anything you type here is what the email carries.'
                : `Leave this empty and the email uses your ${linkedCount} linked account${linkedCount === 1 ? '' : 's'} automatically.`}
            </p>
          </div>

          <div className="field">
            <label className="field__label" htmlFor="nv-message">
              Custom Message
            </label>
            <textarea
              id="nv-message"
              rows={3}
              value={v.customMessage}
              onChange={edit('customMessage')}
              placeholder="Anything the recipient should know first."
            />
          </div>

          <hr className="sep" />

          {/* FR-NV-06 */}
          <div className="stack">
            <div className="nv__field-head">
              <h3 className="panel__title" id="nv-template-head">
                Email Template
              </h3>
              <button type="button" className="btn btn--ghost btn--sm" onClick={restoreTemplate}>
                Restore default template
              </button>
            </div>
            <div className="nv__tags">
              {PLACEHOLDERS.map((key) => (
                <span className="tag" key={key}>{`{{${key}}}`}</span>
              ))}
            </div>
            <p className="field__hint">
              These are substituted when the email is rendered. Anything else in double braces is left exactly as typed,
              so a misspelled placeholder shows up in the preview instead of silently vanishing.
            </p>

            <div className="field">
              <label className="field__label" htmlFor="nv-subject">
                Subject Line
              </label>
              <input id="nv-subject" type="text" value={v.subject} onChange={edit('subject')} />
            </div>

            <div className="field">
              <label className="field__label" htmlFor="nv-template">
                Body Template
              </label>
              <textarea
                id="nv-template"
                className="nv__template"
                rows={12}
                value={v.template}
                onChange={edit('template')}
                spellCheck="false"
              />
            </div>
          </div>

          <hr className="sep" />

          <div className="row">
            {/* FR-NV-07, FR-NV-08, FR-NV-09 -- all three gated on a valid recipient. */}
            <button type="button" className="btn btn--primary" onClick={previewEmail} disabled={!ready}>
              Preview Email
            </button>
            <button type="button" className="btn" onClick={simulateTrigger} disabled={!ready}>
              Simulate 48-Day Trigger
            </button>
            <a
              className="btn nv__draft"
              href={ready ? mailtoHref(draft) : undefined}
              aria-disabled={ready ? 'false' : 'true'}
              onClick={(e) => {
                if (!ready) e.preventDefault()
              }}
            >
              Open Draft Mail
            </a>
          </div>
          <p className="field__hint">
            {ready
              ? 'v1.0 sends nothing over SMTP. Simulate 48-Day Trigger records the dispatch and renders the email; Open Draft Mail hands the same letter to your default mail client through the mailto: protocol, where you press send.'
              : 'Fill in a recipient name and a valid recipient email to enable Preview Email, Simulate 48-Day Trigger and Open Draft Mail.'}
          </p>

          {shown && (
            <div className="nv__mail">
              <div className="nv__mail-head">
                <span className={`badge ${shown.kind === 'PREVIEW' ? 'badge--muted' : 'badge--ok'}`}>
                  {KIND_LABEL[shown.kind]}
                </span>
                {shown.kind !== 'PREVIEW' && <span className="badge badge--warn">No SMTP send in v1.0</span>}
              </div>
              <div className="kv">
                <span className="kv__k">To</span>
                <span className="kv__v">{shown.to}</span>
              </div>
              <div className="kv">
                <span className="kv__k">Subject</span>
                <span className="kv__v">{shown.subject}</span>
              </div>
              <hr className="sep" />
              <pre className="nv__body">{shown.body}</pre>
            </div>
          )}

          <hr className="sep" />

          <h3 className="panel__title">
            Sealed Disclosure
            <span className="badge badge--secure">{CRYPTO_PARAMS.algorithm}</span>
          </h3>
          <p className="field__hint">
            Encrypts the disclosure body with {CRYPTO_PARAMS.algorithm}, under a key derived from your
            passphrase by {CRYPTO_PARAMS.kdf} at {CRYPTO_PARAMS.iterations.toLocaleString('en-IN')} iterations.
            A fresh salt and IV are generated on every seal. The passphrase is never stored, never logged and
            never leaves this tab — which also means FinNexus cannot open the vault for your nominee. Getting
            the passphrase to them is a separate problem this build does not solve.
          </p>

          <div className="field">
            <label className="field__label" htmlFor="nv-pass">Vault passphrase</label>
            <input
              id="nv-pass"
              type="password"
              autoComplete="new-password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              placeholder="Used to derive the key. Not stored."
            />
          </div>

          <div className="row">
            <button
              type="button"
              className="btn btn--primary btn--sm"
              onClick={handleSeal}
              disabled={!passphrase || working}
            >
              {working ? 'Working…' : 'Seal Disclosure'}
            </button>
            <button
              type="button"
              className="btn btn--sm"
              onClick={handleOpen}
              disabled={!sealed || !passphrase || working}
            >
              Open Sealed Copy
            </button>
          </div>

          {cryptoError && <p className="field__error" role="alert">{cryptoError}</p>}

          <div aria-live="polite">
            {sealed && (
              <div className="nv__mail">
                <div className="nv__mail-head">
                  <span className="badge badge--secure">Sealed</span>
                  <span className="tag">{sealed.sealedBytes} bytes</span>
                </div>
                <div className="kv">
                  <span className="kv__k">Cipher</span>
                  <span className="kv__v">{sealed.alg}</span>
                </div>
                <div className="kv">
                  <span className="kv__k">Key derivation</span>
                  <span className="kv__v">{sealed.kdf} × {sealed.iterations.toLocaleString('en-IN')}</span>
                </div>
                <div className="kv">
                  <span className="kv__k">Salt</span>
                  <span className="kv__v">{sealed.salt}</span>
                </div>
                <div className="kv">
                  <span className="kv__k">IV</span>
                  <span className="kv__v">{sealed.iv}</span>
                </div>
                <hr className="sep" />
                <pre className="nv__body">{sealed.ciphertext}</pre>
              </div>
            )}

            {opened && (
              <div className="nv__mail">
                <div className="nv__mail-head">
                  <span className="badge badge--ok">Opened — round trip verified</span>
                </div>
                <pre className="nv__body">{opened}</pre>
              </div>
            )}
          </div>

          <hr className="sep" />

          <h3 className="panel__title">Dispatch History</h3>
          {dispatches.length === 0 ? (
            <p className="empty">
              Nothing dispatched yet. The vault stays armed until the countdown reaches zero, or until you simulate the
              trigger.
            </p>
          ) : (
            <ul className="nv__log">
              {dispatches
                .slice()
                .reverse()
                .map((d, i) => (
                  <li className="nv__log-row" key={`${d.at}-${i}`}>
                    <span className="kv__k">{stamp(d.at)}</span>
                    <span className={`badge ${d.kind === 'AUTO' ? 'badge--danger' : 'badge--warn'}`}>{d.kind}</span>
                    <span className="kv__v nv__log-to">{d.to}</span>
                  </li>
                ))}
            </ul>
          )}

          {/* FR-NV-12 */}
          <p className="field__hint">
            Every field above is saved to this session as you type, so closing Settings loses nothing. Nominee details
            stay on this device and are never logged.
          </p>
        </div>
      </section>
    </div>
  )
}
