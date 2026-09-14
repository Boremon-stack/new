import { useEffect, useMemo, useRef, useState } from 'react'
import {
  FEATURES,
  TARGET,
  makeDataset,
  splitDataset,
  standardise,
  createNetwork,
  trainEpochs,
  predict,
  evaluate,
  linearBaseline,
  featureAttribution,
  profileToFeatures,
  histogram,
} from './lib/nn.js'
import './MLLab.css'

/* Architecture and schedule are fixed and stated rather than tunable: the panel
   is about the comparison against the linear baseline, not about knob-twiddling.
   EPOCHS is spent CHUNK at a time, one chunk per animation frame, so the tab
   keeps painting while the network fits. */
const HIDDEN = 8
const LR = 0.03
const BATCH = 16
const EPOCHS = 240
const CHUNK = 20
const TEST_FRAC = 0.25
const BINS = 14
const MINI_BINS = 8
const MAX_POINTS = 400

const num = (v, fallback = 0) => (Number.isFinite(+v) ? +v : fallback)
const safe = (v) => (Number.isFinite(+v) ? +v : null)
const fix = (v, d = 2) => (Number.isFinite(+v) ? (+v).toFixed(d) : '—')
const tally = (v) => (Number.isFinite(+v) ? Math.round(+v).toLocaleString('en-IN') : '—')
const dp = (lo, hi) => {
  const span = Math.abs(num(hi) - num(lo))
  return span >= 50 ? 0 : span >= 5 ? 1 : 2
}

// A feature declared on integer bands (1..5) is binned one bin per band, and its
// ticks are drawn without decimals; anything wider falls back to MINI_BINS.
const banded = (f) => Number.isInteger(num(f?.min, NaN)) && Number.isInteger(num(f?.max, NaN))
const binsFor = (f) => {
  const span = Math.round(num(f?.max) - num(f?.min))
  return banded(f) && span > 0 && span + 1 <= MINI_BINS ? span + 1 : MINI_BINS
}

const BIG = { w: 440, h: 240, l: 50, r: 12, t: 14, b: 30 }
const WIDE = { w: 440, h: 190, l: 50, r: 12, t: 14, b: 30 }
const MINI = { w: 220, h: 112, l: 28, r: 6, t: 8, b: 22 }

/* ------------------------------------------------------------------ charts */

/* Bin counts, drawn with a labelled axis on both sides. Shared by the target
   distribution and the six per-feature minis; only the box changes. */
function Histogram({ bins, box, ariaLabel, tick = 'ml__tick', decimals }) {
  const list = (Array.isArray(bins) ? bins : []).filter(
    (b) => b && Number.isFinite(+b.x0) && Number.isFinite(+b.x1) && Number.isFinite(+b.count),
  )
  if (list.length === 0) return <p className="empty">Nothing to bin yet.</p>

  const maxCount = Math.max(1, ...list.map((b) => +b.count))
  const lo = +list[0].x0
  const hi = +list[list.length - 1].x1
  const span = hi - lo || 1
  const innerW = box.w - box.l - box.r
  const innerH = box.h - box.t - box.b
  const baseY = box.t + innerH
  const X = (v) => box.l + ((v - lo) / span) * innerW
  const Y = (c) => box.t + (1 - c / maxCount) * innerH
  const d = Number.isFinite(+decimals) ? +decimals : dp(lo, hi)

  return (
    <svg className="ml__chart" viewBox={`0 0 ${box.w} ${box.h}`} role="img" aria-label={ariaLabel}>
      {[0, maxCount / 2, maxCount].map((c) => (
        <line
          key={`g${c}`}
          x1={box.l}
          x2={box.w - box.r}
          y1={Y(c)}
          y2={Y(c)}
          stroke="var(--line-soft)"
          strokeWidth="1"
        />
      ))}
      {list.map((b, i) => {
        const x0 = X(+b.x0)
        const w = Math.max(1, X(+b.x1) - x0 - 1)
        const y = Y(+b.count)
        return (
          <rect
            key={`b${i}`}
            x={x0 + 0.5}
            y={y}
            width={w}
            height={Math.max(0, baseY - y)}
            fill="var(--accent)"
            opacity="0.85"
          />
        )
      })}
      <line x1={box.l} x2={box.w - box.r} y1={baseY} y2={baseY} stroke="var(--line)" strokeWidth="1" />
      <line x1={box.l} x2={box.l} y1={box.t} y2={baseY} stroke="var(--line)" strokeWidth="1" />
      {[0, maxCount / 2, maxCount].map((c) => (
        <text key={`yt${c}`} className={tick} x={box.l - 6} y={Y(c) + 4} textAnchor="end">
          {Math.round(c)}
        </text>
      ))}
      {[lo, lo + span / 2, hi].map((v, i) => (
        <text
          key={`xt${i}`}
          className={tick}
          x={X(v)}
          y={baseY + 16}
          textAnchor={i === 0 ? 'start' : i === 2 ? 'end' : 'middle'}
        >
          {v.toFixed(d)}
        </text>
      ))}
    </svg>
  )
}

