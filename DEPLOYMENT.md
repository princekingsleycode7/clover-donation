# Turkana Wellspring Initiative — Deployment & Environment Topology

This document formalizes the production and staging architecture across Supabase, Vercel, Paystack, and Resend.

---

## 1. Environment Architecture & Isolation Matrix

| Layer | Staging (Preview Branch) | Production (`main` Branch) |
| :--- | :--- | :--- |
| **Vercel Hosting** | Preview Deployments (`*.vercel.app` on PR branches) | Production Deployment (`turkanawellspring.org`) |
| **Supabase Project** | `turkana-wellspring-staging` (`https://staging-ref.supabase.co`) | `turkana-wellspring-prod` (`https://prod-ref.supabase.co`) |
| **Database Migrations** | Tested via `supabase db push` against staging first | Applied via automated migration pipeline |
| **Paystack Environment** | Test Mode (`pk_test_...` client / `sk_test_...` edge) | Live Mode (`pk_live_...` client / `sk_live_...` edge) |
| **Paystack Webhook URL** | `https://staging-ref.supabase.co/functions/v1/paystack-webhook` | `https://prod-ref.supabase.co/functions/v1/paystack-webhook` |
| **Resend Email Domain** | `notifications@sandbox.resend.com` or staging subdomain | `receipts@turkanawellspring.org` (DKIM/SPF verified) |
| **Sentry Environment** | `environment: "staging"` (captured in `js/telemetry.js`) | `environment: "production"` |

---

## 2. Secrets & Keys Governance (Non-Negotiable Security Policy)

1. **Client-Shipped Code (`index.html`, `js/app.js`, `js/payment.js`)**:
   - MUST ONLY contain the `PAYSTACK_PUBLIC_KEY` (`pk_...`) and `SUPABASE_ANON_KEY`.
   - Never commit or expose `PAYSTACK_SECRET_KEY` or `SUPABASE_SERVICE_ROLE_KEY` to client assets.
   - Enforced by pre-commit regex scanning.

2. **Supabase Edge Functions Environment**:
   - `PAYSTACK_SECRET_KEY`: Set via `supabase secrets set PAYSTACK_SECRET_KEY="sk_..."`
   - `SUPABASE_SERVICE_ROLE_KEY`: Injected automatically into Edge Functions.
   - `RESEND_API_KEY`: Set via `supabase secrets set RESEND_API_KEY="re_..."`
   - `APP_URL`: Canonical domain for receipt links and magic links.

---

## 3. Database Migration Deployment Workflow

Migrations must execute chronologically:
1. `20260925000000_phase1_schema.sql`: Core tables, trigger enforcing `'pending'` status, public view.
2. `20260925000001_phase2_schema.sql`: Admin RBAC (`public.admins`), immutable `audit_log`, CMS `campaign_updates`, magic links, rate limits.
3. `20260925000002_phase3_schema.sql`: `newsletter_subscribers`, `volunteers`, `matching_sponsors`, UTM tracking columns on `donations`, updated progress view with matching calculation.

```bash
# Push migrations to staging
supabase link --project-ref <staging-project-id>
supabase db push

# Run automated verification tests
node --test tests/edge_functions.test.ts

# Promote to production
supabase link --project-ref <production-project-id>
supabase db push
```

---

## 4. Vercel Deployment Configuration

This project is configured with zero-config Vercel support via `vercel.json` and `api/index.ts`:

- **Framework Preset**: Vite
- **Root Directory**: `./`
- **Build Command**: `npm run build` (runs Vite build and copies all `/js`, `/css`, and asset bundles into `dist/`)
- **Output Directory**: `dist`
- **Routing & Rewrites** (managed automatically by `vercel.json`):
  - `/` → `dist/index.html` (Wellspring Children's Healthcare Campaign)
  - `/amira` → `dist/amira.html` (Amira's Bone Marrow Transplant Story)
  - `/version1` & `/v1` → `dist/version1.html` (Turkana Clean Water Campaign)
  - `/version2` & `/v2` → `dist/version2.html` (Uzima Children's Fund Campaign)
  - `/admin` → `dist/admin.html` (Staff Operations Portal)
  - `/history` → `dist/history.html` (Supporter Giving Ledger & Wall)
  - `/api/*` → Serverless Function (`api/index.ts` Express handler)
  - Catch-all 404 fallback: `dist/404.html`

### Required Environment Variables in Vercel
Go to **Vercel Project Settings > Environment Variables** and add:
- `FLUTTERWAVE_PUBLIC_KEY`: `FLWPUBK_live_...` (or `FLWPUBK_TEST-...`)
- `FLUTTERWAVE_SECRET_KEY`: `FLWSECK_live_...` (or `FLWSECK_TEST-...`)
- `FLUTTERWAVE_ENCRYPTION_KEY`: 24-character encryption key (from Flutterwave dashboard)
- `FLUTTERWAVE_SECRET_HASH`: Webhook secret hash string
- `SUPABASE_URL`: `https://your-project.supabase.co`
- `SUPABASE_ANON_KEY`: `eyJ...`
- `SUPABASE_SERVICE_ROLE_KEY`: `eyJ...`

> ⚠️ **CRITICAL VERCEL STEP: TRIGGER REDEPLOYMENT**
> When you add or modify environment variables in Vercel Project Settings, Vercel **does not** automatically apply them to existing deployments.
> You **must** go to **Vercel Dashboard > Deployments**, select the latest deployment, click the **`...`** (three dots) menu, and click **Redeploy** (or push a new commit to git). Without a redeploy, the app runs with old environment variables and will return `Invalid parameter (PBFPubKey)`.

---

## 5. Flutterwave Configuration Note

- Ensure the Public Key starts with `FLWPUBK_` (or `FLWPUBK-`). Do NOT paste the Secret Key (`FLWSECK_`) into the Public Key variable, as client-side checkouts will fail with `Invalid parameter (PBFPubKey)`.
- Configure the Webhook URL in Flutterwave Dashboard under **Settings > Webhooks**:
  `https://your-deployment.vercel.app/api/flutterwave/webhook`
