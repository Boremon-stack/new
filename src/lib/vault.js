// Nominee Vault pure logic (FR-NV-03, FR-NV-06, FR-NV-11).
// Everything here is side-effect free and clock-free so NomineeVault.jsx stays
// a thin rendering shell and src/lib/vault.test.mjs can assert the real rules.
import { inr } from './inr.js'

export const INACTIVITY_DAYS = 48

const EM_DASH = '\u2014'
const NO_ASSETS_LINE = '- No assets recorded in FinNexus yet.'
const NO_MESSAGE_LINE = '(No additional message was left.)'
const NAME_PLACEHOLDER = '[Recipient Name]'

export const DEFAULT_VAULT = {
  recipientName: '',
  recipientEmail: '',
  assetList: '',
  customMessage: '',
  subject: 'FinNexus asset summary for {{recipientName}}',
  template: `Dear {{recipientName}},

This message was prepared in advance by a FinNexus account holder and released
automatically because the account recorded no login for {{inactivityDays}} days.

Asset summary as of {{date}}:

{{assetList}}

A personal message from the account holder:

{{customMessage}}

This summary is informational only. It is not a legal instrument and confers no
title. Please check the account holder's own nominee records with each
institution before acting on it.

{{inactivityDays}}-day inactivity protocol — FinNexus Nominee Vault
Addressed to {{recipientEmail}}`,
  dispatches: [],
}

const pad2 = (n) => String(n).padStart(2, '0')
const num = (v) => (Number.isFinite(+v) ? +v : 0)
const text = (v) => (typeof v === 'string' ? v.trim() : '')

const DATE_FMT = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
})

/**
 * The accounts module may emit `maturityOn` as either '2028-09-13' or a full
 * ISO timestamp; a nominee must never read '2028-09-13T04:55:54.194Z' in a
 * disclosure email. Anything unparseable is returned untouched rather than
 * dropped, so an unexpected format degrades to the raw value, not to nothing.
 */
function humanDate(value) {
  const raw = text(value)
  const day = raw.slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return raw
  const parsed = new Date(`${day}T00:00:00Z`)
  return Number.isNaN(parsed.getTime()) ? raw : DATE_FMT.format(parsed)
}

/**
 * FR-NV-03 / TC-08: exactly `48d 00h 00m 00s`. Days unpadded, h/m/s padded to
 * two digits. Negative, NaN and missing values all clamp to `0d 00h 00m 00s`.
 */
export function formatCountdown(msRemaining) {
  const ms = Math.max(0, num(msRemaining))
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 86400)}d ${pad2(Math.floor(s / 3600) % 24)}h ${pad2(Math.floor(s / 60) % 60)}m ${pad2(s % 60)}s`
}

/**
 * FR-NV-11: one readable line per linked account. Every numeric field is
 * treated as possibly absent -- the accounts module is written separately, so a
 * missing `meta.rate` must degrade to a shorter line, never to `NaN`.
 */
export function buildAssetLines(accounts) {
  const list = Array.isArray(accounts) ? accounts.filter(Boolean) : []

  return list
    .map((a) => {
      const meta = a.meta && typeof a.meta === 'object' ? a.meta : {}

      if (a.kind === 'FD') {
        const head = [a.institution, 'FD', a.label].map(text).filter(Boolean).join(' ')
        const principal = num(meta.principal) || num(a.balance)
        const rate = num(meta.rate)
        const maturityValue = num(meta.maturityValue)
        let tail = inr(principal)
        if (rate > 0) tail += ` at ${rate}% p.a.`
        if (text(meta.maturityOn)) tail += `, matures ${humanDate(meta.maturityOn)}`
        if (maturityValue > 0) tail += ` (${inr(maturityValue)})`
        return `- ${head || 'Fixed deposit'} ${EM_DASH} ${tail}`
      }

      const head = [a.institution, meta.accountType, a.label].map(text).filter(Boolean).join(' ')
      return `- ${head || 'Bank account'} ${EM_DASH} ${inr(a.balance)}`
    })
    .join('\n')
}

/**
 * FR-NV-06: template driven. `now` is injected rather than read from the clock
 * so the same vault always renders the same email in a test.
 */
export function renderEmail({ vault, accounts, now } = {}) {
  const v = { ...DEFAULT_VAULT, ...(vault || {}) }
  const ts = now instanceof Date ? now.getTime() : +now
  const typed = text(v.assetList)

  const vars = {
    recipientName: text(v.recipientName) || NAME_PLACEHOLDER,
    recipientEmail: text(v.recipientEmail),
    assetList: typed || text(buildAssetLines(accounts)) || NO_ASSETS_LINE,
    customMessage: text(v.customMessage) || NO_MESSAGE_LINE,
    date: Number.isFinite(ts) ? new Date(ts).toISOString().slice(0, 10) : '',
    inactivityDays: String(INACTIVITY_DAYS),
  }

  // Unknown placeholders are left verbatim so a typo is visible in the preview
  // instead of silently deleting a line of the letter.
  const fill = (s) => String(s ?? '').replace(/\{\{(\w+)\}\}/g, (hit, key) => (key in vars ? vars[key] : hit))

  return { to: vars.recipientEmail, subject: fill(v.subject), body: fill(v.template) }
}

/** PRD Section 6: v1.0 dispatch is the mailto: protocol, not SMTP. */
export function mailtoHref({ to, subject, body } = {}) {
  // `@` is an addr-spec delimiter in RFC 6068 and stays literal; everything
  // else in the address, and all of the subject and body, is percent-encoded.
  const addr = encodeURIComponent(String(to ?? '')).replace(/%40/g, '@')
  return `mailto:${addr}?subject=${encodeURIComponent(String(subject ?? ''))}&body=${encodeURIComponent(String(body ?? ''))}`
}
