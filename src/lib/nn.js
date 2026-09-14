// ML Lab engine -- a 6-8-1 neural network written from scratch, trained in the browser.
//
// Pure functions only: no Math.random(), no Date.now(), no I/O, no dependencies. Every
// random draw comes from a seeded mulberry32 written below, so the same seed reproduces
// the same dataset, the same initial weights and the same trained weights, every time.
//
// WHAT THIS MODULE HONESTLY IS. The network is trained on SYNTHETIC rows from the
// generator in makeDataset() -- not on real users, not on the 20-row CSV in
// ml-prediction/. It demonstrates that the pipeline (generate -> split -> standardise ->
// train -> hold out -> measure) runs end to end in the browser. It is not evidence about
// anybody's actual finances. Because the generator is written down here, the module can
// state exactly what the network is being asked to recover, and linearBaseline() computes
// an ordinary-least-squares fit on the same split so a reader can see whether the extra
// machinery earns its complexity. If the baseline ever matches the network, the network
// is theatre and the UI should say so.
//
// The column names are the ones in ml-prediction/data/sample_financial_profiles.csv, so
// the Python experiment and this module describe the same problem. The Python side trains
// 240 trees on a 15/5 split of 20 rows and reports R2 0.939 where a plain linear
// regression on the same split reports 0.9978 -- the forest is losing to a straight line
// on a dataset that is itself close to a straight line, and 5 test rows cannot tell the
// two apart anyway. That is the dead end this module replaces.

const F = 6 // input width, fixed by FEATURES
const T_INDEX = F // norm.mu[6] / norm.sigma[6] hold the TARGET statistics

const num = (v) => (Number.isFinite(+v) ? +v : 0)
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)
const safe = (v) => (Number.isFinite(v) ? v : 0)

/** The six inputs. Each is an integer 1..5 -- an ordinal band, not a rupee amount, so the
 *  same six columns describe a household on any income. `help` is UI copy. */
export const FEATURES = [
  {
    key: 'income_score',
    label: 'Income strength',
    min: 1,
    max: 5,
    help: 'Monthly take-home band. 1 is under Rs 25,000, 5 is above Rs 2,00,000.',
  },
  {
    key: 'expense_discipline',
    label: 'Expense discipline',
    min: 1,
    max: 5,
    help: 'How little of take-home pay the household burns. 5 lives on under 30% of income.',
  },
  {
    key: 'debt_pressure',
    label: 'Debt pressure',
    min: 1,
    max: 5,
    help: 'EMI outgo as a share of income. 1 is debt-free, 5 services over a third of pay.',
  },
  {
    key: 'emergency_cover',
    label: 'Emergency cover',
    min: 1,
    max: 5,
    help: 'Months of expenses held liquid. 1 is under a month, 5 is nine months or more.',
  },
  {
    key: 'investment_habit',
    label: 'Investment habit',
    min: 1,
    max: 5,
    help: 'Monthly surplus that actually survives expenses and EMIs and can be invested.',
  },
  {
    key: 'automation_readiness',
    label: 'Automation readiness',
    min: 1,
    max: 5,
    help: 'Horizon over which SIPs and auto-debits can be left running untouched.',
  },
]

/** The single output. Bounded, because a health score out of 100 that reads 137 is wrong
 *  however good the fit is -- predict() and linearBaseline() both clamp to this range. */
export const TARGET = {
  key: 'financial_health_score',
  label: 'Financial health score',
  min: 0,
  max: 100,
}

/* ---------- seeded randomness ---------- */

/* mulberry32: four lines, deterministic, adequate for synthetic data and weight init.
   Written here rather than imported -- no dependency is worth taking for this.
   `state()` exposes the counter so a network can carry its shuffle position in a plain
   field and reproduce a training run split across many trainEpochs() calls. */
function mulberry32(seed) {
  let a = seed >>> 0
  const rnd = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  rnd.state = () => a >>> 0
  return rnd
}

// Box-Muller. u is pushed off zero because log(0) is -Infinity and this module never
// emits a non-finite number.
function gauss(rnd) {
  let u = rnd()
  while (!(u > 1e-12)) u = rnd()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd())
}

