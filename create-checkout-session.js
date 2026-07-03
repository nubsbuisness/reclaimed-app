const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// Maps the plan names used in the frontend to the Stripe Price IDs you create
// in your Stripe Dashboard (Product catalog). Fill these in via env vars.
const PRICE_MAP = {
  scans_20: { priceId: process.env.PRICE_SCANS_20, mode: 'payment' },
  scans_100: { priceId: process.env.PRICE_SCANS_100, mode: 'payment' },
  unlimited: { priceId: process.env.PRICE_UNLIMITED, mode: 'subscription' }
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { plan, userId, email } = req.body || {};
    const cfg = PRICE_MAP[plan];

    if (!userId) {
      return res.status(401).json({ error: 'Please sign in first.' });
    }
    if (!cfg || !cfg.priceId) {
      return res.status(400).json({ error: 'Unknown plan, or the price ID is not configured yet.' });
    }

    const origin = req.headers.origin || `https://${req.headers.host}`;

    const session = await stripe.checkout.sessions.create({
      mode: cfg.mode,
      line_items: [{ price: cfg.priceId, quantity: 1 }],
      customer_email: email,
      client_reference_id: userId,
      metadata: { supabase_user_id: userId, plan },
      subscription_data: cfg.mode === 'subscription'
        ? { metadata: { supabase_user_id: userId, plan } }
        : undefined,
      success_url: `${origin}/?checkout=success`,
      cancel_url: `${origin}/?checkout=cancelled`,
    });

    return res.status(200).json({ url: session.url });

  } catch (err) {
    console.error('Checkout session error:', err);
    return res.status(500).json({ error: 'Could not start checkout. Please try again.' });
  }
};
