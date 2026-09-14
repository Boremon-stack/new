// Self-check for src/lib/nn.js. Run: node --test src/lib/nn.test.mjs
// node:test + node:assert/strict only -- the module has no dependencies and neither does
// its test. Every assertion below is aimed at something that actually breaks silently.
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  FEATURES,
  TARGET,
  createNetwork,
  evaluate,
  featureAttribution,
  histogram,
  linearBaseline,
  makeDataset,
  predict,
  profileToFeatures,
  splitDataset,
  standardise,
  trainEpochs,
} from './nn.js'

const T = 6 // index of the target statistics inside a norm
const allFinite = (xs) => xs.every((v) => Number.isFinite(v))

test('1a. same seed reproduces the dataset exactly, a different seed does not', () => {
  const a = makeDataset({ n: 50, noise: 3, seed: 42 })
  const b = makeDataset({ n: 50, noise: 3, seed: 42 })
  const c = makeDataset({ n: 50, noise: 3, seed: 43 })

  assert.deepEqual(a.rows, b.rows)
  assert.equal(a.generator, b.generator)
  assert.notDeepEqual(a.rows, c.rows)
})

test('1b. same seed reproduces the trained weights exactly, a different seed does not', () => {
  const { rows } = makeDataset({ n: 120, noise: 2, seed: 9 })
  const norm = standardise(rows)
  const opts = { epochs: 25, lr: 0.05, batchSize: 16 }

  const run = (seed) => {
    const net = createNetwork({ hidden: 5, seed })
    const { history } = trainEpochs(net, { rows, norm }, opts)
    return { net, history }
  }

  const a = run(4)
  const b = run(4)
  const c = run(5)

  assert.deepEqual([...a.net.W1], [...b.net.W1])
  assert.deepEqual([...a.net.W2], [...b.net.W2])
  assert.deepEqual([...a.net.b1], [...b.net.b1])
  assert.deepEqual([...a.net.b2], [...b.net.b2])
  assert.deepEqual(a.history, b.history)
  assert.notDeepEqual([...a.net.W1], [...c.net.W1])
})

test('1c. training in chunks equals training in one call', () => {
  const { rows } = makeDataset({ n: 90, noise: 2, seed: 17 })
  const norm = standardise(rows)
  const opts = { lr: 0.04, batchSize: 8 }

  const whole = createNetwork({ hidden: 4, seed: 3 })
  trainEpochs(whole, { rows, norm }, { ...opts, epochs: 30 })

  const chunked = createNetwork({ hidden: 4, seed: 3 })
  const history = []
  for (let i = 0; i < 3; i += 1) {
    history.push(...trainEpochs(chunked, { rows, norm }, { ...opts, epochs: 10 }).history)
  }

  assert.deepEqual([...whole.W1], [...chunked.W1])
  assert.deepEqual([...whole.W2], [...chunked.W2])
  assert.equal(chunked.epochs, 30)
  assert.deepEqual(
    history.map((h) => h.epoch),
    Array.from({ length: 30 }, (_, i) => i + 1),
  )
})

test('2. makeDataset respects n, keeps features 1..5, targets inside TARGET, all finite', () => {
  for (const noise of [0, 2.5, 40]) {
    const { rows, generator } = makeDataset({ n: 300, noise, seed: 5 })
    assert.equal(rows.length, 300)
    assert.ok(generator.includes(TARGET.key))

    for (const r of rows) {
      assert.equal(r.features.length, FEATURES.length)
      assert.ok(allFinite(r.features))
      for (const f of r.features) {
        assert.ok(Number.isInteger(f) && f >= 1 && f <= 5, `feature out of band: ${f}`)
      }
      assert.ok(Number.isFinite(r.target))
      assert.ok(r.target >= TARGET.min && r.target <= TARGET.max, `target ${r.target}`)
    }
  }

  // Degenerate inputs must not throw or leak NaN.
  assert.deepEqual(makeDataset({ n: 0, noise: 1, seed: 1 }).rows, [])
  assert.deepEqual(makeDataset().rows, [])
  assert.ok(makeDataset({ n: 3, noise: NaN, seed: NaN }).rows.every((r) => Number.isFinite(r.target)))
})