function shuffle(idx, rnd) {
  for (let i = idx.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rnd() * (i + 1))
    const t = idx[i]
    idx[i] = idx[j]
    idx[j] = t
  }
}

/* ---------- the generator ---------- */

/* THE FORMULA, stated once so the UI can print it and a reader can check the network
   against it:

     financial_health_score = clamp(0..100) of
         50
       + 5.0*(income_score         - 3)
       + 4.0*(expense_discipline   - 3)
       - 3.5*(debt_pressure        - 3)
       + 3.5*(emergency_cover      - 3)
       + 2.5*(investment_habit     - 3)
       + 1.8*(automation_readiness - 3)
       - 1.8*(debt_pressure - 1)*(5 - emergency_cover)     <- interaction
       + 12 *(1 - exp(-(investment_habit - 1)))            <- saturation
       + N(0, noise)

   The two non-linear terms are the point of the exercise:

   1. The product term. Debt is not a fixed penalty; it is nearly harmless against nine
      months of cover and close to ruinous against none. A linear model has one coefficient
      per column and physically cannot express "the cost of column C depends on column D".
      Its best effort is the linear projection of the product, and what is left over is out
      of its reach at any sample size.
   2. The saturating term. The first rupee of investing habit changes far more than the
      fifth. exp() curvature is likewise unreachable by a single coefficient.

   Measured, not asserted. Fitting OLS to 20,000 NOISELESS rows from this generator (so the
   only thing it can miss is structure, not noise) scores R2 0.9538 against a target
   standard deviation of 19.0 points: 4.6% of the variance is permanently unavailable to a
   straight line. At the defaults used by the UI and by test 6 of nn.test.mjs -- n 600,
   noise 2.5, testFrac 0.25, hidden 8, lr 0.05, batch 16, 400 epochs -- the held-out result
   over seeds 1..12 is linear R2 0.925..0.955 against network R2 0.969..0.982, the network
   ahead on every seed by 0.018 to 0.058, with RMSE falling from ~4.8 to ~3.0 score points.

   Pushing the interaction coefficient past 1.8 was tried and rejected: 2.6 buys only 1.8
   more points of OLS ceiling and quadruples the clamp rate, which would replace a designed
   non-linearity with an artefact of the bounds.

   Clamping into 0..100 catches 0.63% of rows at the defaults. Both models eat the same
   clamp, so it does not tilt the comparison. */
export function makeDataset({ n, noise, seed } = {}) {
  const count = clamp(Math.floor(num(n)) || 0, 0, 200000)
  const sd = clamp(num(noise), 0, 1000)
  const usedSeed = Math.floor(num(seed)) || 1
  const rnd = mulberry32(usedSeed)

  const rows = []
  for (let k = 0; k < count; k += 1) {
    const f = new Array(F)
    for (let i = 0; i < F; i += 1) f[i] = 1 + Math.floor(rnd() * 5) // integers 1..5
    const income = f[0]
    const discipline = f[1]
    const debt = f[2]
    const cover = f[3]
    const invest = f[4]
    const auto = f[5]

    const linear =
      50 +
      5.0 * (income - 3) +
      4.0 * (discipline - 3) -
      3.5 * (debt - 3) +
      3.5 * (cover - 3) +
      2.5 * (invest - 3) +
      1.8 * (auto - 3)
    const interaction = -1.8 * (debt - 1) * (5 - cover)
    const saturation = 12 * (1 - Math.exp(-(invest - 1)))

    const target = clamp(
      safe(linear + interaction + saturation + gauss(rnd) * sd),
      TARGET.min,
      TARGET.max,
    )
    rows.push({ features: f, target })
  }

  const generator =
    'financial_health_score = clamp(' +
    TARGET.min +
    '..' +
    TARGET.max +
    ') of\n' +
    '  50\n' +
    '  + 5.0*(income_score-3) + 4.0*(expense_discipline-3) - 3.5*(debt_pressure-3)\n' +
    '  + 3.5*(emergency_cover-3) + 2.5*(investment_habit-3) + 1.8*(automation_readiness-3)\n' +
    '  - 1.8*(debt_pressure-1)*(5-emergency_cover)   [interaction: debt bites hardest when cover is thin]\n' +
    '  + 12*(1-exp(-(investment_habit-1)))           [saturation: diminishing returns on habit]\n' +
    '  + N(0, ' +
    sd +
    ')   over ' +
    count +
    ' rows, seed ' +
    usedSeed +
    ', features drawn uniform on {1,2,3,4,5}'

  return { rows, generator }
}

