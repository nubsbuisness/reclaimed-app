# ClosetFlip — deployment guide

This turns your site into a real app with accounts, a database, and real
Stripe payments. Everything used here has a free tier. Follow the steps
in order — none of it requires writing code, just filling in some blanks.

Total setup time: roughly 45–60 minutes the first time.

---

## What you're setting up

| Piece | Service | What it does |
|---|---|---|
| Hosting | **Vercel** | Serves your website and runs the backend code |
| Accounts + database | **Supabase** | Stores users, passwords, and scan balances |
| Payments | **Stripe** | Your existing account — takes real payments |
| AI appraisals | **Anthropic API** | Powers the photo analysis (billed per use) |

---

## Step 1 — Put this project on GitHub

1. Go to https://github.com and create a free account if you don't have one.
2. Click **New repository**, name it `reclaimed-app`, keep it Private, click **Create repository**.
3. On the new repo's page, click **uploading an existing file**, and drag in every file from this folder (`index.html`, the `api` folder, `package.json`, `supabase-schema.sql`, `.env.example`). Commit the upload.

## Step 2 — Create your Supabase project (accounts + database)

1. Go to https://supabase.com → sign up free → **New project**.
2. Give it any name, set a database password (save it somewhere), pick a region near you, click **Create new project** (takes ~2 minutes).
3. In the left sidebar go to **SQL Editor** → **New query**. Open `supabase-schema.sql` from this folder, paste its entire contents in, click **Run**. This creates the table that stores each user's scan balance.
4. Go to **Authentication → Providers**, confirm **Email** is enabled (it is by default).
5. Go to **Authentication → URL Configuration** and, once you know your Vercel URL from Step 4 below, add it as a **Site URL** (you can come back and do this after Step 4).
6. Go to **Project Settings → API**. Copy three values, you'll need them soon:
   - **Project URL**
   - **anon public** key
   - **service_role** key (keep this one secret — don't put it in the HTML)

## Step 3 — Set up Stripe products

1. In your Stripe Dashboard, go to **Product catalog** → **Add product**, and create three products matching your pricing section:
   - **20 Scans** — $4.99, one-time payment
   - **100 Scans** — $14.99, one-time payment
   - **Unlimited** — $49.99, recurring monthly
2. For each, click into the product and copy its **Price ID** (starts with `price_...`). You'll need all three.
3. Go to **Developers → API keys** and copy your **Secret key** (starts with `sk_live_` or `sk_test_` while testing).

## Step 4 — Deploy to Vercel

1. Go to https://vercel.com → sign up free with your GitHub account.
2. Click **Add New → Project**, select your `reclaimed-app` repo, click **Import**.
3. Before clicking Deploy, open **Environment Variables** and add each of these (values from Steps 2–3, plus your Anthropic key):

   ```
   ANTHROPIC_API_KEY
   SUPABASE_URL
   SUPABASE_SERVICE_ROLE_KEY
   STRIPE_SECRET_KEY
   STRIPE_WEBHOOK_SECRET   (leave blank for now, see Step 5)
   PRICE_SCANS_20
   PRICE_SCANS_100
   PRICE_UNLIMITED
   ```
4. Click **Deploy**. In a minute you'll get a live URL like `reclaimed-app.vercel.app`.
5. Go back to Supabase → **Authentication → URL Configuration** and set your Vercel URL as the **Site URL**.

## Step 5 — Connect the Stripe webhook (this is what actually credits scans after payment)

1. In Stripe, go to **Developers → Webhooks → Add endpoint**.
2. Endpoint URL: `https://YOUR-VERCEL-URL.vercel.app/api/stripe-webhook`
3. Select these events: `checkout.session.completed`, `invoice.paid`, `customer.subscription.deleted`.
4. Click **Add endpoint**, then copy the **Signing secret** (starts with `whsec_...`).
5. Back in Vercel: **Project → Settings → Environment Variables**, paste that into `STRIPE_WEBHOOK_SECRET`, then go to **Deployments** and redeploy (so the new variable takes effect).

## Step 6 — Fill in your public keys in the site itself

Open `index.html`, find this near the top of the `<script>` at the bottom of the file:

```js
const SUPABASE_URL = 'YOUR_SUPABASE_URL';
const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY';
```

Replace both with your **Project URL** and **anon public** key from Step 2.6
(the anon key is safe to put in a public file — it's designed for that).
Commit this change on GitHub; Vercel will redeploy automatically.

## Step 7 — Test it

1. Visit your live URL, sign up with a real email + password.
2. Upload a photo and appraise it — you should see your scan count drop by 1.
3. Use one of Stripe's test cards (`4242 4242 4242 4242`, any future date, any CVC) against a **test mode** Stripe key first, buy a pack, confirm the scan balance updates after a few seconds.
4. Once that works, swap in your **live** Stripe secret key and live Price IDs, and you're taking real payments.

---

## Costs to know about

- **Anthropic API**: billed per scan (not free). Keep an eye on usage in the Anthropic Console, especially since each scan does several web searches.
- **Vercel / Supabase**: free tiers comfortably cover a small-to-medium amount of traffic; both will prompt you to upgrade if you outgrow them.
- **Stripe**: standard card processing fees apply (no monthly fee).

## If something breaks

- **Scans not updating after payment** → check Stripe Dashboard → Webhooks → your endpoint → look for failed delivery attempts and the error message.
- **"Please sign in" errors** → double check `SUPABASE_URL` / `SUPABASE_ANON_KEY` in `index.html` match your project exactly.
- **Appraisals failing** → check Vercel → your project → Deployments → Functions logs for `appraise` — this shows the actual error from Anthropic.