test('3. splitDataset partitions without overlap and without loss', () => {
  const { rows } = makeDataset({ n: 200, noise: 2, seed: 8 })
  const { train, test } = splitDataset(rows, { testFrac: 0.25, seed: 8 })

  assert.equal(train.length + test.length, rows.length)
  assert.ok(train.length > 0 && test.length > 0)

  const seen = new Set(train)
  for (const r of test) assert.ok(!seen.has(r), 'a row appears in both splits')
  const union = new Set([...train, ...test])
  assert.equal(union.size, rows.length)
  for (const r of rows) assert.ok(union.has(r))

  // Same seed -> same partition; a different seed moves rows across.
  assert.deepEqual(splitDataset(rows, { testFrac: 0.25, seed: 8 }).test, test)
  assert.notDeepEqual(splitDataset(rows, { testFrac: 0.25, seed: 9 }).test, test)

  // Edges.
  assert.deepEqual(splitDataset([], { testFrac: 0.5, seed: 1 }), { train: [], test: [] })
  const extreme = splitDataset(rows, { testFrac: 1, seed: 1 })
  assert.equal(extreme.train.length, 1, 'at least one training row survives testFrac 1')
  assert.equal(extreme.train.length + extreme.test.length, rows.length)
})

test('4. analytic gradients match a central finite difference to ~1e-6', () => {
  // A wrong gradient still produces a falling loss curve, so this is the only test in the
  // suite that can catch a backprop bug.
  const { rows } = makeDataset({ n: 40, noise: 1, seed: 11 })
  const norm = standardise(rows)
  const net = createNetwork({ hidden: 3, seed: 5 })

  // The loss trainEpochs() minimises is MSE on standardised targets. predict() returns
  // score points, so divide the residual by sigma_target to land in the same space. That
  // identity only holds where predict() is not clamping, so check that first.
  const loss = () => {
    let s = 0
    for (const r of rows) {
      const p = predict(net, r.features, norm)
      assert.ok(
        p > TARGET.min + 1 && p < TARGET.max - 1,
        `prediction ${p} sits on the clamp; the finite-difference loss would be flat`,
      )
      const d = (p - r.target) / norm.sigma[T]
      s += d * d
    }
    return s / rows.length
  }

  const snapshot = {
    W1: Float64Array.from(net.W1),
    b1: Float64Array.from(net.b1),
    W2: Float64Array.from(net.W2),
    b2: Float64Array.from(net.b2),
  }
  const restore = () => {
    net.W1.set(snapshot.W1)
    net.b1.set(snapshot.b1)
    net.W2.set(snapshot.W2)
    net.b2.set(snapshot.b2)
  }

  // One full-batch step at lr = 1 leaves w_new = w_old - grad, so the analytic gradient
  // comes straight back out of the weight delta -- no extra export needed.
  trainEpochs(net, { rows, norm }, { epochs: 1, lr: 1, batchSize: rows.length })
  const analytic = {
    W1: snapshot.W1.map((w, i) => w - net.W1[i]),
    b1: snapshot.b1.map((w, i) => w - net.b1[i]),
    W2: snapshot.W2.map((w, i) => w - net.W2[i]),
    b2: snapshot.b2.map((w, i) => w - net.b2[i]),
  }
  restore()

  const h = 1e-5
  const checkOne = (name, arr, i) => {
    const base = arr[i]
    arr[i] = base + h
    const up = loss()
    arr[i] = base - h
    const down = loss()
    arr[i] = base
    const fd = (up - down) / (2 * h)
    const got = analytic[name][i]
    const tol = 1e-6 * Math.max(1, Math.abs(fd))
    assert.ok(
      Math.abs(fd - got) <= tol,
      `${name}[${i}]: analytic ${got} vs finite difference ${fd} (diff ${Math.abs(fd - got)})`,
    )
    return Math.abs(fd - got)
  }

  let worst = 0
  let checked = 0
  for (const i of [0, 1, 5, 7, 11, 17]) worst = Math.max(worst, checkOne('W1', net.W1, i)), (checked += 1)
  for (const i of [0, 1, 2]) worst = Math.max(worst, checkOne('b1', net.b1, i)), (checked += 1)
  for (const i of [0, 1, 2]) worst = Math.max(worst, checkOne('W2', net.W2, i)), (checked += 1)
  worst = Math.max(worst, checkOne('b2', net.b2, 0))
  checked += 1

  console.log(
    `gradient check: ${checked} weights, max |analytic - central difference| = ${worst.toExponential(3)}`,
  )
})