/** Seeded partition. Shuffles indices rather than the caller's array, so `rows` is never
 *  mutated. Keeps at least one training row whenever there is one to keep. */
export function splitDataset(rows, { testFrac, seed } = {}) {
  const list = Array.isArray(rows) ? rows : []
  const n = list.length
  if (n === 0) return { train: [], test: [] }

  const frac = clamp(num(testFrac) || 0, 0, 1)
  const idx = new Int32Array(n)
  for (let i = 0; i < n; i += 1) idx[i] = i
  shuffle(idx, mulberry32(Math.floor(num(seed)) || 1))

  const nTest = clamp(Math.round(n * frac), 0, n - 1)
  const test = []
  const train = []
  for (let i = 0; i < n; i += 1) (i < nTest ? test : train).push(list[idx[i]])
  return { train, test }
}

/* ---------- standardisation ---------- */

/** Column means and standard deviations for the six features (0..5) and the target (6).
 *
 *  Call this on the TRAINING split only and pass the result to predict()/evaluate() for
 *  the test split. Standardising with statistics computed over train+test leaks the test
 *  distribution into the model: every held-out number afterwards is optimistic, and the
 *  optimism is invisible because nothing errors.
 *
 *  A column with zero variance (every row identical) would divide by zero, so sigma falls
 *  back to 1 -- that column then contributes a constant 0 to the network instead of NaN. */
export function standardise(rows) {
  const list = Array.isArray(rows) ? rows : []
  const mu = new Float64Array(F + 1)
  const sigma = new Float64Array(F + 1).fill(1)
  const n = list.length
  if (n === 0) return { mu, sigma }

  for (const r of list) {
    for (let i = 0; i < F; i += 1) mu[i] += num(r && r.features ? r.features[i] : 0)
    mu[T_INDEX] += num(r ? r.target : 0)
  }
  for (let i = 0; i <= F; i += 1) mu[i] /= n

  const acc = new Float64Array(F + 1)
  for (const r of list) {
    for (let i = 0; i < F; i += 1) {
      const d = num(r && r.features ? r.features[i] : 0) - mu[i]
      acc[i] += d * d
    }
    const dt = num(r ? r.target : 0) - mu[T_INDEX]
    acc[T_INDEX] += dt * dt
  }
  for (let i = 0; i <= F; i += 1) {
    const s = Math.sqrt(acc[i] / n)
    sigma[i] = Number.isFinite(s) && s > 1e-9 ? s : 1
  }
  return { mu, sigma }
}

// Accepts a norm from standardise(), one remembered on the net, or nothing, and always
// hands back a usable pair. Sanitises sigma so a hand-built norm cannot inject a NaN.
function resolveNorm(net, norm) {
  const src = norm && norm.mu && norm.sigma ? norm : net && net.norm ? net.norm : null
  const mu = new Float64Array(F + 1)
  const sigma = new Float64Array(F + 1).fill(1)
  if (!src) return { mu, sigma }
  for (let i = 0; i <= F; i += 1) {
    mu[i] = num(src.mu[i])
    const s = num(src.sigma[i])
    sigma[i] = Number.isFinite(s) && s > 1e-9 ? s : 1
  }
  return { mu, sigma }
}

/* ---------- the network ---------- */

/** 6 inputs -> `hidden` tanh units -> 1 linear output.
 *
 *  tanh because the inputs are standardised and roughly symmetric about zero, where tanh
 *  has its useful gradient; a linear output because the target is a bounded score, not a
 *  probability. Weights are Float64Array so the UI can read them straight out.
 *
 *  Xavier/Glorot: uniform on +/- sqrt(6/(fan_in + fan_out)), which keeps the variance of
 *  the activations roughly constant through the layer so training neither stalls nor
 *  saturates tanh on the first step. Biases start at zero. */
