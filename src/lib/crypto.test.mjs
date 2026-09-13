import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sealVault, openVault, CRYPTO_PARAMS } from './crypto.js'

// The browser globals the module is written against. Node exposes WebCrypto and
// Buffer but not btoa/atob-on-latin1 in every mode, so pin them here rather
// than weakening the module for the sake of the test.
globalThis.btoa ??= (s) => Buffer.from(s, 'binary').toString('base64')
globalThis.atob ??= (s) => Buffer.from(s, 'base64').toString('binary')

// A low iteration count keeps the suite fast. The production default is
// asserted separately, so a regression there still fails.
const FAST = { iterations: 1000 }
const PASS = 'correct horse battery staple'

test('production parameters are the ones claimed: AES-256-GCM, PBKDF2-SHA256', () => {
  assert.equal(CRYPTO_PARAMS.algorithm, 'AES-256-GCM')
  assert.equal(CRYPTO_PARAMS.kdf, 'PBKDF2-HMAC-SHA256')
  assert.equal(CRYPTO_PARAMS.keyBits, 256)
  assert.equal(CRYPTO_PARAMS.ivBytes, 12)
  assert.ok(CRYPTO_PARAMS.iterations >= 600000, 'PBKDF2 must meet the OWASP floor')
})

test('a sealed payload round-trips', async () => {
  const text = 'HDFC Bank Savings XXXX 4821 — ₹1,84,500'
  const sealed = await sealVault(text, PASS, FAST)
  assert.equal(sealed.alg, 'AES-256-GCM')
  assert.notEqual(sealed.ciphertext, '')
  assert.equal(await openVault(sealed, PASS), text)
})

test('the ciphertext does not contain the plaintext', async () => {
  const sealed = await sealVault('nominee: Asha Rao', PASS, FAST)
  const blob = `${sealed.ciphertext}${sealed.iv}${sealed.salt}`
  assert.ok(!blob.includes('Asha'), 'plaintext leaked into the envelope')
  assert.ok(!Buffer.from(sealed.ciphertext, 'base64').toString('utf8').includes('Asha'))
})

test('the same input sealed twice yields different bytes', async () => {
  const a = await sealVault('same input', PASS, FAST)
  const b = await sealVault('same input', PASS, FAST)
  assert.notEqual(a.salt, b.salt, 'salt must be per-seal')
  assert.notEqual(a.iv, b.iv, 'IV must be per-seal')
  assert.notEqual(a.ciphertext, b.ciphertext)
  // ...and both still open.
  assert.equal(await openVault(a, PASS), 'same input')
  assert.equal(await openVault(b, PASS), 'same input')
})

test('a wrong passphrase throws rather than returning wrong plaintext', async () => {
  const sealed = await sealVault('asset list', PASS, FAST)
  await assert.rejects(() => openVault(sealed, 'wrong passphrase'), /wrong passphrase, or the sealed data was altered/)
})

test('tampering with the ciphertext, IV or salt is detected', async () => {
  const original = await sealVault('asset list for the nominee', PASS, FAST)

  const flip = (b64) => {
    const bytes = Buffer.from(b64, 'base64')
    bytes[0] ^= 0xff
    return bytes.toString('base64')
  }

  for (const field of ['ciphertext', 'iv', 'salt']) {
    const tampered = { ...original, [field]: flip(original[field]) }
    await assert.rejects(() => openVault(tampered, PASS), Error, `tampered ${field} was not rejected`)
  }
})

test('unicode and empty payloads survive the round trip', async () => {
  for (const text of ['', '₹1,25,000', 'नामांकित व्यक्ति', 'emoji 🪙 and \n newlines \t tabs']) {
    const sealed = await sealVault(text, PASS, FAST)
    assert.equal(await openVault(sealed, PASS), text)
  }
})

test('a missing passphrase is refused on both paths', async () => {
  await assert.rejects(() => sealVault('x', ''), /passphrase is required/)
  const sealed = await sealVault('x', PASS, FAST)
  await assert.rejects(() => openVault(sealed, ''), /passphrase is required/)
})

test('an unknown envelope version is refused rather than guessed at', async () => {
  const sealed = await sealVault('x', PASS, FAST)
  await assert.rejects(() => openVault({ ...sealed, v: 99 }, PASS), /Unsupported vault envelope version/)
})
