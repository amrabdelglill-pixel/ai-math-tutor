import Stripe from 'stripe';
import { createServerClient } from '../../lib/supabase.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Disable body parsing so we can verify the webhook signature
export const config = { api: { bodyParser: false } };

async function buffer(readable) {
  const chunks = [];
  for await (const chunk of readable) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const buf = await buffer(req);
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(buf, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).json({ error: 'Invalid signature' });
  }

  const supabase = createServerClient();

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const { user_id, plan_id, credits, type } = session.metadata;
        const creditsNum = parseInt(credits);

        // Get current balance
        const { data: currentBalance } = await supabase.rpc('get_credit_balance', {
          p_parent_id: user_id
        });

        // Add credits
        await supabase.from('credit_ledger').insert({
          parent_id: user_id,
          amount: creditsNum,
          balance_after: (currentBalance || 0) + creditsNum,
          type: type === 'subscription' ? 'subscription' : 'purchase',
          description: `${type === 'subscription' ? 'Subscription' : 'Pack'}: ${plan_id} (${creditsNum} credits)`,
          stripe_payment_id: session.id
        });

        // If subscription, create/update subscription record
        if (type === 'subscription' && session.subscription) {
          await supabase.from('subscriptions').upsert({
            parent_id: user_id,
            stripe_customer_id: session.customer,
            stripe_subscription_id: session.subscription,
            plan_name: plan_id,
            credits_per_month: creditsNum,
            price_cents: session.amount_total,
            status: 'active',
            current_period_start: new Date().toISOString(),
            current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
          }, { onConflict: 'stripe_subscription_id' });
        }
        break;
      }

      case 'invoice.paid': {
        // Recurring subscription payment
        const invoice = event.data.object;
        const sub = await stripe.subscriptions.retrieve(invoice.subscription);
        const { user_id, credits } = sub.metadata || {};

        if (user_id && credits) {
          const creditsNum = parseInt(credits);
          const { data: currentBalance } = await supabase.rpc('get_credit_balance', {
            p_parent_id: user_id
          });

          await supabase.from('credit_ledger').insert({
            parent_id: user_id,
            amount: creditsNum,
            balance_after: (currentBalance || 0) + creditsNum,
            type: 'subscription',
            description: `Monthly subscription renewal (${creditsNum} credits)`,
            stripe_payment_id: invoice.id
          });
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        await supabase.from('subscriptions')
          .update({ status: 'cancelled' })
          .eq('stripe_subscription_id', sub.id);
        break;
      }
    }

    return res.status(200).json({ received: true });
  } catch (error) {
    console.error('Webhook processing error:', error);
    return res.status(500).json({ error: 'Webhook processing failed' });
  }
}