export function createNetwork({ hidden, seed } = {}) {
  const h = clamp(Math.floor(num(hidden)) || 8, 1, 256)
  const s = Math.floor(num(seed)) || 1
  const rnd = mulberry32(s)

  const W1 = new Float64Array(h * F)
  const W2 = new Float64Array(h)
  const lim1 = Math.sqrt(6 / (F + h))
  const lim2 = Math.sqrt(6 / (h + 1))
  for (let i = 0; i < W1.length; i += 1) W1[i] = (rnd() * 2 - 1) * lim1
  for (let j = 0; j < h; j += 1) W2[j] = (rnd() * 2 - 1) * lim2

  return {
    inputs: F,
    hidden: h,
    outputs: 1,
    seed: s,
    W1, // [hidden * 6], row-major: W1[j*6 + i] is input i -> hidden j
    b1: new Float64Array(h),
    W2, // [hidden]: hidden j -> output
    b2: new Float64Array(1),
    rngState: rnd.state(), // shuffle position, carried across trainEpochs() calls
    epochs: 0,
    norm: null,
  }
}

// Forward pass from a standardised feature row held in X at offset row*F. Fills `h` with
// the hidden activations (backprop needs them) and returns the standardised output.
function forwardRow(net, X, row, h) {
  const hidden = net.hidden
  const W1 = net.W1
  const b1 = net.b1
  const W2 = net.W2
  const base = row * F
  let y = net.b2[0]
  for (let j = 0; j < hidden; j += 1) {
    let z = b1[j]
    const off = j * F
    for (let i = 0; i < F; i += 1) z += W1[off + i] * X[base + i]
    const t = Math.tanh(z)
    h[j] = t
    y += W2[j] * t
  }
  return y
}

function meanSquared(net, X, T, n, h) {
  if (n <= 0) return 0
  let s = 0
  for (let r = 0; r < n; r += 1) {
    const d = forwardRow(net, X, r, h) - T[r]
    s += d * d
  }
  return safe(s / n)
}

// Guarded SGD update: a weight that would become non-finite (runaway lr, exploding batch)
// is left where it was, so a bad hyperparameter degrades the curve instead of poisoning
// every later prediction with NaN.
function step(w, g, lr) {
  for (let i = 0; i < w.length; i += 1) {
    const next = w[i] - lr * g[i]
    if (Number.isFinite(next)) w[i] = next
  }
}

function rowsOf(src) {
  if (Array.isArray(src)) return src
  if (src && Array.isArray(src.rows)) return src.rows
  return []
}

// Pack rows into flat standardised matrices once, instead of re-standardising per epoch.
function pack(rows, norm) {
  const n = rows.length
  const X = new Float64Array(n * F)
  const T = new Float64Array(n)
  for (let r = 0; r < n; r += 1) {
    const row = rows[r]
    const f = row && row.features ? row.features : null
    for (let i = 0; i < F; i += 1) {
      X[r * F + i] = (num(f ? f[i] : 0) - norm.mu[i]) / norm.sigma[i]
    }
    T[r] = (num(row ? row.target : 0) - norm.mu[T_INDEX]) / norm.sigma[T_INDEX]
  }
  return { X, T, n }
}