test('5. training reduces training loss over a meaningful run', () => {
  const { rows } = makeDataset({ n: 400, noise: 2, seed: 21 })
  const { train, test } = splitDataset(rows, { testFrac: 0.2, seed: 21 })
  const norm = standardise(train)
  const net = createNetwork({ hidden: 8, seed: 21 })

  const { history } = trainEpochs(net, { rows: train, norm }, {
    epochs: 200,
    lr: 0.05,
    batchSize: 16,
    validation: test,
  })

  assert.equal(history.length, 200)
  assert.ok(history.every((h) => Number.isFinite(h.trainLoss) && Number.isFinite(h.valLoss)))
  assert.ok(history[0].trainLoss > history[199].trainLoss * 3, 'loss barely moved')
  assert.ok(history[199].trainLoss < 0.2, `final standardised MSE ${history[199].trainLoss}`)

  // No validation set -> valLoss is explicitly null, never NaN.
  const bare = trainEpochs(createNetwork({ hidden: 3, seed: 1 }), train, { epochs: 2, lr: 0.05 })
  assert.equal(bare.history[0].valLoss, null)
})

test('6. the network beats the linear baseline on held-out data', () => {
  // THE claim the module rests on. If this fails the generator is not non-linear enough
  // and the generator is what needs fixing -- deleting this test deletes the point of the
  // whole module.
  //
  // Three seeds, not one. A single seed would pass by luck on a generator that had stopped
  // being non-linear; seed 2 is the narrowest margin found in a 12-seed sweep, so it is the
  // one that fails first if the interaction or saturation term is weakened.
  let lin
  let test
  for (const seed of [2, 7, 9]) {
    const { rows } = makeDataset({ n: 600, noise: 2.5, seed })
    const split = splitDataset(rows, { testFrac: 0.25, seed })
    test = split.test
    const norm = standardise(split.train)
    const net = createNetwork({ hidden: 8, seed })
    trainEpochs(net, { rows: split.train, norm }, {
      epochs: 400,
      lr: 0.05,
      batchSize: 16,
      validation: test,
    })

    const nn = evaluate(net, test, norm)
    lin = linearBaseline(split.train, test)

    console.log(
      `seed ${seed} held-out (n=${test.length}): ` +
        `linear R2 ${lin.metrics.r2.toFixed(4)} (RMSE ${lin.metrics.rmse.toFixed(2)}, MAE ${lin.metrics.mae.toFixed(2)}) ` +
        `vs network R2 ${nn.r2.toFixed(4)} (RMSE ${nn.rmse.toFixed(2)}, MAE ${nn.mae.toFixed(2)})`,
    )

    assert.ok(
      nn.r2 > lin.metrics.r2,
      `seed ${seed}: network R2 ${nn.r2} did not beat linear R2 ${lin.metrics.r2}`,
    )
    assert.ok(nn.rmse < lin.metrics.rmse, `seed ${seed}: network RMSE is no better`)
  }

  assert.equal(lin.coefficients.length, FEATURES.length)
  assert.ok(allFinite(lin.coefficients) && Number.isFinite(lin.intercept))
  assert.equal(lin.metrics.points.length, test.length)

  // A degenerate call must return numbers, not throw.
  const empty = linearBaseline([], [])
  assert.ok(allFinite(empty.coefficients) && Number.isFinite(empty.intercept))
  assert.equal(empty.metrics.r2, 0)
})

