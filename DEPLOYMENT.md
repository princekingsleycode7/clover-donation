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
  - `/` → `dist/index.html` (Turkana Clean Water Campaign)
  - `/version2` & `/v2` → `dist/version2.html` (Uzima Children's Fund Campaign)
  - `/admin` → `dist/admin.html` (Staff Operations Portal)
  - `/history` → `dist/history.html` (Supporter Giving Ledger & Wall)
  - `/api/*` → Serverless Function (`api/index.ts` Express handler)
  - Catch-all 404 fallback: `dist/404.html`

### Required Environment Variables in Vercel
Go to **Vercel Project Settings > Environment Variables** and add:
- `PAYSTACK_PUBLIC_KEY`: `pk_live_...` (or `pk_test_...`)
- `PAYSTACK_SECRET_KEY`: `sk_live_...` (or `sk_test_...`)
- `SUPABASE_URL`: `https://your-project.supabase.co`
- `SUPABASE_ANON_KEY`: `eyJ...`
- `SUPABASE_SERVICE_ROLE_KEY`: `eyJ...`

---

## 5. Paystack Account Configuration Note

For multi-currency operations:
- Ensure the account administrator has enabled multi-currency settlement (USD, NGN, GBP) under **Paystack Dashboard > Settings > Preferences**.
- Configure the Webhook URL in Paystack Dashboard to point to your live domain:
  `https://your-deployment.vercel.app/api/paystack-webhook`
- Copy the Webhook Secret from Paystack into `PAYSTACK_SECRET_KEY` in Vercel Environment Variables.
