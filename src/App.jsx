import { useRef, useState } from 'react'
import { useSession } from './lib/useSession.js'
import Login from './Login.jsx'
import Accounts from './Accounts.jsx'
import Portfolio from './Portfolio.jsx'
import Quiz from './Quiz.jsx'
import Blueprint from './Blueprint.jsx'
import Liquidity from './Liquidity.jsx'
import Brain from './Brain.jsx'
import TaxOptimizer from './TaxOptimizer.jsx'
import MLLab from './MLLab.jsx'
import NomineeVault from './NomineeVault.jsx'
import { DEFAULT_VAULT } from './lib/vault.js'

export const INACTIVITY_DAYS = 48
export const INACTIVITY_MS = INACTIVITY_DAYS * 24 * 60 * 60 * 1000

const SECTIONS = [
  { id: 'connections', label: 'Accounts' },
  { id: 'portfolio', label: 'Portfolio' },
  { id: 'quiz', label: 'Risk Profile' },
  { id: 'blueprint', label: 'Budget' },
  { id: 'liquidity', label: 'Liquidity' },
  { id: 'brain', label: 'Forecast' },
  { id: 'tax', label: 'Tax' },
  { id: 'mllab', label: 'Model' },
]

export default function App() {
  const [session, setSession] = useSession('fx.session', null)
  const [accounts, setAccounts] = useSession('fx.accounts', [])
  const [holdings, setHoldings] = useSession('fx.holdings', [])
  const [obligations, setObligations] = useSession('fx.obligations', [])
  const [quiz, setQuiz] = useSession('fx.quiz', null)
  const [vault, setVault] = useSession('fx.vault', DEFAULT_VAULT)
  const [deadline, setDeadline] = useSession('fx.deadline', null)
  const [settingsOpen, setSettingsOpen] = useState(false)

  // One panel at a time. Seven at once reads as clutter, and nothing here needs
  // to be seen side by side -- each module is a self-contained answer.
  const [active, setActive] = useSession('fx.tab', SECTIONS[0].id)
  const tabsRef = useRef(null)

  // FR-NV-04, UC-01 postcondition: a successful login restarts the 48-day window.
  function handleAuth(loginId) {
    setSession({ loginId, loginAt: new Date().toISOString() })
    setDeadline(Date.now() + INACTIVITY_MS)
  }

  function signOut() {
    setSettingsOpen(false)
    setSession(null)
  }

  // The ARIA tabs pattern moves between tabs with arrow keys, not Tab, so the
  // whole bar is one stop in the tab order.
  function onTabKeyDown(event) {
    const step = { ArrowRight: 1, ArrowLeft: -1, Home: 'first', End: 'last' }[event.key]
    if (step === undefined) return
    event.preventDefault()
    const i = SECTIONS.findIndex((s) => s.id === active)
    const next =
      step === 'first' ? 0
      : step === 'last' ? SECTIONS.length - 1
      : (i + step + SECTIONS.length) % SECTIONS.length
    setActive(SECTIONS[next].id)
    const node = tabsRef.current?.querySelector(`#tab-${SECTIONS[next].id}`)
    if (node) node.focus()
  }

  // FR-AUTH-05: the Control Center is unreachable without an authenticated session.
  if (!session) return <Login onAuth={handleAuth} />

  const panels = {
    connections: (
      <Accounts
        accounts={accounts}
        onAdd={(account) => setAccounts((list) => [...list, account])}
        onRemove={(id) => setAccounts((list) => list.filter((a) => a.id !== id))}
      />
    ),
    portfolio: (
      <Portfolio
        accounts={accounts}
        holdings={holdings}
        obligations={obligations}
        onAddHolding={(h) => setHoldings((list) => [...list, h])}
        onRemoveHolding={(id) => setHoldings((list) => list.filter((h) => h.id !== id))}
        onAddObligation={(o) => setObligations((list) => [...list, o])}
        onRemoveObligation={(id) => setObligations((list) => list.filter((o) => o.id !== id))}
      />
    ),
    quiz: <Quiz quiz={quiz} onComplete={setQuiz} onRetake={() => setQuiz(null)} />,
    blueprint: <Blueprint quiz={quiz} accounts={accounts} />,
    liquidity: <Liquidity accounts={accounts} obligations={obligations} />,
    brain: <Brain accounts={accounts} obligations={obligations} quiz={quiz} />,
    tax: <TaxOptimizer holdings={holdings} quiz={quiz} />,
    mllab: <MLLab quiz={quiz} />,
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar__brand">
          <span className="logo" aria-hidden="true">FN</span>
          <span>
            <strong>FinNexus</strong>
            <em>Finance Studio</em>
          </span>
        </div>
        <div className="topbar__right">
          <span className="topbar__user">{session.loginId}</span>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setSettingsOpen(true)}>
            Nominee Vault
          </button>
          <button type="button" className="btn btn--ghost btn--sm" onClick={signOut}>
            Sign out
          </button>
        </div>
      </header>

      <div className="secnav" role="tablist" aria-label="Control Center sections" ref={tabsRef} onKeyDown={onTabKeyDown}>
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            id={`tab-${s.id}`}
            className="secnav__link"
            aria-selected={active === s.id}
            aria-controls={`panel-${s.id}`}
            tabIndex={active === s.id ? 0 : -1}
            onClick={() => setActive(s.id)}
          >
            {s.label}
          </button>
        ))}
      </div>

      <main className="board">
        {SECTIONS.map((s) => (
          <div
            key={s.id}
            role="tabpanel"
            id={`panel-${s.id}`}
            aria-labelledby={`tab-${s.id}`}
            hidden={active !== s.id}
            tabIndex={-1}
          >
            {panels[s.id]}
          </div>
        ))}
      </main>

      <footer className="foot">
        FinNexus — frontend build. Account, holding and transaction data is simulated;
        no live bank, broker or depository connection is made.
      </footer>

      {settingsOpen && (
        <NomineeVault
          vault={vault}
          onChange={setVault}
          accounts={accounts}
          holdings={holdings}
          deadline={deadline}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  )
}
