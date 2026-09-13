import { useEffect, useRef } from 'react'
import { useSession } from './lib/useSession.js'
import { inr } from './lib/inr.js'
import { QUESTIONS, RISK_MODES, deriveRiskMode } from './lib/quiz.js'
import './Quiz.css'

const TOTAL = QUESTIONS.length
const BLANK = { answers: Array(TOTAL).fill(null), i: 0 }

// FR-QUIZ-01: the 20-question profiler, one question at a time, inside the
// Control Center. The derived result is handed straight to the Blueprint.
export default function Quiz({ quiz, onComplete, onRetake }) {
  // UC-02 alternate flow: in-progress answers live in sessionStorage, so a
  // refresh mid-quiz resumes on the same question.
  const [draft, setDraft] = useSession('fx.quizDraft', BLANK)
  const resultRef = useRef(null)
  const done = Boolean(quiz)

  // FR-QUIZ-05: move focus to the result so the mode is announced on completion.
  useEffect(() => {
    if (done) resultRef.current?.focus()
  }, [done])

  const answers = Array.isArray(draft?.answers) && draft.answers.length === TOTAL ? draft.answers : BLANK.answers
  const i = Number.isInteger(draft?.i) ? Math.min(Math.max(draft.i, 0), TOTAL - 1) : 0
  const question = QUESTIONS[i]
  const selected = answers[i]
  const answeredAll = answers.every((a) => a !== null && a !== undefined)
  const last = i === TOTAL - 1

  const move = (to) => setDraft({ answers, i: Math.min(Math.max(to, 0), TOTAL - 1) })

  function choose(optionIndex) {
    const next = [...answers]
    next[i] = optionIndex
    setDraft({ answers: next, i })
  }

  // FR-QUIZ-06: submitting the 20th answer derives the mode and publishes it
  // immediately -- the Blueprint generates off this, there is no extra step.
  // The derivation is synchronous arithmetic (NFR-02).
  function submit() {
    onComplete({ ...deriveRiskMode(answers), answers, completedAt: new Date().toISOString() })
    setDraft(null)
  }

  // FR-QUIZ-07
  function retake() {
    setDraft(null)
    onRetake()
  }

  const mode = done ? (RISK_MODES[quiz.mode] ?? RISK_MODES.Balanced) : null
  const p = (done && quiz.profile) || {}
  const surplus = (p.monthlyIncome ?? 0) - (p.monthlyExpenses ?? 0) - (p.emiLoad ?? 0)

  return (
    <section className="panel" id="quiz">
      <div className="panel__head">
        <div>
          <h2 className="panel__title">
            Risk Profile Quiz
            {done ? (
              <span className="badge badge--ok">{mode.label}</span>
            ) : (
              // FR-QUIZ-04
              <span className="badge badge--warn">Mode pending</span>
            )}
          </h2>
          <p className="panel__sub">
            Twenty questions on income, expenses, liabilities, savings habits, experience and appetite — calibrated for
            Indian households, in rupees.
          </p>
        </div>
        {done && (
          <div className="panel__actions">
            <button type="button" className="btn btn--ghost btn--sm" onClick={retake}>
              Retake Quiz
            </button>
          </div>
        )}
      </div>

      <div className="panel__body">
        {done ? (
          <div className="quiz__result">
            <p className="quiz__eyebrow">Derived risk mode</p>
            <h3 className="quiz__mode" tabIndex={-1} ref={resultRef}>
              {mode.label}
            </h3>
            <div className="row">
              <span className="tag">Risk score {quiz.score} / 100</span>
              <span className="tag">
                Band {mode.scoreRange[0]}–{mode.scoreRange[1]}
              </span>
            </div>
            <div className="meter" aria-hidden="true">
              <div className="meter__fill" style={{ width: `${quiz.score}%` }} />
            </div>
            <p className="quiz__blurb">{mode.blurb}</p>

            <div className="grid-2">
              <div className="stat">
                <div className="stat__k">Monthly income</div>
                <div className="stat__v">{inr(p.monthlyIncome)}</div>
              </div>
              <div className="stat">
                <div className="stat__k">Monthly expenses</div>
                <div className="stat__v">{inr(p.monthlyExpenses)}</div>
              </div>
              <div className="stat">
                <div className="stat__k">Monthly EMI outgo</div>
                <div className="stat__v">{inr(p.emiLoad)}</div>
              </div>
            </div>

            <div className="stack quiz__facts">
              <div className="kv">
                <span className="kv__k">Investable surplus</span>
                <span className="kv__v">{inr(surplus)}</span>
              </div>
              <div className="kv">
                <span className="kv__k">Dependents</span>
                <span className="kv__v">{p.dependents ?? 0}</span>
              </div>
              <div className="kv">
                <span className="kv__k">Emergency fund held</span>
                <span className="kv__v">{p.emergencyMonths ?? 0} months</span>
              </div>
              <div className="kv">
                <span className="kv__k">Investment horizon</span>
                <span className="kv__v">{p.horizonYears ?? 0} years</span>
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="quiz__progress">
              <div className="quiz__progress-head">
                <span className="tag">{question.category}</span>
                <span className="quiz__count" aria-live="polite">
                  Question {i + 1} of {TOTAL}
                </span>
              </div>
              <div className="meter" aria-hidden="true">
                <div className="meter__fill" style={{ width: `${((i + 1) / TOTAL) * 100}%` }} />
              </div>
            </div>

            <fieldset className="quiz__card">
              <legend className="quiz__legend">
                <span className="quiz__qid">{question.id}</span>
                {question.text}
              </legend>
              <div className="quiz__options">
                {question.options.map((option, oi) => {
                  const inputId = `${question.id}-${oi}`
                  const on = selected === oi
                  return (
                    <label
                      key={inputId}
                      htmlFor={inputId}
                      className={on ? 'quiz__option quiz__option--on' : 'quiz__option'}
                    >
                      <input
                        className="quiz__radio"
                        type="radio"
                        id={inputId}
                        name={question.id}
                        value={oi}
                        checked={on}
                        onChange={() => choose(oi)}
                      />
                      <span className="quiz__option-text">{option.label}</span>
                    </label>
                  )
                })}
              </div>
            </fieldset>

            <div className="quiz__nav">
              <button type="button" className="btn btn--ghost" onClick={() => move(i - 1)} disabled={i === 0}>
                Back
              </button>
              {last ? (
                <button type="button" className="btn btn--primary" onClick={submit} disabled={!answeredAll}>
                  See my risk mode
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={() => move(i + 1)}
                  disabled={selected === null || selected === undefined}
                >
                  Next
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  )
}
