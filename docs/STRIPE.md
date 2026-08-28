# Stripe payments (quotes & invoices)

## Keys (already wired)

| Env var | Purpose |
|---------|---------|
| `STRIPE_PUBLISHABLE_KEY` | Public key (optional for Checkout redirect flow) |
| `STRIPE_SECRET_KEY` | Server Checkout Sessions |
| `STRIPE_WEBHOOK_SECRET` | Verify `checkout.session.completed` |

Local: add to `.dev.vars` (gitignored).  
Production: `npx wrangler versions secret put STRIPE_SECRET_KEY` (and publishable / webhook the same way), then deploy that version.

## Behaviour

- **Card:** charges base × **1.035**. CRM credit/deposit uses the **base** amount only.
- **Quote card payment:** charges the **deposit due** (default **50%** of investment total; editable on the quote), then creates a **received** deposit on the client. Balance is invoiced later.
- **Invoice:** balance due = invoice total − received deposits. Card charges the balance (+3.5%). Paying marks invoice **paid** and applies deposits.
- **Interac e-Transfer:** face value, no fee → **accounting@vanderven.ca** (memo = quote/invoice number). Mark received manually under client Deposits.

Public app host: `https://app.vanderven.ca` (also still on `*.workers.dev`).

Public pages:

- Quote deposit: `https://app.vanderven.ca/pay/q/:token`
- Invoice: `https://app.vanderven.ca/pay/i/:token`

## Webhook setup (required for card → CRM)

1. Deploy the worker so `https://<your-host>/api/stripe/webhook` is live.
2. In [Stripe Dashboard → Developers → Webhooks](https://dashboard.stripe.com/test/webhooks):
   - Endpoint URL: `https://<your-host>/api/stripe/webhook`
   - Event: `checkout.session.completed`
3. Copy the signing secret (`whsec_…`) into:

```bash
# local
# STRIPE_WEBHOOK_SECRET=whsec_... in .dev.vars

# production
echo whsec_... | npx wrangler versions secret put STRIPE_WEBHOOK_SECRET
npx wrangler versions deploy
```

4. Apply DB migration if needed: `npm run db:migrate` (remote) / `npm run db:migrate:local`.

## Test checklist

1. Send a quote → open pay link → Pay by card (test card `4242…`) → client Deposits shows received credit.
2. Create invoice for same client → preview shows deposit applied + balance due → pay balance by card → invoice `paid`.
3. E-transfer: add deposit manually (method e-transfer, status received) → invoice balance updates.
