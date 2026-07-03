const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// One-time packs ADD to the existing balance. "unlimited" is a subscription
// that sets the balance to -1 (unlimited) and resets on each renewal.
const ONE_TIME_PLANS = { scans_20: 20, scans_100: 100 };
const SUBSCRIPTION_PLANS = { unlimited: -1 };

// Vercel needs the raw request body to verify the Stripe signature, so we
// disable the default JSON body parser for this route.
module.exports.config = { api: { bodyParser: false } };

function buffer(readable) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    readable.on('data', (chunk) => chunks.push(chunk));
    readable.on('end', () => resolve(Buffer.concat(chunks)));
    readable.on('error', reject);
  });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();

  let event;
  try {
    const buf = await buffer(req);
    const sig = req.headers['stripe-signature'];
    event = stripe.webhooks.constructEvent(buf, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const userId = session.client_reference_id || (session.metadata && session.metadata.supabase_user_id);
      const plan = session.metadata && session.metadata.plan;

      if (userId && plan) {
        if (ONE_TIME_PLANS[plan] !== undefined) {
          const { data: profile } = await supabaseAdmin
            .from('profiles').select('scan_balance').eq('id', userId).single();
          const current = profile ? profile.scan_balance : 0;
          const next = current === -1 ? -1 : current + ONE_TIME_PLANS[plan];
          await supabaseAdmin.from('profiles').update({
            scan_balance: next,
            stripe_customer_id: session.customer
          }).eq('id', userId);
        } else if (SUBSCRIPTION_PLANS[plan] !== undefined) {
          await supabaseAdmin.from('profiles').update({
            scan_balance: SUBSCRIPTION_PLANS[plan],
            plan: plan,
            stripe_customer_id: session.customer,
            stripe_subscription_id: session.subscription
          }).eq('id', userId);
        }
      }
    }

    // Monthly renewal: reset the scan balance for the new billing period.
    if (event.type === 'invoice.paid') {
      const invoice = event.data.object;
      if (invoice.billing_reason === 'subscription_cycle' && invoice.subscription) {
        const { data: profile } = await supabaseAdmin
          .from('profiles')
          .select('id, plan')
          .eq('stripe_subscription_id', invoice.subscription)
          .single();
        if (profile && SUBSCRIPTION_PLANS[profile.plan] !== undefined) {
          await supabaseAdmin.from('profiles')
            .update({ scan_balance: SUBSCRIPTION_PLANS[profile.plan] })
            .eq('id', profile.id);
        }
      }
    }

    // Subscription cancelled: drop back to the free plan.
    if (event.type === 'customer.subscription.deleted') {
      const sub = event.data.object;
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('id')
        .eq('stripe_subscription_id', sub.id)
        .single();
      if (profile) {
        await supabaseAdmin.from('profiles').update({
          plan: 'free',
          scan_balance: 0,
          stripe_subscription_id: null
        }).eq('id', profile.id);
      }
    }

    return res.status(200).json({ received: true });

  } catch (err) {
    console.error('Webhook handler error:', err);
    return res.status(500).json({ error: 'Webhook handler failed' });
  }
};
