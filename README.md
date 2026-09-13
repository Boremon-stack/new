# FinNexus — Finance Studio

A comprehensive AI-powered financial control panel for Indian retail investors.

Live: <https://finnexus-one.vercel.app/>

Sheersha Saini (2427030582) · Lakshya Kumar Srivastava (2427030611)
Supervised by Dr. Shishir Singh Chauhan
Department of Computer Science and Engineering, Manipal University Jaipur

---

## What this is

A React single-page application implementing the FinNexus concept end to end. It covers the five
modules specified in the Product Requirements Document, plus the three modules the project
presentation pitches but the PRD scopes out of v1.0 — the liquidity buffer, the forecasting layer,
and the cross-broker tax optimiser.

| Panel | What it does | Source |
|---|---|---|
| Authentication Gateway | Identity-checked entry to the Control Center | `src/Login.jsx` |
| Financial Connections | Links bank accounts and fixed deposits | `src/Accounts.jsx` |
| Portfolio & Commitments | Demat holdings across brokers, and recurring debits | `src/Portfolio.jsx` |
| Risk Profile Quiz | 20 questions calibrated for Indian households → a risk mode | `src/Quiz.jsx`, `src/lib/quiz.js` |
| Budget Blueprint | Needs / Wants / Savings / Investments plan, plus spend analysis | `src/Blueprint.jsx`, `src/lib/blueprint.js` |
| Intelligent Liquidity Buffer | Outflow calendar, bounce prediction, transfer instructions | `src/Liquidity.jsx`, `src/lib/liquidity.js` |
| Financial Brain | Balance projection, natural-language goal planning, instrument fit | `src/Brain.jsx`, `src/lib/forecast.js` |
| Cross-Platform Tax Optimizer | STCG/LTCG across brokers, tax-loss harvesting | `src/TaxOptimizer.jsx`, `src/lib/tax.js` |
| Nominee Vault | 48-day inactivity protocol and AES-256-GCM sealed disclosure | `src/NomineeVault.jsx`, `src/lib/vault.js`, `src/lib/crypto.js` |

## Quick start

```bash
npm install
npm run dev
```

Demo credentials are shown on the login screen:

```
Login ID   demo@finnexus.in
Password   FinNexus@2026
```

```bash
npm test         # 56 logic self-checks
npm run build    # production bundle into dist/
npm run preview  # serve the built bundle
```

## The three modules worth demonstrating

**Balance Blindness.** Link two bank accounts — one funded, one nearly empty — and point a large EMI
at the empty one. Aggregate net worth is healthy, so no conventional tracker raises anything. The
Liquidity Buffer predicts the specific bounce, names the date and the shortfall, and gives the exact
transfer that prevents it. Fixed deposits are deliberately excluded from the donor pool: an FD is
locked principal, so an FD-only surplus is reported as a genuine cash shortfall rather than a
transfer.

**Cross-broker tax offset.** Add holdings at more than one broker, including a loser. Capital gains
tax is charged on the person, not on the demat account, so a debt-fund loss at one broker offsets an
equity gain at another — the claim single-broker tools cannot make. The harvesting plan ranks
candidates by tax actually saved, not by headline loss, so a long-term loss sitting behind an
already-exempt gain is reported as worth nothing rather than recommended as a sale.

**Natural-language goals.** The planner parses `"Save 5 Lakhs for a car by 2028"` into ₹5,00,000 by
31 December 2028, and turns it into a required monthly contribution using the future value of an
ordinary annuity, not a plain division.

## Architecture

| Layer | Implementation |
|---|---|
| Frontend | React 19, built with Vite |
| Styling | Plain CSS over a measured token layer (`src/styles.css`) |
| State | React state mirrored into `sessionStorage` (`src/lib/useSession.js`) |
| Logic | Pure functions in `src/lib/`, each with a `node:test` self-check |
| Encryption | WebCrypto AES-256-GCM, PBKDF2-SHA256 (`src/lib/crypto.js`) |
| Serverless | `api/ml-analyze.js`, retained from the previous build |
| ML workspace | `ml-prediction/`, retained, separate from the site runtime |
| Deployment | Vercel |

Runtime dependencies are `react` and `react-dom`. There is no UI kit, state library, date library or
chart library — currency uses `Intl.NumberFormat('en-IN')`, and the charts are inline SVG.

### Colour system

The palette is called **Ledger** and is defined once as custom properties at the top of
`src/styles.css`: a desaturated indigo-slate ground, warm paper-white type, a brass accent that also
carries "needs attention" so warnings add no sixth hue, sage for positive and terracotta for
negative. Every foreground/background pair the interface renders is measured against WCAG 2.1 AA —
4.5:1 for text, 3:1 for the focus ring — with `--ink-3` on `--surface-2` the tightest at 4.61:1.
Module stylesheets declare no colours of their own, so the whole interface re-themes from that one
block. Changing a token means re-running the contrast check.

### Honest labelling

The Financial Brain is a deterministic calendar-and-arithmetic engine, and the interface says so
rather than calling it a prediction from a trained model. Account, holding and transaction data is
entered by hand: no live bank, broker or depository connection is made. Tax figures are estimates,
not advice. Each deliberate simplification carries a `ponytail:` comment in the source naming its
ceiling and the upgrade path.

The AES-256-GCM sealing is real encryption, and its limit is stated in the module: the passphrase is
never stored and never leaves the tab, which also means FinNexus cannot open a sealed vault for the
nominee. Delivering that passphrase is a key-escrow problem this build does not solve.

## Testing

```bash
npm test
```

56 checks across seven pure-logic modules, run by the Node test runner with no framework. They cover
the risk-scoring bands and their safety cap, budget allocations that must sum exactly to income,
capital-gains boundaries at 12 and 24 months, the loss-offset asymmetry between short- and long-term
losses, financial-year derivation, natural-language goal parsing, annuity arithmetic, the countdown
format, email template substitution, and AES round-trip plus tamper detection.

## Known limits

No backend and no database: state lives in `sessionStorage` and is cleared when the tab closes. The
inactivity countdown is client-side and only advances while a tab is open. Email uses the `mailto:`
protocol rather than server-side SMTP. Account, holding and transaction data is operator-entered
rather than fetched through the RBI Account Aggregator or NSDL/CDSL. Risk profiling is rule-based
rather than model-based. These are the Phase-2 items in the project documentation, not defects.
