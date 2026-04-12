# FinNexus

FinNexus is a minimal finance web app with a secure-style login, a 20-question financial condition quiz, and budget automation recommendations.

## What it includes

- Branded login screen for FinNexus
- ID + password check in the frontend
- 20-question financial condition analyzer
- Budget split output (essentials, debt, savings, investments, lifestyle)
- Connect Bank Account / Connect FD simulation buttons
- Settings panel with 48-day inactivity timer
- Customizable inactivity email template and preview
- Vercel-ready deployment setup
- Isolated ML workspace in `ml-prediction/`

## Login Credentials (current demo)

- ID: `lakshya srivastav`
- Password: `finnexus@2026`

Note: Current login validation is client-side demo logic.

## Project Structure

- `index.html` - app layout and UI sections
- `styles.css` - styling and responsive design
- `script.js` - login, quiz, analyzer, settings, timer, and email draft flow
- `api/ml-analyze.js` - Vercel serverless endpoint for quiz analysis
- `vercel.json` - Vercel config
- `.github/workflows/ci-cd.yml` - CI/CD workflow for validation and Vercel deployment
- `ml-prediction/` - standalone ML experiments and scripts

## Run Locally

### Option 1: Quick static preview

Open `index.html` in your browser.

### Option 2: Full local run with API routes

Use Vercel dev so `/api/*` endpoints are available:

```bash
vercel dev
```

## Deploy to Vercel

If the project is already linked:

```bash
vercel --prod --yes
```

If not linked yet:

```bash
vercel link
vercel --prod
```

## ML Workspace

The `ml-prediction/` folder is intentionally separate from the website runtime. It is for in-progress prediction and model experimentation.

## Security Note

For production-grade authentication, move credentials to server-side auth with hashed passwords and session tokens.
