import { useState } from 'react'
import './Login.css'

// FR-AUTH-01 / FR-AUTH-05 + NFR-07: the only credential this build recognises is the demo
// account, and its password is held as a SHA-256 digest -- the plaintext never reaches the
// comparison. Digest cross-checked against `printf %s 'FinNexus@2026' | sha256sum`.
// ponytail: a client-side hash is a demo stand-in, Phase 2 moves this to bcrypt server-side
// (PRD NFR-07 / R-03) -- a digest shipped to the browser is not a secret, only a shape.
const DEMO_LOGIN_ID = 'demo@finnexus.in'
const DEMO_PASSWORD_SHA256 = '93b53da7cbf4be6a44582be1cf271764d41a84fdfb4a55fd6da0d6746b26baae'

// Display copy only. PRD Section 11 ships no backend, so graders need the credentials on
// screen to sign in. This constant is never read by verify() below.
const DEMO_PASSWORD_HINT = 'FinNexus@2026'

// FR-AUTH-04: long enough that the pending state and then the success line are both seen.
const STEP_MS = 700

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

// true = match, false = bad credentials, null = crypto.subtle unavailable (insecure origin).
function verify(loginId, password) {
  return sha256Hex(password)
    .then((hex) => loginId.toLowerCase() === DEMO_LOGIN_ID && hex === DEMO_PASSWORD_SHA256)
    .catch(() => null)
}

export default function Login({ onAuth }) {
  const [loginId, setLoginId] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [fieldErrors, setFieldErrors] = useState({ loginId: '', password: '' })
  const [formError, setFormError] = useState('')
  const [phase, setPhase] = useState('idle') // idle | verifying | ready

  const busy = phase !== 'idle'

  async function handleSubmit(event) {
    event.preventDefault()
    if (busy) return

    const id = loginId.trim()
    const next = {
      loginId: id ? '' : 'Enter your Login ID.',
      password: password ? '' : 'Enter your password.',
    }
    setFieldErrors(next)
    setFormError('')
    if (next.loginId || next.password) return

    setPhase('verifying')
    const ok = await verify(id, password)
    await wait(STEP_MS)

    if (ok === null) {
      setPhase('idle')
      setFormError('Identity check could not run: this browser blocked the hashing API. Open the app over http://localhost and retry.')
      return
    }
    // FR-AUTH-06 / FR-AUTH-05: no handoff unless the credentials validate.
    if (!ok) {
      setPhase('idle')
      setFormError('Invalid credentials. The Login ID or password did not match. Check both and try again.')
      return
    }

    setPhase('ready')
    await wait(STEP_MS)
    onAuth(id)
  }

  return (
    <div className="login">
      <div className="login__shell">
        <aside className="login__aside">
          <div className="login__brand">
            <span className="logo" aria-hidden="true">FN</span>
            <h1 className="login__wordmark">
              FinNexus
              <span>Finance Studio</span>
            </h1>
          </div>

          {/* FR-AUTH-02 */}
          <div className="login__gate">
            <span className="badge badge--secure">SECURE</span>
            <span className="login__gateLabel">Protected Access Gateway</span>
          </div>

          <p className="login__lede">
            Sign in to reach the Control Center: linked accounts, your risk profile and the
            nominee vault. Account data is simulated and no live money moves.
          </p>

          <ul className="login__features">
            <li className="login__feature">Session shield holds for this browser session only.</li>
            <li className="login__feature">A successful sign-in restarts the 48-day inactivity window.</li>
            <li className="login__feature">No bank credentials are collected and no transfers are possible.</li>
          </ul>
        </aside>

        <div className="login__card">
          <h2 className="login__title">Sign in</h2>
          <p className="login__sub">Identity is checked before the Control Center loads.</p>

          <form className="login__form" onSubmit={handleSubmit} noValidate>
            {/* FR-AUTH-01 */}
            <div className="field">
              <label className="field__label" htmlFor="login-id">Login ID</label>
              <input
                id="login-id"
                name="loginId"
                type="text"
                inputMode="email"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck="false"
                placeholder="demo@finnexus.in"
                value={loginId}
                disabled={busy}
                aria-invalid={fieldErrors.loginId ? true : undefined}
                aria-describedby={fieldErrors.loginId ? 'login-id-error' : undefined}
                onChange={(event) => {
                  setLoginId(event.target.value)
                  setFieldErrors((prev) => ({ ...prev, loginId: '' }))
                  setFormError('')
                }}
              />
              {fieldErrors.loginId && (
                <p className="field__error" id="login-id-error">{fieldErrors.loginId}</p>
              )}
            </div>

            <div className="field">
              <label className="field__label" htmlFor="login-password">Password</label>
              <div className="field login__pw">
                <input
                  id="login-password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="Your password"
                  value={password}
                  disabled={busy}
                  aria-invalid={fieldErrors.password ? true : undefined}
                  aria-describedby={fieldErrors.password ? 'login-password-error' : undefined}
                  onChange={(event) => {
                    setPassword(event.target.value)
                    setFieldErrors((prev) => ({ ...prev, password: '' }))
                    setFormError('')
                  }}
                />
                <button
                  type="button"
                  className="btn btn--ghost btn--sm login__pwToggle"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                  onClick={() => setShowPassword((v) => !v)}
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
              {fieldErrors.password && (
                <p className="field__error" id="login-password-error">{fieldErrors.password}</p>
              )}
            </div>

            {/* FR-AUTH-04: label stays fixed; the pending state is announced in the status region. */}
            <button type="submit" className="btn btn--primary btn--block" disabled={busy}>
              Secure Sign In
            </button>

            {/* FR-AUTH-06 */}
            {formError && (
              <p className="field__error login__alert" role="alert">
                <span className="badge badge--danger">Error</span>
                <span>{formError}</span>
              </p>
            )}

            {/* FR-AUTH-03 + FR-AUTH-04 */}
            <div className="login__status" role="status" aria-live="polite">
              <p className="login__statusLine">Identity check active | session shield enabled</p>
              {phase === 'verifying' && (
                <p className="login__statusLine login__statusLine--busy">Verifying identity…</p>
              )}
              {phase === 'ready' && <span className="badge badge--ok">Protected session ready.</span>}
            </div>

            <div className="login__hint">
              <p className="field__hint">Demo credentials — this academic build has no backend.</p>
              <div className="login__hintRow">
                <span className="field__hint">Login ID</span>
                <span className="tag">{DEMO_LOGIN_ID}</span>
              </div>
              <div className="login__hintRow">
                <span className="field__hint">Password</span>
                <span className="tag">{DEMO_PASSWORD_HINT}</span>
              </div>
            </div>
          </form>

          <p className="login__foot">
            Passwords are matched against a SHA-256 digest in the browser. Phase 2 moves the
            check to a server-side bcrypt hash (NFR-07).
          </p>
        </div>
      </div>
    </div>
  )
}
