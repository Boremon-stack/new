import { useState } from 'react'
import { useSession } from './lib/useSession.js'
import Login from './Login.jsx'
import Accounts from './Accounts.jsx'
import Portfolio from './Portfolio.jsx'
import Quiz from './Quiz.jsx'
import Blueprint from './Blueprint.jsx'
import Liquidity from './Liquidity.jsx'
import Brain from './Brain.jsx'
import TaxOptimizer from './TaxOptimizer.jsx'
import NomineeVault from './NomineeVault.jsx'
import { DEFAULT_VAULT } from './lib/vault.js'

export const INACTIVITY_DAYS = 48
export const INACTIVITY_MS = INACTIVITY_DAYS * 24 * 60 * 60 * 1000

const SECTIONS = [
  { id: 'connections', label: 'Connections' },
  { id: 'portfolio', label: 'Portfolio' },
  { id: 'quiz', label: 'Risk Profile' },
  { id: 'blueprint', label: 'Blueprint' },
  { id: 'liquidity', label: 'Liquidity' },
  { id: 'brain', label: 'Financial Brain' },
  { id: 'tax', label: 'Tax Optimizer' },
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

  // FR-NV-04, UC-01 postcondition: a successful login restarts the 48-day window.
  function handleAuth(loginId) {
    setSession({ loginId, loginAt: new Date().toISOString() })
    setDeadline(Date.now() + INACTIVITY_MS)
  }

  function signOut() {
    setSettingsOpen(false)
    setSession(null)
  }

  // FR-AUTH-05: the Control Center is unreachable without an authenticated session.
  if (!session) return <Login onAuth={handleAuth} />

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar__brand">
          <span className="logo" aria-hidden="true">FN</span>
          <span>
            <strong>FinNexus</strong>
            <em>Finance Studio — Control Center</em>
          </span>
        </div>
        <div className="topbar__right">
          <span className="badge badge--ok">Protected session ready.</span>
          <span className="topbar__user">{session.loginId}</span>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setSettingsOpen(true)}>
            Settings
          </button>
          <button type="button" className="btn btn--ghost btn--sm" onClick={signOut}>
            Sign out
          </button>
        </div>
      </header>

      <nav className="secnav" aria-label="Control Center sections">
        {SECTIONS.map((s) => (
          <a key={s.id} className="secnav__link" href={`#${s.id}`}>{s.label}</a>
        ))}
      </nav>

      <main className="board">
        <Accounts
          accounts={accounts}
          onAdd={(account) => setAccounts((list) => [...list, account])}
          onRemove={(id) => setAccounts((list) => list.filter((a) => a.id !== id))}
        />
        <Portfolio
          accounts={accounts}
          holdings={holdings}
          obligations={obligations}
          onAddHolding={(h) => setHoldings((list) => [...list, h])}
          onRemoveHolding={(id) => setHoldings((list) => list.filter((h) => h.id !== id))}
          onAddObligation={(o) => setObligations((list) => [...list, o])}
          onRemoveObligation={(id) => setObligations((list) => list.filter((o) => o.id !== id))}
        />
        <Quiz quiz={quiz} onComplete={setQuiz} onRetake={() => setQuiz(null)} />
        <Blueprint quiz={quiz} accounts={accounts} />
        <Liquidity accounts={accounts} obligations={obligations} />
        <Brain accounts={accounts} obligations={obligations} quiz={quiz} />
        <TaxOptimizer holdings={holdings} quiz={quiz} />
      </main>

      <footer className="foot">
        FinNexus v2.0 — frontend build. Account, holding and transaction data is simulated;
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