/* Training and validation loss per epoch. The x domain is the whole run, so the
   curve grows into a fixed frame instead of rescaling on every frame. */
function LossChart({ history, epochs }) {
  const pts = (Array.isArray(history) ? history : []).filter((h) => h && Number.isFinite(+h.trainLoss))
  if (pts.length === 0) return <p className="empty">No loss history yet — press Train.</p>

  const vals = []
  for (const h of pts) {
    vals.push(+h.trainLoss)
    if (Number.isFinite(+h.valLoss)) vals.push(+h.valLoss)
  }
  const peak = Math.max(...vals)
  const top = Number.isFinite(peak) && peak > 0 ? peak * 1.06 : 1
  const innerW = BIG.w - BIG.l - BIG.r
  const innerH = BIG.h - BIG.t - BIG.b
  const baseY = BIG.t + innerH
  const lastEpoch = Math.max(1, epochs)
  const X = (e) => BIG.l + (lastEpoch > 1 ? (Math.min(num(e, 1), lastEpoch) - 1) / (lastEpoch - 1) : 0.5) * innerW
  const Y = (v) => BIG.t + (1 - Math.min(Math.max(num(v), 0), top) / top) * innerH

  const line = (key) =>
    pts
      .filter((h) => Number.isFinite(+h[key]))
      .map((h) => `${X(h.epoch).toFixed(2)},${Y(h[key]).toFixed(2)}`)
      .join(' ')

  const last = pts[pts.length - 1]
  const label =
    `Loss per epoch. Training loss falls from ${fix(pts[0].trainLoss, 4)} at epoch 1 to ` +
    `${fix(last.trainLoss, 4)} at epoch ${tally(last.epoch)} of ${tally(epochs)}` +
    (Number.isFinite(+last.valLoss) ? `, validation loss ${fix(last.valLoss, 4)}.` : '.')

  return (
    <svg className="ml__chart" viewBox={`0 0 ${BIG.w} ${BIG.h}`} role="img" aria-label={label}>
      {[0, 0.25, 0.5, 0.75, 1].map((f) => (
        <line
          key={`g${f}`}
          x1={BIG.l}
          x2={BIG.w - BIG.r}
          y1={Y(top * f)}
          y2={Y(top * f)}
          stroke="var(--line-soft)"
          strokeWidth="1"
        />
      ))}
      <polyline points={line('valLoss')} fill="none" stroke="var(--ink-2)" strokeWidth="1.6" strokeDasharray="6 4" />
      <polyline points={line('trainLoss')} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" />
      <line x1={BIG.l} x2={BIG.w - BIG.r} y1={baseY} y2={baseY} stroke="var(--line)" strokeWidth="1" />
      <line x1={BIG.l} x2={BIG.l} y1={BIG.t} y2={baseY} stroke="var(--line)" strokeWidth="1" />
      {[0, 0.5, 1].map((f) => (
        <text key={`yt${f}`} className="ml__tick" x={BIG.l - 6} y={Y(top * f) + 4} textAnchor="end">
          {(top * f).toFixed(3)}
        </text>
      ))}
      {[1, Math.round(lastEpoch / 2), lastEpoch].map((e, i) => (
        <text
          key={`xt${e}-${i}`}
          className="ml__tick"
          x={X(e)}
          y={baseY + 16}
          textAnchor={i === 0 ? 'start' : i === 2 ? 'end' : 'middle'}
        >
          {e}
        </text>
      ))}
    </svg>
  )
}

/* Predicted against actual on the held-out rows, with the y = x line a perfect
   model would sit on. */