test('7. standardise uses training statistics only and survives a constant column', () => {
  const { rows } = makeDataset({ n: 200, noise: 2, seed: 33 })
  const { train, test } = splitDataset(rows, { testFrac: 0.3, seed: 33 })

  const norm = standardise(train)
  const manualMu = train.reduce((a, r) => a + r.features[0], 0) / train.length
  assert.ok(Math.abs(norm.mu[0] - manualMu) < 1e-12, 'mu is not the training-set mean')

  const manualTargetMu = train.reduce((a, r) => a + r.target, 0) / train.length
  assert.ok(Math.abs(norm.mu[T] - manualTargetMu) < 1e-12)

  // If the test split had leaked in, these would coincide.
  const leaky = standardise(rows)
  assert.notEqual(norm.mu[0], leaky.mu[0])
  assert.notEqual(norm.mu[T], leaky.mu[T])
  assert.notEqual(standardise(test).mu[T], norm.mu[T])

  // Zero-variance column: sigma falls back to 1, nothing is NaN, prediction stays finite.
  const flat = train.map((r) => ({ features: [3, ...r.features.slice(1)], target: r.target }))
  const flatNorm = standardise(flat)
  assert.equal(flatNorm.sigma[0], 1)
  assert.ok(allFinite([...flatNorm.mu, ...flatNorm.sigma]))

  const net = createNetwork({ hidden: 4, seed: 2 })
  trainEpochs(net, { rows: flat, norm: flatNorm }, { epochs: 5, lr: 0.05, batchSize: 8 })
  assert.ok(allFinite([...net.W1, ...net.b1, ...net.W2, ...net.b2]))
  assert.ok(Number.isFinite(predict(net, [3, 4, 2, 4, 3, 3], flatNorm)))

  // Fully constant dataset: every sigma, including the target's, falls back to 1.
  const constant = standardise([{ features: [1, 1, 1, 1, 1, 1], target: 50 }])
  assert.deepEqual([...constant.sigma], [1, 1, 1, 1, 1, 1, 1])
  assert.deepEqual([...standardise([]).sigma], [1, 1, 1, 1, 1, 1, 1])
})

test('8. evaluate metrics are finite, r2 <= 1, and a perfect predictor scores exactly 1', () => {
  const { rows } = makeDataset({ n: 150, noise: 3, seed: 12 })
  const norm = standardise(rows)
  const net = createNetwork({ hidden: 6, seed: 12 })
  trainEpochs(net, { rows, norm }, { epochs: 40, lr: 0.05, batchSize: 16 })

  const m = evaluate(net, rows, norm)
  assert.ok(allFinite([m.mae, m.rmse, m.r2]))
  assert.ok(m.r2 <= 1)
  assert.ok(m.mae >= 0 && m.rmse >= 0)
  assert.equal(m.points.length, rows.length)
  assert.ok(m.points.every((p) => Number.isFinite(p.actual) && Number.isFinite(p.predicted)))

  // A perfect predictor: label every row with what this very net predicts for it, then
  // score the net against those labels. SSres is exactly zero, so r2 must be exactly 1.
  const perfect = rows.map((r) => ({
    features: r.features,
    target: predict(net, r.features, norm),
  }))
  assert.equal(evaluate(net, perfect, norm).r2, 1)

  // Empty input and a garbage row must not produce NaN.
  const none = evaluate(net, [], norm)
  assert.ok(allFinite([none.mae, none.rmse, none.r2]))
  assert.ok(Number.isFinite(evaluate(net, [{ features: null, target: NaN }], norm).mae))
  assert.ok(Number.isFinite(predict(net, undefined, undefined)))
})

test('9. featureAttribution shares are finite, non-negative and sum to 1', () => {
  const { rows } = makeDataset({ n: 300, noise: 2, seed: 19 })
  const norm = standardise(rows)
  const net = createNetwork({ hidden: 8, seed: 19 })
  trainEpochs(net, { rows, norm }, { epochs: 120, lr: 0.05, batchSize: 16 })

  const attr = featureAttribution(net, norm)
  assert.equal(attr.length, FEATURES.length)
  assert.deepEqual(attr.map((a) => a.key), FEATURES.map((f) => f.key))

  for (const a of attr) {
    assert.ok(Number.isFinite(a.weight) && a.weight >= 0, `weight ${a.weight}`)
    assert.ok(Number.isFinite(a.share) && a.share >= 0, `share ${a.share}`)
    assert.equal(typeof a.label, 'string')
  }
  const total = attr.reduce((s, a) => s + a.share, 0)
  assert.ok(Math.abs(total - 1) < 1e-12, `shares sum to ${total}`)

  // An all-zero net cannot divide by zero -- it splits evenly.
  const dead = createNetwork({ hidden: 4, seed: 1 })
  dead.W1.fill(0)
  dead.W2.fill(0)
  const even = featureAttribution(dead, norm)
  assert.ok(even.every((a) => Math.abs(a.share - 1 / FEATURES.length) < 1e-12))
})