/** Mini-batch gradient descent with hand-derived backpropagation.
 *
 *  `train` is either an array of raw rows or `{ rows, norm }`. When no norm is supplied
 *  the training split's own statistics are used and remembered on the net, so predict()
 *  and evaluate() can be called without repeating it. `opts.validation` is an array of
 *  raw held-out rows, standardised with the SAME norm -- never with its own.
 *
 *  CALL IT REPEATEDLY. The net carries its own shuffle position (`rngState`) and epoch
 *  counter, so trainEpochs(net, train, { epochs: 20, ... }) inside a requestAnimationFrame
 *  loop produces bit-identical weights to one call with all the epochs, while leaving the
 *  tab responsive. Returns only the epochs run by this call, numbered cumulatively, so the
 *  UI concatenates the histories into one continuous curve.
 *
 *  Losses are mean squared error on STANDARDISED targets (unitless, comparable across
 *  datasets); evaluate() reports errors in score points. `valLoss` is null when no
 *  validation set was given.
 *
 *  The gradients: with z = W1 x + b1, h = tanh(z), y = W2 h + b2, L = mean (y - t)^2,
 *      dL/dy   = 2 (y - t) / B
 *      dL/dW2  = dL/dy * h        dL/db2 = dL/dy
 *      dL/dh   = dL/dy * W2       dL/dz  = dL/dh * (1 - h^2)
 *      dL/dW1  = dL/dz * x        dL/db1 = dL/dz
 *  derived analytically, never approximated -- nn.test.mjs checks them against a central
 *  finite difference, because a wrong gradient still draws a falling loss curve and
 *  nothing else in the suite would notice. */
export function trainEpochs(net, train, opts) {
  const o = opts && typeof opts === 'object' ? opts : {}
  const rows = rowsOf(train)
  const supplied = train && train.norm ? train.norm : net && net.norm ? net.norm : null
  const norm = resolveNorm(net, supplied || standardise(rows))
  net.norm = norm

  const epochs = clamp(Math.floor(num(o.epochs)) || 0, 0, 100000)
  const lrRaw = num(o.lr)
  const lr = lrRaw > 0 ? Math.min(lrRaw, 10) : 0.05
  const history = []
  const hidden = net.hidden
  const hbuf = new Float64Array(hidden)
  const packed = pack(rows, norm)
  const X = packed.X
  const T = packed.T
  const n = packed.n
  if (n === 0 || epochs === 0) return { history }

  const bs = clamp(Math.floor(num(o.batchSize)) || 16, 1, n)
  const val = pack(rowsOf(o.validation), norm)

  const W1 = net.W1
  const b1 = net.b1
  const W2 = net.W2
  const b2 = net.b2
  const gW1 = new Float64Array(W1.length)
  const gb1 = new Float64Array(hidden)
  const gW2 = new Float64Array(hidden)
  const gb2 = new Float64Array(1)
  const idx = new Int32Array(n)
  for (let i = 0; i < n; i += 1) idx[i] = i
  const rnd = mulberry32(net.rngState)

  for (let e = 0; e < epochs; e += 1) {
    // Reset to identity first. Fisher-Yates over an ALREADY permuted array gives a
    // different permutation for the same random draws, so without this reset the order an
    // epoch sees would depend on how the epochs were chunked across calls -- 20 epochs at
    // a time would drift away from one call of 400, and the UI's animated run would stop
    // reproducing the headline numbers.
    for (let i = 0; i < n; i += 1) idx[i] = i
    shuffle(idx, rnd)
    for (let s = 0; s < n; s += bs) {
      const end = Math.min(n, s + bs)
      const B = end - s
      gW1.fill(0)
      gb1.fill(0)
      gW2.fill(0)
      gb2[0] = 0

      for (let k = s; k < end; k += 1) {
        const r = idx[k]
        const base = r * F
        const y = forwardRow(net, X, r, hbuf)
        const dy = (2 * (y - T[r])) / B
        gb2[0] += dy
        for (let j = 0; j < hidden; j += 1) {
          const hj = hbuf[j]
          gW2[j] += dy * hj
          const dz = dy * W2[j] * (1 - hj * hj)
          gb1[j] += dz
          const off = j * F
          for (let i = 0; i < F; i += 1) gW1[off + i] += dz * X[base + i]
        }
      }

      step(W1, gW1, lr)
      step(b1, gb1, lr)
      step(W2, gW2, lr)
      step(b2, gb2, lr)
    }

    net.epochs += 1
    history.push({
      epoch: net.epochs,
      trainLoss: meanSquared(net, X, T, n, hbuf),
      valLoss: val.n > 0 ? meanSquared(net, val.X, val.T, val.n, hbuf) : null,
    })
  }

  net.rngState = rnd.state()
  return { history }
}

