// Self-check for the Nominee Vault logic: node --test src/lib/vault.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_VAULT, INACTIVITY_DAYS, formatCountdown, buildAssetLines, renderEmail, mailtoHref } from './vault.js'

const DAY = 86400000
const PLACEHOLDERS = ['{{recipientName}}', '{{recipientEmail}}', '{{assetList}}', '{{customMessage}}', '{{date}}', '{{inactivityDays}}']

const ACCOUNTS = [
  {
    id: 'a1', kind: 'BANK', institution: 'HDFC Bank', label: 'XXXX XXXX 4821',
    balance: 240000, linkedAt: '2026-09-01T00:00:00.000Z',
    meta: { accountType: 'savings', ifsc: 'HDFC0000123', monthlyCredit: 85000 },
  },
  {
    id: 'a2', kind: 'FD', institution: 'ICICI Bank', label: 'FD-XXXX-7730',
    balance: 150000, linkedAt: '2026-09-01T00:00:00.000Z',
    meta: { principal: 150000, rate: 7.1, tenureMonths: 18, maturityOn: '2027-03-14', maturityValue: 172940 },
  },
]

// ---- FR-NV-03 / TC-08: the countdown format is an acceptance test, not a detail.

test('formatCountdown renders the exact PRD format', () => {
  assert.equal(formatCountdown(INACTIVITY_DAYS * DAY), '48d 00h 00m 00s')
  assert.equal(formatCountdown(0), '0d 00h 00m 00s')
  assert.equal(formatCountdown(-1), '0d 00h 00m 00s')
  assert.equal(formatCountdown(-5 * DAY), '0d 00h 00m 00s')
  assert.equal(formatCountdown(DAY + 2 * 3600000 + 3 * 60000 + 4000), '1d 02h 03m 04s')
  assert.equal(formatCountdown(999), '0d 00h 00m 00s')
  assert.equal(formatCountdown(47 * DAY + 23 * 3600000 + 59 * 60000 + 59000), '47d 23h 59m 59s')
  // Missing / non-numeric input clamps rather than printing NaN.
  assert.equal(formatCountdown(undefined), '0d 00h 00m 00s')
  assert.equal(formatCountdown(null), '0d 00h 00m 00s')
})

test('formatCountdown always pads h/m/s to two digits', () => {
  const samples = [
    0, 1, 999, 1000, 59000, 60000, 61000, 3599000, 3600000, 3661000,
    DAY - 1, DAY, DAY + 1, 9 * DAY + 9 * 3600000 + 9 * 60000 + 9000, 48 * DAY, 123 * DAY + 7,
  ]
  for (const ms of samples) {
    const out = formatCountdown(ms)
    assert.match(out, /^\d+d \d{2}h \d{2}m \d{2}s$/, `bad shape for ${ms}: ${out}`)
    assert.doesNotMatch(out, /NaN|undefined/, `bad value for ${ms}: ${out}`)
  }
})

// ---- FR-NV-06: template substitution.

test('renderEmail substitutes every known placeholder and leaves unknown ones alone', () => {
  const mail = renderEmail({
    vault: {
      ...DEFAULT_VAULT,
      recipientName: 'Asha Rao',
      recipientEmail: 'asha@example.com',
      customMessage: 'Everything is in the blue folder.',
      subject: '{{recipientName}} / {{date}} / {{nope}}',
      template: 'To {{recipientName}} at {{recipientEmail}} on {{date}}\n{{assetList}}\n{{customMessage}}\n{{inactivityDays}} days\n{{nope}}',
    },
    accounts: ACCOUNTS,
    now: Date.UTC(2026, 8, 13),
  })

  assert.equal(mail.to, 'asha@example.com')
  assert.equal(mail.subject, 'Asha Rao / 2026-09-13 / {{nope}}')
  assert.match(mail.body, /^To Asha Rao at asha@example\.com on 2026-09-13$/m)
  assert.match(mail.body, /Everything is in the blue folder\./)
  assert.match(mail.body, /^48 days$/m)
  // The unknown placeholder survives; every known one is gone.
  assert.match(mail.body, /\{\{nope\}\}/)
  for (const p of PLACEHOLDERS) {
    assert.ok(!mail.body.includes(p), `body still contains ${p}`)
    assert.ok(!mail.subject.includes(p), `subject still contains ${p}`)
  }
})

test('the shipped default subject and template leave no placeholder behind', () => {
  const mail = renderEmail({
    vault: { ...DEFAULT_VAULT, recipientName: 'Asha Rao', recipientEmail: 'asha@example.com' },
    accounts: ACCOUNTS,
    now: Date.UTC(2026, 8, 13),
  })
  for (const p of PLACEHOLDERS) {
    assert.ok(!mail.body.includes(p), `default template still contains ${p}`)
    assert.ok(!mail.subject.includes(p), `default subject still contains ${p}`)
  }
  assert.equal(mail.subject, 'FinNexus asset summary for Asha Rao')
  assert.doesNotMatch(mail.body, /NaN|undefined/)
})

// ---- FR-NV-11: a typed list wins, the linked accounts are the fallback.