function ScatterChart({ points, unit }) {
  const all = (Array.isArray(points) ? points : []).filter(
    (p) => p && Number.isFinite(+p.actual) && Number.isFinite(+p.predicted),
  )
  if (all.length === 0) return <p className="empty">No test predictions yet.</p>

  const shown = all.slice(0, MAX_POINTS)
  const vals = []
  for (const p of all) {
    vals.push(+p.actual)
    vals.push(+p.predicted)
  }
  const rawLo = Math.min(...vals)
  const rawHi = Math.max(...vals)
  const pad = (rawHi - rawLo) * 0.05 || 1
  const lo = rawLo - pad
  const hi = rawHi + pad
  const span = hi - lo || 1
  const innerW = BIG.w - BIG.l - BIG.r
  const innerH = BIG.h - BIG.t - BIG.b
  const baseY = BIG.t + innerH
  const X = (v) => BIG.l + ((num(v) - lo) / span) * innerW
  const Y = (v) => BIG.t + (1 - (num(v) - lo) / span) * innerH
  const d = dp(lo, hi)
  const ticks = [lo, lo + span / 2, hi]

  const label =
    `Predicted against actual ${unit} for ${tally(all.length)} held-out rows, ` +
    `${tally(shown.length)} of them drawn. Both axes run ${lo.toFixed(d)} to ${hi.toFixed(d)}; ` +
    'the dashed diagonal is the y equals x line a perfect model would lie on.'

  return (
    <svg className="ml__chart" viewBox={`0 0 ${BIG.w} ${BIG.h}`} role="img" aria-label={label}>
      {ticks.map((v) => (
        <line
          key={`g${v}`}
          x1={BIG.l}
          x2={BIG.w - BIG.r}
          y1={Y(v)}
          y2={Y(v)}
          stroke="var(--line-soft)"
          strokeWidth="1"
        />
      ))}
      <line
        x1={X(lo)}
        y1={Y(lo)}
        x2={X(hi)}
        y2={Y(hi)}
        stroke="var(--ink-2)"
        strokeWidth="1.4"
        strokeDasharray="6 4"
      />
      {shown.map((p, i) => (
        <circle key={`p${i}`} cx={X(p.actual)} cy={Y(p.predicted)} r="2.4" fill="var(--accent)" opacity="0.6" />
      ))}
      <line x1={BIG.l} x2={BIG.w - BIG.r} y1={baseY} y2={baseY} stroke="var(--line)" strokeWidth="1" />
      <line x1={BIG.l} x2={BIG.l} y1={BIG.t} y2={baseY} stroke="var(--line)" strokeWidth="1" />
      {ticks.map((v, i) => (
        <text key={`yt${i}`} className="ml__tick" x={BIG.l - 6} y={Y(v) + 4} textAnchor="end">
          {v.toFixed(d)}
        </text>
      ))}
      {ticks.map((v, i) => (
        <text
          key={`xt${i}`}
          className="ml__tick"
          x={X(v)}
          y={baseY + 16}
          textAnchor={i === 0 ? 'start' : i === 2 ? 'end' : 'middle'}
        >
          {v.toFixed(d)}
        </text>
      ))}
    </svg>
  )
}

/* Attribution shares as horizontal bars. Shares are renormalised over what the
   helper returned, so the chart reads the same whether they arrive as fractions
   or as percentages, and can never divide by zero. */
function AttributionChart({ rows }) {
  const list = (Array.isArray(rows) ? rows : []).filter((r) => r && Number.isFinite(+r.share))
  if (list.length === 0) return <p className="empty">Train the network to see its weights.</p>

  const total = list.reduce((s, r) => s + Math.abs(+r.share), 0)
  const frac = (r) => (total > 0 ? Math.abs(+r.share) / total : 0)
  const rowH = 26
  const box = { w: 440, h: 14 + list.length * rowH, l: 168, r: 46, t: 8 }
  const barW = box.w - box.l - box.r
  const top = Math.max(...list.map(frac), 0.0001)

  const label =
    'Share of weight magnitude by input: ' +
    list.map((r) => `${r.label ?? r.key} ${(frac(r) * 100).toFixed(1)} percent`).join(', ') +
    '.'

  return (
    <svg className="ml__chart ml__chart--bars" viewBox={`0 0 ${box.w} ${box.h}`} role="img" aria-label={label}>
      {list.map((r, i) => {
        const y = box.t + i * rowH
        const w = Math.max(1, (frac(r) / top) * barW)
        return (
          <g key={r.key ?? i}>
            <text className="ml__tick" x={0} y={y + 14} textAnchor="start">
              {r.label ?? r.key}
            </text>
            <rect x={box.l} y={y + 4} width={w} height={14} fill="var(--accent)" opacity="0.85" rx="2" />
            <text className="ml__tick" x={box.w - 4} y={y + 14} textAnchor="end">
              {(frac(r) * 100).toFixed(1)}%
            </text>
          </g>
        )
      })}
      <line x1={box.l} x2={box.l} y1={box.t} y2={box.h - 4} stroke="var(--line)" strokeWidth="1" />
    </svg>
  )
}