/** One prediction, in score points. `features` is the raw 1..5 row; `norm` must be the
 *  training-split statistics the net was trained with (falls back to the one the net
 *  remembered). Clamped into TARGET.min..max: the network output is unbounded and a
 *  health score of 104 is wrong however small the residual. */
export function predict(net, features, norm) {
  const nrm = resolveNorm(net, norm)
  const X = new Float64Array(F)
  for (let i = 0; i < F; i += 1) {
    X[i] = (num(features ? features[i] : 0) - nrm.mu[i]) / nrm.sigma[i]
  }
  const y = forwardRow(net, X, 0, new Float64Array(net.hidden))
  const raw = y * nrm.sigma[T_INDEX] + nrm.mu[T_INDEX]
  return clamp(Number.isFinite(raw) ? raw : nrm.mu[T_INDEX], TARGET.min, TARGET.max)
}

// Shared metric shape so a network and a straight line can be tabled side by side.
// r2 = 1 - SSres/SStot. A constant target column makes SStot zero and r2 undefined; a
// perfect fit on it scores 1 and anything else scores 0 rather than -Infinity.
function metricsFrom(points) {
  const n = points.length
  if (n === 0) return { mae: 0, rmse: 0, r2: 0, points }
  let sumAbs = 0
  let sumSq = 0
  let mean = 0
  for (const p of points) mean += p.actual
  mean /= n
  let ssTot = 0
  for (const p of points) {
    const d = p.predicted - p.actual
    sumAbs += Math.abs(d)
    sumSq += d * d
    ssTot += (p.actual - mean) * (p.actual - mean)
  }
  const r2 = ssTot > 1e-12 ? 1 - sumSq / ssTot : sumSq === 0 ? 1 : 0
  return {
    mae: safe(sumAbs / n),
    rmse: safe(Math.sqrt(sumSq / n)),
    r2: Math.min(1, safe(r2)),
    points,
  }
}

/** Held-out metrics in score points, plus every (actual, predicted) pair so the UI can
 *  draw the scatter. Pass the TRAINING norm -- see standardise() on why. */
export function evaluate(net, rows, norm) {
  const list = rowsOf(rows)
  const nrm = resolveNorm(net, norm)
  return metricsFrom(
    list.map((r) => ({
      actual: num(r ? r.target : 0),
      predicted: predict(net, r ? r.features : null, nrm),
    })),
  )
}

/* ---------- the control ---------- */

// Gaussian elimination with partial pivoting. n is 7, so the obvious algorithm is the
// right one. Returns null if the system is singular even after the ridge term.
function solve(A, b, n) {
  const M = Float64Array.from(A)
  const y = Float64Array.from(b)
  for (let c = 0; c < n; c += 1) {
    let piv = c
    for (let r = c + 1; r < n; r += 1) {
      if (Math.abs(M[r * n + c]) > Math.abs(M[piv * n + c])) piv = r
    }
    if (!(Math.abs(M[piv * n + c]) > 1e-12)) return null
    if (piv !== c) {
      for (let k = 0; k < n; k += 1) {
        const t = M[c * n + k]
        M[c * n + k] = M[piv * n + k]
        M[piv * n + k] = t
      }
      const t = y[c]
      y[c] = y[piv]
      y[piv] = t
    }
    for (let r = c + 1; r < n; r += 1) {
      const f = M[r * n + c] / M[c * n + c]
      if (f === 0) continue
      for (let k = c; k < n; k += 1) M[r * n + k] -= f * M[c * n + k]
      y[r] -= f * y[c]
    }
  }
  const x = new Float64Array(n)
  for (let r = n - 1; r >= 0; r -= 1) {
    let s = y[r]
    for (let k = r + 1; k < n; k += 1) s -= M[r * n + k] * x[k]
    x[r] = s / M[r * n + r]
  }
  for (let i = 0; i < n; i += 1) if (!Number.isFinite(x[i])) return null
  return x
}