test('10. profileToFeatures tolerates null and partial profiles', () => {
  const ok = (f) => {
    assert.equal(f.length, FEATURES.length)
    assert.ok(allFinite(f), `non-finite feature in ${JSON.stringify(f)}`)
    for (const v of f) assert.ok(v >= 1 && v <= 5, `feature ${v} outside 1..5`)
  }

  ok(profileToFeatures(null))
  ok(profileToFeatures(undefined))
  ok(profileToFeatures({}))
  ok(profileToFeatures({ monthlyIncome: 75000 }))
  ok(profileToFeatures({ emergencyMonths: 4.5, horizonYears: 10 }))
  ok(profileToFeatures({ monthlyIncome: 0, monthlyExpenses: 'x', emiLoad: null }))
  ok(profileToFeatures({ monthlyIncome: -5, monthlyExpenses: NaN, emergencyMonths: Infinity }))

  assert.deepEqual(profileToFeatures(null), [3, 3, 3, 3, 3, 3])

  // Directions: a strong household must not score below a stressed one on any column.
  const strong = profileToFeatures({
    monthlyIncome: 300000,
    monthlyExpenses: 60000,
    emiLoad: 0,
    dependents: 0,
    emergencyMonths: 12,
    horizonYears: 20,
  })
  const stressed = profileToFeatures({
    monthlyIncome: 18000,
    monthlyExpenses: 16000,
    emiLoad: 9000,
    dependents: 4,
    emergencyMonths: 0,
    horizonYears: 1,
  })
  ok(strong)
  ok(stressed)
  assert.deepEqual(strong, [5, 5, 1, 5, 5, 5])
  assert.deepEqual(stressed, [1, 1, 5, 1, 1, 1])
})

test('11. histogram covers the range, counts sum to the input length, empty is safe', () => {
  const { rows } = makeDataset({ n: 500, noise: 3, seed: 4 })
  const values = rows.map((r) => r.target)
  const bins = histogram(values, 12)

  assert.equal(bins.length, 12)
  assert.equal(bins.reduce((s, b) => s + b.count, 0), values.length)
  assert.ok(Math.abs(bins[0].x0 - Math.min(...values)) < 1e-12)
  assert.ok(Math.abs(bins[11].x1 - Math.max(...values)) < 1e-12)
  for (let i = 0; i < bins.length; i += 1) {
    assert.ok(bins[i].x1 > bins[i].x0, 'zero-width bin')
    assert.ok(allFinite([bins[i].x0, bins[i].x1, bins[i].count]))
    if (i > 0) assert.ok(Math.abs(bins[i].x0 - bins[i - 1].x1) < 1e-9, 'gap between bins')
  }

  assert.deepEqual(histogram([], 10), [])
  assert.deepEqual(histogram(null, 10), [])
  assert.deepEqual(histogram(undefined, undefined), [])

  // All identical values: one unit-wide bin holding everything, never zero width.
  const flat = histogram([7, 7, 7, 7], 5)
  assert.equal(flat.reduce((s, b) => s + b.count, 0), 4)
  assert.ok(flat.every((b) => b.x1 > b.x0))
  assert.equal(histogram([3], 4).reduce((s, b) => s + b.count, 0), 1)

  // Bad bin counts degrade rather than throw.
  assert.equal(histogram(values, 0).length, 10)
  assert.equal(histogram(values, -3).length, 1)
  assert.equal(histogram(values, NaN).length, 10)
})