/* ------------------------------------------------------------------- panel */

export default function MLLab({ quiz }) {
  const profile =
    quiz && typeof quiz === 'object' && quiz.profile && typeof quiz.profile === 'object' ? quiz.profile : null

  const [n, setN] = useState(800)
  const [noise, setNoise] = useState(0.12)
  const [seed, setSeed] = useState(7)

  const [phase, setPhase] = useState('idle')
  const [epoch, setEpoch] = useState(0)
  const [history, setHistory] = useState([])
  const [result, setResult] = useState(null)

  const netRef = useRef(null)
  // Training is scheduled with setTimeout, not requestAnimationFrame. rAF is a
  // paint callback: when the window is occluded or the compositor is idle it
  // stops firing even though document.visibilityState still reads "visible",
  // and the run then hangs at "Training…" forever with no error. setTimeout is
  // throttled in a background tab but never stops, so the run always finishes.
  const rafRef = useRef(0)

  // One memo for the whole data pipeline: regenerating, splitting, standardising
  // and fitting the baseline all key off the same three controls, and keeping
  // them together means every downstream array has a stable identity.
  const prep = useMemo(() => {
    const made = makeDataset({ n, noise, seed })
    const rows = (Array.isArray(made?.rows) ? made.rows : []).filter(
      (r) => r && Array.isArray(r.features) && Number.isFinite(+r.target),
    )
    const parts = splitDataset(rows, { testFrac: TEST_FRAC, seed })
    const train = Array.isArray(parts?.train) ? parts.train : []
    const test = Array.isArray(parts?.test) ? parts.test : []
    return {
      generator: typeof made?.generator === 'string' ? made.generator : '',
      rows,
      train,
      test,
      norm: standardise(train),
      baseline: linearBaseline(train, test),
    }
  }, [n, noise, seed])

  const dist = useMemo(
    () => ({
      target: histogram(prep.rows.map((r) => num(r.target)), BINS),
      // An input declared over a handful of integer bands gets one bin per band;
      // more than that leaves empty bins between the bands and draws a comb.
      features: FEATURES.map((f, i) => histogram(prep.rows.map((r) => num(r.features?.[i])), binsFor(f))),
    }),
    [prep],
  )

  function cancelRun() {
    if (rafRef.current) clearTimeout(rafRef.current)
    rafRef.current = 0
  }

  function resetRun() {
    cancelRun()
    netRef.current = null
    setHistory([])
    setEpoch(0)
    setResult(null)
    setPhase('idle')
  }

  function startTraining() {
    cancelRun()
    const net = createNetwork({ hidden: HIDDEN, seed })
    netRef.current = net
    const hist = []
    setHistory(hist)
    setResult(null)
    setEpoch(0)
    setPhase('training')

    let done = 0
    const tick = () => {
      const chunk = Math.min(CHUNK, EPOCHS - done)
      const run = trainEpochs(net, prep.train, {
        epochs: chunk,
        lr: LR,
        batchSize: BATCH,
        validation: prep.test,
      })
      const slice = Array.isArray(run?.history) ? run.history : []
      slice.forEach((h, i) => {
        hist.push({
          epoch: done + i + 1,
          trainLoss: num(h?.trainLoss, NaN),
          valLoss: num(h?.valLoss, NaN),
        })
      })
      done += chunk
      setHistory(hist.slice())
      setEpoch(done)

      if (done < EPOCHS) {
        rafRef.current = setTimeout(tick, 0)
        return
      }
      rafRef.current = 0
      setResult({
        metrics: evaluate(net, prep.test, prep.norm),
        attribution: featureAttribution(net, prep.norm),
      })
      setPhase('done')
    }
    rafRef.current = setTimeout(tick, 0)
  }

  // A network fitted to the previous dataset says nothing about this one, so
  // changing any data control throws the run away rather than leaving a stale
  // curve on screen.
  useEffect(() => {
    resetRun()
  }, [prep])

  useEffect(() => () => cancelRun(), [])

  const clampFeatures = (arr) =>
    FEATURES.map((f, i) => {
      const lo = num(f.min)
      const hi = num(f.max, lo + 1)
      const raw = Array.isArray(arr) ? +arr[i] : NaN
      const v = Number.isFinite(raw) ? raw : (lo + hi) / 2
      return Math.min(Math.max(v, Math.min(lo, hi)), Math.max(lo, hi))
    })

  const profileFeatures = useMemo(() => clampFeatures(profileToFeatures(profile)), [profile])
  const [tuned, setTuned] = useState(profileFeatures)
  useEffect(() => {
    setTuned(profileFeatures)
  }, [profileFeatures])

  const trained = phase === 'done' && netRef.current !== null
  const profileScore = trained ? safe(predict(netRef.current, profileFeatures, prep.norm)) : null
  const tunedScore = trained ? safe(predict(netRef.current, tuned, prep.norm)) : null
  const delta = profileScore !== null && tunedScore !== null ? tunedScore - profileScore : null

  const base = prep.baseline?.metrics ?? null
  const net = result?.metrics ?? null
  const maeGap = base && net && Number.isFinite(+base.mae) && Number.isFinite(+net.mae) ? +net.mae - +base.mae : null
  const maeGapPct = maeGap !== null && num(base.mae) > 0 ? (Math.abs(maeGap) / num(base.mae)) * 100 : null

  const targetName = TARGET?.label ?? TARGET?.key ?? 'target'
  const progressPct = Math.max(0, Math.min(100, (epoch / EPOCHS) * 100))

  const announcement =
    phase === 'training'
      ? `Training started: ${EPOCHS} epochs over ${tally(prep.train.length)} rows. The epoch counter updates on screen; the result is announced when the run finishes.`
      : phase === 'done' && net
        ? `Training complete after ${tally(EPOCHS)} epochs. On the held-out test set the network scores MAE ${fix(net.mae)} and R² ${fix(net.r2, 3)}; the linear baseline scores MAE ${fix(base?.mae)} and R² ${fix(base?.r2, 3)}.`
        : 'Not trained yet. Press Train to fit the network in this tab.'

  return (
    <section className="panel" id="mllab" aria-labelledby="ml-title">
      <div className="panel__head">
        <div>
          <h2 className="panel__title" id="ml-title">
            ML Lab
            <span className="badge badge--muted">Synthetic data</span>
          </h2>
          <p className="panel__sub">
            A small neural network, written from scratch in this repository and fitted in your browser
            on rows made up by a formula that is printed below. It is a demonstration of the modelling
            pipeline, not a reading of your finances.
          </p>
        </div>
        <div className="panel__actions">
          <span className="tag">
            6 → {HIDDEN} → 1, tanh
          </span>
          <span className="tag">{tally(prep.rows.length)} rows</span>
        </div>
      </div>

      <div className="panel__body">
        {/* ------------------------------------------------- 1. what this is */}
        <h3 className="ml__h">What this is</h3>
        <p className="ml__note">
          Every row the network sees is generated here, from the formula below, plus noise you control.
          None of it comes from your accounts, your holdings or anyone else&apos;s — so nothing the
          network outputs is a claim about a real household, and a good score here means the network
          recovered a formula we already knew, nothing more. The one honest question this panel can
          answer is whether the network beats ordinary least squares on the same held-out rows, and
          section 4 prints that answer whichever way it falls.
        </p>
        <div className="ml__gen">
          <span className="ml__gen-k">Generator the network has to recover</span>
          <code className="ml__gen-v">{prep.generator || 'The data generator reported no formula string.'}</code>
        </div>

        <hr className="sep" />

        {/* ------------------------------------------------------ 2. the data */}
        <h3 className="ml__h">The data</h3>

        <div className="ml__controls">
          <div className="field">
            <label className="field__label" htmlFor="ml-n">
              Sample size
            </label>
            <input
              id="ml-n"
              type="range"
              min="200"
              max="2000"
              step="100"
              value={n}
              aria-valuetext={`${n} generated rows`}
              onChange={(e) => setN(num(e.target.value, 800))}
            />
            <p className="field__hint">
              <span className="ml__value">{tally(n)}</span> rows generated
            </p>
          </div>

          <div className="field">
            <label className="field__label" htmlFor="ml-noise">
              Noise
            </label>
            <input
              id="ml-noise"
              type="range"
              min="0"
              max="0.5"
              step="0.01"
              value={noise}
              aria-valuetext={`Noise level ${noise.toFixed(2)}, where 0 is the formula with nothing added`}
              onChange={(e) => setNoise(num(e.target.value, 0))}
            />
            <p className="field__hint">
              <span className="ml__value">{fix(noise)}</span> — at 0 the target is the formula exactly,
              so any error left is the network&apos;s own.
            </p>
          </div>

          <div className="field">
            <label className="field__label" htmlFor="ml-seed">
              Seed
            </label>
            <input
              id="ml-seed"
              type="number"
              min="1"
              max="9999"
              step="1"
              value={seed}
              onChange={(e) => setSeed(Math.max(1, Math.round(num(e.target.value, 1))))}
            />
            <p className="field__hint">
              Drives the generator, the split and the initial weights. The same seed gives the same run —
              nothing here calls the platform random source.
            </p>
          </div>
        </div>

        <div className="grid-2">
          <div className="stat">
            <div className="stat__k">Training rows</div>
            <div className="stat__v">{tally(prep.train.length)}</div>
          </div>
          <div className="stat">
            <div className="stat__k">Held-out test rows</div>
            <div className="stat__v">{tally(prep.test.length)}</div>
          </div>
          <div className="stat">
            <div className="stat__k">Test share</div>
            <div className="stat__v">{fix(TEST_FRAC * 100, 0)}%</div>
          </div>
        </div>

        <div className="ml__chartwrap">
          <Histogram
            bins={dist.target}
            box={WIDE}
            ariaLabel={`Distribution of ${targetName} across ${tally(prep.rows.length)} generated rows, in ${BINS} bins. The horizontal axis is ${targetName}; the vertical axis is how many rows fall in each bin.`}
          />
        </div>
        <p className="ml__cap">
          Target distribution — {targetName}, {BINS} bins. Horizontal axis {targetName}, vertical axis row
          count. The declared range is {fix(TARGET?.min, 0)} to {fix(TARGET?.max, 0)}.
        </p>

        <div className="ml__mini">
          {FEATURES.map((f, i) => (
            <div className="ml__minicard" key={f.key}>
              <div className="ml__minihead">
                <strong>{f.label}</strong>
                <span className="tag">
                  {fix(f.min, 0)}–{fix(f.max, 0)}
                </span>
              </div>
              <Histogram
                bins={dist.features[i]}
                box={MINI}
                tick="ml__tick ml__tick--sm"
                decimals={banded(f) ? 0 : undefined}
                ariaLabel={`Distribution of ${f.label} across ${tally(prep.rows.length)} generated rows, in ${binsFor(f)} bins, over the declared range ${fix(f.min, 0)} to ${fix(f.max, 0)}.`}
              />
              <p className="ml__minihint">{f.help}</p>
            </div>
          ))}
        </div>

        <hr className="sep" />

        {/* ------------------------------------------------------ 3. training */}
        <h3 className="ml__h">Training</h3>

        <div className="ml__arch">
          <div className="kv">
            <span className="kv__k">Architecture</span>
            <span className="kv__v">6 → {HIDDEN} → 1, tanh hidden layer, linear output</span>
          </div>
          <div className="kv">
            <span className="kv__k">Learning rate</span>
            <span className="kv__v">{fix(LR, 3)}</span>
          </div>
          <div className="kv">
            <span className="kv__k">Batch size</span>
            <span className="kv__v">{BATCH}</span>
          </div>
          <div className="kv">
            <span className="kv__k">Epochs</span>
            <span className="kv__v">
              {EPOCHS}, run {CHUNK} per animation frame
            </span>
          </div>
          <div className="kv">
            <span className="kv__k">Inputs</span>
            <span className="kv__v">standardised on the training rows only</span>
          </div>
        </div>

        <div className="row">
          <button type="button" className="btn btn--primary" onClick={startTraining} disabled={phase === 'training'}>
            {phase === 'training' ? 'Training…' : phase === 'done' ? 'Train again' : 'Train'}
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={resetRun}
            disabled={phase === 'idle' && history.length === 0}
          >
            Reset
          </button>
          <span className="tag" aria-hidden="true">
            epoch {epoch} / {EPOCHS}
          </span>
        </div>

        <div className="meter" role="img" aria-label={`Training progress: ${fix(progressPct, 0)} percent of ${EPOCHS} epochs`}>
          <div className="meter__fill" style={{ width: `${progressPct}%` }} />
        </div>

        <p className="ml__live" aria-live="polite">
          {announcement}
        </p>

        <div className="ml__chartwrap">
          <LossChart history={history} epochs={EPOCHS} />
        </div>
        <div className="row ml__legend">
          <span className="tag">Training loss — solid line</span>
          <span className="tag">Validation loss — dashed line</span>
          <span className="tag">Horizontal axis epoch, vertical axis mean squared error</span>
        </div>

        <hr className="sep" />

        {/* ------------------------------------------------------- 4. results */}
        <h3 className="ml__h">Results on the held-out test set</h3>

        {!net && (
          <p className="empty">
            The comparison needs a trained network. The linear baseline is already fitted on the same{' '}
            {tally(prep.train.length)} training rows — press <strong>Train</strong> to put the network
            beside it.
          </p>
        )}

        {net && (
          <>
            <div className="ml__tablewrap">
              <table className="ml__table">
                <caption>
                  Least-squares baseline against the neural network, both scored on the same{' '}
                  {tally(prep.test.length)} held-out rows. Lower MAE and RMSE are better; R² closer to
                  1.000 is better.
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Model</th>
                    <th scope="col" className="ml__num">
                      MAE
                    </th>
                    <th scope="col" className="ml__num">
                      RMSE
                    </th>
                    <th scope="col" className="ml__num">
                      R²
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <th scope="row">Linear baseline</th>
                    <td className="ml__num">{fix(base?.mae)}</td>
                    <td className="ml__num">{fix(base?.rmse)}</td>
                    <td className="ml__num">{fix(base?.r2, 3)}</td>
                  </tr>
                  <tr>
                    <th scope="row">Neural network</th>
                    <td className="ml__num">{fix(net.mae)}</td>
                    <td className="ml__num">{fix(net.rmse)}</td>
                    <td className="ml__num">{fix(net.r2, 3)}</td>
                  </tr>
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row">Network minus baseline</th>
                    <td className="ml__num">
                      {maeGap === null ? '—' : `${maeGap > 0 ? '+' : ''}${fix(maeGap)}`}
                    </td>
                    <td className="ml__num">
                      {Number.isFinite(+net.rmse) && Number.isFinite(+base?.rmse)
                        ? `${+net.rmse - +base.rmse > 0 ? '+' : ''}${fix(+net.rmse - +base.rmse)}`
                        : '—'}
                    </td>
                    <td className="ml__num">
                      {Number.isFinite(+net.r2) && Number.isFinite(+base?.r2)
                        ? `${+net.r2 - +base.r2 > 0 ? '+' : ''}${fix(+net.r2 - +base.r2, 3)}`
                        : '—'}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <p className="ml__verdict">
              {maeGap === null ? (
                <>
                  <span className="badge badge--warn">No comparison</span> One of the two models did not
                  return a finite error, so there is nothing to compare.
                </>
              ) : maeGap < 0 ? (
                <>
                  <span className="badge badge--ok">Network ahead</span> Mean absolute error is{' '}
                  {fix(Math.abs(maeGap))} lower than the baseline&apos;s{' '}
                  {maeGapPct === null ? '' : `— ${fix(maeGapPct, 1)}% better `}
                  on rows neither model was fitted on. The generator has curvature the straight line
                  cannot follow, and the extra parameters are paying for themselves.
                </>
              ) : maeGap === 0 ? (
                <>
                  <span className="badge badge--warn">Tie</span> Both models land on the same mean
                  absolute error. The network has bought nothing here.
                </>
              ) : (
                <>
                  <span className="badge badge--danger">Baseline ahead</span> Mean absolute error is{' '}
                  {fix(maeGap)} higher than the baseline&apos;s{' '}
                  {maeGapPct === null ? '' : `— ${fix(maeGapPct, 1)}% worse `}
                  on rows neither model was fitted on. The network has not earned its complexity on this
                  run: ordinary least squares is cheaper, is one page of arithmetic and wins. Raise the
                  sample size, drop the noise, or accept the straight line.
                </>
              )}
            </p>

            <div className="ml__chartwrap">
              <ScatterChart points={net.points} unit={targetName} />
            </div>
            <p className="ml__cap">
              Predicted against actual {targetName} on the held-out rows — horizontal axis actual,
              vertical axis predicted. The dashed diagonal is y = x; points above it are over-predictions
              and points below it under-predictions. At most {MAX_POINTS} points are drawn.
            </p>
          </>
        )}

        <hr className="sep" />

        {/* ------------------------------------------ 5. what the net learned */}
        <h3 className="ml__h">What the network learned</h3>
        <div className="ml__chartwrap">
          <AttributionChart rows={result?.attribution} />
        </div>
        <p className="ml__cap">
          Share of first-layer weight magnitude by input, renormalised to sum to 100%. This is a
          heuristic for <em>influence</em> — how much a standardised input moves the hidden layer — and
          not a causal claim, not an effect size, and not a statement that changing that input in life
          changes the score. Inputs that are correlated with each other split their influence
          arbitrarily between them.
        </p>

        <hr className="sep" />

        {/* ----------------------------------------------- 6. live prediction */}
        <h3 className="ml__h">Live prediction</h3>

        {!profile && (
          <p className="empty">
            No risk profile on file, so there is nothing of yours to run through the network — complete
            the <strong>Risk Profile</strong> tab first. The sliders below start from the middle of each
            declared range instead, and everything else on this panel still works.
          </p>
        )}

        {!trained && (
          <p className="empty">
            The network is untrained, so it has no prediction to give. Press <strong>Train</strong> in the
            Training section above.
          </p>
        )}

        <div className="grid-2">
          <div className="stat">
            <div className="stat__k">{profile ? 'Your profile, scored' : 'Starting point, scored'}</div>
            <div className="stat__v">{profileScore === null ? '—' : fix(profileScore, 1)}</div>
          </div>
          <div className="stat">
            <div className="stat__k">With the sliders below</div>
            <div className="stat__v">{tunedScore === null ? '—' : fix(tunedScore, 1)}</div>
          </div>
          <div className="stat">
            <div className="stat__k">Difference</div>
            <div className="stat__v">
              {delta === null ? '—' : `${delta > 0 ? '+' : delta < 0 ? '−' : ''}${fix(Math.abs(delta), 1)}`}
            </div>
          </div>
        </div>

        <div className="ml__tablewrap">
          <table className="ml__table">
            <caption>
              The six derived inputs behind those figures — what{' '}
              {profile ? 'your quiz answers' : 'the neutral starting point'} become once mapped into the
              generator&apos;s feature space, and where the sliders currently sit.
            </caption>
            <thead>
              <tr>
                <th scope="col">Input</th>
                <th scope="col" className="ml__num">
                  {profile ? 'From your profile' : 'Starting point'}
                </th>
                <th scope="col" className="ml__num">
                  Slider now
                </th>
                <th scope="col" className="ml__num">
                  Declared range
                </th>
              </tr>
            </thead>
            <tbody>
              {FEATURES.map((f, i) => (
                <tr key={f.key}>
                  <th scope="row">{f.label}</th>
                  <td className="ml__num">{fix(profileFeatures[i], 1)}</td>
                  <td className="ml__num">{fix(tuned[i], 1)}</td>
                  <td className="ml__num">
                    {fix(f.min, 0)} – {fix(f.max, 0)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="ml__sliders">
          {FEATURES.map((f, i) => {
            const lo = num(f.min)
            const hi = num(f.max, lo + 1)
            // The bands are integers, but the network takes a continuous input, so a
            // tenth of a band is fine and makes the prediction move smoothly. A wide
            // range gets a hundredth of its span instead.
            const span = hi - lo
            const step = span <= 0 ? 1 : span <= 10 ? 0.1 : span / 100
            return (
              <div className="field" key={f.key}>
                <label className="field__label" htmlFor={`ml-f-${f.key}`}>
                  {f.label}
                </label>
                <input
                  id={`ml-f-${f.key}`}
                  type="range"
                  min={lo}
                  max={hi}
                  step={step}
                  value={num(tuned[i], lo)}
                  aria-valuetext={`${f.label} ${fix(tuned[i], 1)} on a scale of ${fix(lo, 0)} to ${fix(hi, 0)}`}
                  aria-describedby={`ml-f-${f.key}-hint`}
                  onChange={(e) =>
                    setTuned((prev) => {
                      const next = clampFeatures(prev)
                      next[i] = num(e.target.value, next[i])
                      return next
                    })
                  }
                />
                <p className="field__hint" id={`ml-f-${f.key}-hint`}>
                  <span className="ml__value">{fix(tuned[i], 1)}</span> · {f.help}
                </p>
              </div>
            )
          })}
        </div>

        <p className="ml__foot">
          Moving a slider re-runs the trained network on the spot — no refit, just a forward pass
          through the weights that were fitted above. The figure it returns is a prediction about the
          synthetic generator, and the honest way to read it is: this is what the model believes about
          a world it was shown, which is not this one.
        </p>
      </div>
    </section>
  )
}