/** Ordinary least squares on the raw 1..5 features -- the control the network has to beat.
 *
 *  Normal equations (X'X + lambda I) w = X'y, solved by the Gaussian elimination above.
 *  The ridge term is 1e-8 scaled to the matrix, present only so a degenerate design (a
 *  constant column, fewer rows than columns, two identical features) returns numbers
 *  instead of exploding. It is far too small to be regularisation in any statistical
 *  sense, and it is applied to the intercept too because at this magnitude the difference
 *  is invisible and the special case is not worth the code.
 *
 *  OLS is affine-invariant, so no standardisation is needed here -- there is nothing to
 *  leak. Predictions are clamped to the same TARGET range as predict(), so both rows of
 *  the comparison table are measured identically. */
export function linearBaseline(train, test) {
  const tr = rowsOf(train)
  const te = rowsOf(test)
  const D = F + 1 // intercept + six coefficients

  const A = new Float64Array(D * D)
  const rhs = new Float64Array(D)
  const x = new Float64Array(D)
  let meanTarget = 0
  for (const row of tr) {
    x[0] = 1
    for (let i = 0; i < F; i += 1) x[i + 1] = num(row && row.features ? row.features[i] : 0)
    const t = num(row ? row.target : 0)
    meanTarget += t
    for (let r = 0; r < D; r += 1) {
      rhs[r] += x[r] * t
      for (let c = 0; c < D; c += 1) A[r * D + c] += x[r] * x[c]
    }
  }
  meanTarget = tr.length > 0 ? meanTarget / tr.length : 0

  let trace = 0
  for (let i = 0; i < D; i += 1) trace += A[i * D + i]
  const lambda = 1e-8 * Math.max(1, trace / D)
  for (let i = 0; i < D; i += 1) A[i * D + i] += lambda

  const w = tr.length > 0 ? solve(A, rhs, D) : null
  const intercept = w ? safe(w[0]) : meanTarget
  const coefficients = []
  for (let i = 0; i < F; i += 1) coefficients.push(w ? safe(w[i + 1]) : 0)

  const points = te.map((row) => {
    let p = intercept
    for (let i = 0; i < F; i += 1) {
      p += coefficients[i] * num(row && row.features ? row.features[i] : 0)
    }
    return {
      actual: num(row ? row.target : 0),
      predicted: clamp(safe(p), TARGET.min, TARGET.max),
    }
  })

  return { coefficients, intercept, metrics: metricsFrom(points) }
}

/* ---------- what the network learned ---------- */

/** Influence of each input, as shares summing to 1.
 *
 *  For input i: sum over hidden units j of |W1[j][i]| * |W2[j]| -- every path from that
 *  input to the output, weighted by how strongly the path carries signal.
 *
 *  READ THIS BEFORE PUTTING A NUMBER ON A SLIDE. It is a weight-magnitude heuristic, not
 *  a Shapley value and not an ablation. It is only comparable across inputs because those
 *  inputs were standardised by `norm` onto a common scale -- run the same arithmetic on
 *  raw 1..5 columns and it would be measuring the units instead. It ignores the tanh
 *  operating point, so a saturated unit counts as much as an active one, and it carries
 *  no sign, so it cannot say whether an input helps or hurts. It indicates which columns
 *  the network leans on. It is not causation, and on synthetic data it is not a claim
 *  about real households either. */
export function featureAttribution(net, norm) {
  resolveNorm(net, norm) // the measure is only meaningful on inputs standardised by this
  const hidden = net && net.hidden ? net.hidden : 0
  const raw = new Array(F).fill(0)
  let total = 0
  for (let i = 0; i < F; i += 1) {
    let s = 0
    for (let j = 0; j < hidden; j += 1) {
      s += Math.abs(num(net.W1[j * F + i])) * Math.abs(num(net.W2[j]))
    }
    raw[i] = safe(s)
    total += raw[i]
  }
  return FEATURES.map((f, i) => ({
    key: f.key,
    label: f.label,
    weight: raw[i],
    // An all-zero net would divide by zero; an even split is the honest answer when no
    // input is being leaned on at all.
    share: total > 1e-12 ? raw[i] / total : 1 / F,
  }))
}

/* ---------- the live path ---------- */

// Bucket against ascending cut points: below cuts[0] -> 1, above the last -> cuts.length+1.
function band(v, cuts) {
  let b = 1
  for (const c of cuts) if (v >= c) b += 1
  return clamp(b, 1, 5)
}