test('renderEmail falls back to the linked accounts when no list is typed', () => {
  const now = Date.UTC(2026, 8, 13)
  const base = { ...DEFAULT_VAULT, recipientName: 'Asha Rao', recipientEmail: 'asha@example.com' }

  const fromAccounts = renderEmail({ vault: base, accounts: ACCOUNTS, now })
  assert.ok(fromAccounts.body.includes(buildAssetLines(ACCOUNTS)), 'linked accounts not used as the fallback')
  assert.match(fromAccounts.body, /HDFC Bank savings XXXX XXXX 4821/)

  const typed = renderEmail({ vault: { ...base, assetList: 'Locker 19, Karol Bagh branch' }, accounts: ACCOUNTS, now })
  assert.match(typed.body, /Locker 19, Karol Bagh branch/)
  assert.ok(!typed.body.includes('HDFC Bank'), 'a typed list must override the linked accounts')

  const neither = renderEmail({ vault: base, accounts: [], now })
  assert.match(neither.body, /No assets recorded in FinNexus yet\./)
})

// ---- the accounts module is written in parallel, so assume fields go missing.

test('buildAssetLines never emits NaN or undefined for partial accounts', () => {
  const partial = [
    { id: 'p1', kind: 'BANK', institution: 'HDFC Bank', label: 'XXXX XXXX 4821', meta: { accountType: 'savings' } },
    { id: 'p2', kind: 'FD', institution: 'ICICI Bank', label: 'FD-XXXX-7730', meta: {} },
    { id: 'p3', kind: 'FD', institution: 'SBI' },
    { id: 'p4', kind: 'BANK' },
    { id: 'p5', kind: 'FD', institution: 'Axis Bank', label: 'FD-1', balance: 50000, meta: { rate: null, maturityOn: undefined, maturityValue: NaN } },
    null,
  ]
  const out = buildAssetLines(partial)
  assert.doesNotMatch(out, /NaN/)
  assert.doesNotMatch(out, /undefined/)
  assert.equal(out.split('\n').length, 5, 'one line per non-null account')

  assert.equal(buildAssetLines([]), '')
  assert.equal(buildAssetLines(undefined), '')
  assert.equal(buildAssetLines(null), '')
})

test('buildAssetLines renders a full FD with its rate and maturity', () => {
  const line = buildAssetLines([ACCOUNTS[1]])
  assert.match(line, /^- ICICI Bank FD FD-XXXX-7730 /)
  assert.match(line, /at 7\.1% p\.a\., matures 14 Mar 2027 /)
})

// ---- FR-NV-09: the mailto: link is the entire v1.0 dispatch path.

test('mailtoHref percent-encodes the subject and body and round-trips', () => {
  const body = 'Line one\nLine two & three #4\nRupees: 2,40,000'
  const subject = 'Summary & status #1'
  const href = mailtoHref({ to: 'asha@example.com', subject, body })

  assert.ok(href.startsWith('mailto:asha@example.com?subject='), `wrong recipient: ${href}`)
  assert.ok(!href.includes('\n'), 'a raw newline leaked into the href')

  const rest = href.slice('mailto:asha@example.com?subject='.length)
  const [encSubject, encBody] = rest.split('&body=')
  assert.equal(decodeURIComponent(encSubject), subject)
  assert.equal(decodeURIComponent(encBody), body)
  // The delimiters themselves are encoded, not passed through.
  assert.ok(encBody.includes('%0A'), `newline not encoded: ${encBody}`)
  assert.ok(encBody.includes('%26'), `ampersand not encoded: ${encBody}`)
  assert.ok(encBody.includes('%23'), `hash not encoded: ${encBody}`)
  assert.equal(mailtoHref(), 'mailto:?subject=&body=')
})

// ---- the component reads these keys directly.

test('DEFAULT_VAULT carries every key the component relies on', () => {
  assert.deepEqual(
    Object.keys(DEFAULT_VAULT).sort(),
    ['assetList', 'customMessage', 'dispatches', 'recipientEmail', 'recipientName', 'subject', 'template'].sort(),
  )
  assert.deepEqual(DEFAULT_VAULT.dispatches, [])
  assert.equal(DEFAULT_VAULT.recipientName, '')
  assert.equal(DEFAULT_VAULT.recipientEmail, '')
  assert.equal(DEFAULT_VAULT.assetList, '')
  assert.equal(DEFAULT_VAULT.customMessage, '')
  assert.ok(DEFAULT_VAULT.subject.length > 0)
  assert.ok(DEFAULT_VAULT.template.includes('\n'), 'the default template is multi-line')
  assert.equal(INACTIVITY_DAYS, 48)
})

// Regression: the accounts module emits `maturityOn` as a full ISO timestamp,
// so a nominee was reading 'matures 2028-09-13T04:55:54.194Z' in the email.
test('buildAssetLines renders a maturity date, never a raw ISO timestamp', () => {
  const fd = (maturityOn) => [{
    id: 'f1', kind: 'FD', institution: 'State Bank of India', label: 'FD-XXXX-7730',
    balance: 250000, meta: { principal: 250000, rate: 7.1, tenureMonths: 24, maturityOn, maturityValue: 287785 },
  }]

  const fromTimestamp = buildAssetLines(fd('2028-09-13T04:55:54.194Z'))
  assert.ok(!/T\d{2}:\d{2}/.test(fromTimestamp), `raw timestamp leaked: ${fromTimestamp}`)
  assert.ok(!fromTimestamp.includes('Z ('), `trailing Z leaked: ${fromTimestamp}`)
  assert.match(fromTimestamp, /matures 13 Sep/)
  assert.match(fromTimestamp, /2028/)

  // A date-only value must not shift a day, and must format identically.
  assert.equal(buildAssetLines(fd('2028-09-13')), fromTimestamp)

  // Unparseable input degrades to the raw value rather than vanishing.
  assert.match(buildAssetLines(fd('next Diwali')), /matures next Diwali/)
})
