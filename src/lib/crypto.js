/**
 * AES-256-GCM sealing for the Nominee Vault disclosure payload.
 *
 * The project's literature review names the gap it is filling as the absence of
 * "a concrete implementation model for AES-256 encrypted Dead Man's Switch
 * protocols" meeting the DPDP Act (2023). This is that implementation: real
 * WebCrypto, not a label on plaintext.
 *
 * Construction
 *   key    PBKDF2-HMAC-SHA256, random 16-byte salt, 600,000 iterations
 *          (OWASP's 2023 floor for PBKDF2-SHA256), derived to a 256-bit key
 *   cipher AES-GCM with a random 96-bit IV, the size the GCM spec is built
 *          around; a fresh salt AND IV are generated per seal, so sealing the
 *          same text twice never yields the same bytes
 *   auth   GCM's own 128-bit tag. Any edit to the ciphertext, IV or salt makes
 *          decryption throw rather than return wrong plaintext.
 *
 * What this does NOT do, stated plainly so the guarantee is not overread: the
 * passphrase never leaves the tab and is never stored, so a vault sealed here
 * can only be opened by someone who knows it. That is the point, and it is also
 * the limit -- FinNexus cannot open it for the nominee either. Delivering the
 * passphrase to the nominee is a key-escrow problem this build does not solve.
 *
 * ponytail: passphrase-derived key, no escrow. Phase 2 needs a server-held
 * escrow or Shamir split before an automated dispatch can actually be read.
 */

const KDF_ITERATIONS = 600000
const SALT_BYTES = 16
const IV_BYTES = 12
const KEY_BITS = 256

const enc = new TextEncoder()
const dec = new TextDecoder()

function subtle() {
  const c = globalThis.crypto
  if (!c || !c.subtle) {
    throw new Error('WebCrypto unavailable. Use a secure origin (https, or http://localhost).')
  }
  return c
}

const toB64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)))

function fromB64(text) {
  const bin = atob(text)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i)
  return out
}

async function deriveKey(passphrase, salt, iterations) {
  const c = subtle()
  const material = await c.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey'])
  return c.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: KEY_BITS },
    false,
    ['encrypt', 'decrypt'],
  )
}

/**
 * Seal plaintext under a passphrase. Returns a self-describing envelope: it
 * carries the parameters needed to re-derive the key, so a future change to
 * the iteration count cannot silently break already-sealed payloads.
 */
export async function sealVault(plaintext, passphrase, { iterations = KDF_ITERATIONS } = {}) {
  if (typeof plaintext !== 'string') throw new TypeError('plaintext must be a string')
  if (!passphrase) throw new Error('A passphrase is required to seal the vault.')

  const c = subtle()
  const salt = c.getRandomValues(new Uint8Array(SALT_BYTES))
  const iv = c.getRandomValues(new Uint8Array(IV_BYTES))
  const key = await deriveKey(passphrase, salt, iterations)
  const ciphertext = await c.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext))

  return {
    v: 1,
    alg: 'AES-256-GCM',
    kdf: 'PBKDF2-SHA256',
    iterations,
    salt: toB64(salt),
    iv: toB64(iv),
    ciphertext: toB64(ciphertext),
    sealedBytes: new Uint8Array(ciphertext).byteLength,
  }
}

/**
 * Open a sealed envelope. A wrong passphrase, or any tampering with the
 * ciphertext, IV or salt, fails the GCM tag and throws -- it never returns
 * plausible-but-wrong plaintext.
 */
export async function openVault(sealed, passphrase) {
  if (!sealed || typeof sealed !== 'object') throw new TypeError('sealed envelope required')
  if (sealed.v !== 1) throw new Error(`Unsupported vault envelope version: ${sealed.v}`)
  if (!passphrase) throw new Error('A passphrase is required to open the vault.')

  const c = subtle()
  const salt = fromB64(sealed.salt)
  const iv = fromB64(sealed.iv)
  const key = await deriveKey(passphrase, salt, sealed.iterations || KDF_ITERATIONS)

  let plain
  try {
    plain = await c.subtle.decrypt({ name: 'AES-GCM', iv }, key, fromB64(sealed.ciphertext))
  } catch {
    // GCM gives one indistinguishable failure for a wrong key and for tampering.
    // Report it as one thing, so the message leaks nothing about which it was.
    throw new Error('Could not open the vault: wrong passphrase, or the sealed data was altered.')
  }
  return dec.decode(plain)
}

export const CRYPTO_PARAMS = Object.freeze({
  algorithm: 'AES-256-GCM',
  kdf: 'PBKDF2-HMAC-SHA256',
  iterations: KDF_ITERATIONS,
  saltBytes: SALT_BYTES,
  ivBytes: IV_BYTES,
  keyBits: KEY_BITS,
})