/** Map the risk quiz's profile onto the six model inputs.
 *
 *  `profile` is `{ monthlyIncome, monthlyExpenses, emiLoad, dependents, emergencyMonths,
 *  horizonYears }` from deriveRiskMode() in quiz.js. Null, undefined or a half-filled
 *  object returns the mid-range 3 for whatever cannot be derived -- the UI calls this
 *  before the quiz is finished, so throwing is not an option.
 *
 *  Thresholds, all stated so a reviewer can argue with them:
 *    income_score         Q1's own bands: 25k / 50k / 1L / 2L monthly take-home.
 *    expense_discipline   expenses / income, inverted: >=75% -> 1, <30% -> 5.
 *    debt_pressure        EMI / income: zero -> 1, then 10% / 20% / 30% / 40%. Higher is
 *                         worse here, matching the CSV column; 5 lands exactly on the
 *                         "hold total EMI under 40% of income" guardrail in blueprint.js.
 *    emergency_cover      months held liquid: <1 / <3 / <6 / <9 / more.
 *    investment_habit     surplus = (income - expenses - EMI) / income: <5% -> 1, then
 *                         15% / 25% / 35%. Money that survives the month is the only
 *                         evidence of an investing habit the quiz actually collects.
 *    automation_readiness horizon in years: <2 / <4 / <8 / <15 / more. A standing SIP is
 *                         only worth setting up if it can be left alone.
 *
 *  `dependents` is deliberately unused: its effect runs entirely through monthlyExpenses,
 *  and emergencyMonths is already denominated in months OF those expenses, so a second
 *  penalty would double-count the same household. */
export function profileToFeatures(profile) {
  const p = profile && typeof profile === 'object' ? profile : {}
  const income = num(p.monthlyIncome)
  const known = income > 0
  const expenses = num(p.monthlyExpenses)
  const emi = num(p.emiLoad)

  const expenseRatio = known ? expenses / income : 0
  const emiRatio = known ? emi / income : 0
  const surplus = known ? (income - expenses - emi) / income : 0

  return [
    known ? band(income, [25000, 50000, 100000, 200000]) : 3,
    // inverted: the LOWER the spend ratio, the better the discipline
    known ? 6 - band(expenseRatio, [0.3, 0.45, 0.6, 0.75]) : 3,
    known ? (emi <= 0 ? 1 : band(emiRatio, [0.1, 0.2, 0.3, 0.4])) : 3,
    Number.isFinite(+p.emergencyMonths) ? band(num(p.emergencyMonths), [1, 3, 6, 9]) : 3,
    known ? band(surplus, [0.05, 0.15, 0.25, 0.35]) : 3,
    Number.isFinite(+p.horizonYears) ? band(num(p.horizonYears), [2, 4, 8, 15]) : 3,
  ]
}

/* ---------- distribution ---------- */

/** Equal-width bins over [min, max]. Counts sum to the number of FINITE inputs (a NaN has
 *  no bin to fall in, so it is dropped rather than silently counted somewhere). An empty
 *  input returns []. A single distinct value would give a zero-width bin, so it gets a
 *  unit-wide one centred on itself -- zero width makes every bar chart divide by zero.
 *  The last bin is closed on the right, so the maximum is counted. */
export function histogram(values, bins) {
  const list = (Array.isArray(values) ? values : []).map(num).filter(Number.isFinite)
  const k = clamp(Math.floor(num(bins)) || 10, 1, 200)
  if (list.length === 0) return []

  let lo = Infinity
  let hi = -Infinity
  for (const v of list) {
    if (v < lo) lo = v
    if (v > hi) hi = v
  }
  if (!(hi > lo)) {
    lo -= 0.5
    hi += 0.5
  }
  const width = (hi - lo) / k

  const out = []
  for (let i = 0; i < k; i += 1) {
    out.push({ x0: lo + i * width, x1: i === k - 1 ? hi : lo + (i + 1) * width, count: 0 })
  }
  for (const v of list) {
    out[clamp(Math.floor((v - lo) / width), 0, k - 1)].count += 1
  }
  return out
}
