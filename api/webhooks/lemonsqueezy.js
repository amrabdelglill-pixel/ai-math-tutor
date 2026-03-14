import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

// Disable body parsing so we can verify the webhook signature
export const config = { api: { bodyParser: false } };

async function buffer(readable) {
  const chunks = [];
  for await (const chunk of readable) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

function verifySignature(payload, signature, secret) {
  const hmac = crypto.createHmac('sha256', secret);
  const digest = hmac.update(payload).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET;
  if (!secret) {
    console.error('LEMONSQUEEZY_WEBHOOK_SECRET not configured');
    return res.status(500).json({ error: 'Webhook secret not configured' });
  }

  const buf = await buffer(req);
  const signature = req.headers['x-signature'];

  if (!signature) {
    return res.status(400).json({ error: 'Missing signature' });
  }

  try {
    const isValid = verifySignature(buf, signature, secret);
    if (!isValid) {
      console.error('Webhook signature verification failed');
      return res.status(400).json({ error: 'Invalid signature' });
    }
  } catch (err) {
    console.error('Signature verification error:', err.message);
    return res.status(400).json({ error: 'Invalid signature' });
  }

  const event = JSON.parse(buf.toString());
  const eventName = req.headers['x-event-name'];

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  try {
    const attrs = event.data.attributes;
    const customData = attrs.first_order_item?.custom_data
      || attrs.checkout_data?.custom
      || event.meta?.custom_data
      || {};

    const userId = customData.user_id;
    const planId = customData.plan_id;
    const credits = parseInt(customData.credits || '0');

    if (!userId || !credits) {
      console.error('Missing user_id or credits in custom data:', customData);
      return res.status(200).json({ received: true, skipped: true });
    }

    switch (eventName) {
      case 'order_created': {
        // One-time purchase (credit pack) or first subscription payment
        const { data: currentBalance } = await supabase.rpc('get_credit_balance', {
          p_parent_id: userId
        });

        await supabase.from('credit_ledger').insert({
          parent_id: userId,
          amount: credits,
          balance_after: (currentBalance || 0) + credits,
          type: planId.startsWith('pack_') ? 'purchase' : 'subscription',
          description: planId.startsWith('pack_')
            ? 'Credit pack: ' + planId + ' (' + credits + ' credits)'
            : 'Subscription: ' + planId + ' (' + credits + ' credits)',
          stripe_payment_id: 'ls_' + event.data.id,
        });

        // If subscription, create/update subscription record
        if (attrs.first_order_item?.variant_id && !planId.startsWith('pack_')) {
          await supabase.from('subscriptions').upsert({
            parent_id: userId,
            stripe_customer_id: 'ls_cust_' + (attrs.customer_id || event.data.id),
            stripe_subscription_id: 'ls_sub_' + (attrs.order_number || event.data.id),
            plan_name: planId,
            credits_per_month: credits,
            price_cents: attrs.total || 0,
            status: 'active',
            current_period_start: new Date().toISOString(),
            current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
          }, { onConflict: 'stripe_subscription_id' });
        }
        break;
      }

      case 'subscription_created': {
        // Subscription activated - credits already added in order_created
        // Update subscription record if needed
        const subId = attrs.id || event.data.id;
        await supabase.from('subscriptions').upsert({
          parent_id: userId,
          stripe_customer_id: 'ls_cust_' + (attrs.customer_id || ''),
          stripe_subscription_id: 'ls_sub_' + subId,
          plan_name: planId,
          credits_per_month: credits,
          price_cents: attrs.price || 0,
          status: attrs.status === 'active' ? 'active' : attrs.status,
          current_period_start: attrs.created_at || new Date().toISOString(),
          current_period_end: attrs.renews_at || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
        }, { onConflict: 'stripe_subscription_id' });
        break;
      }

      case 'subscription_updated': {
        const subId = attrs.id || event.data.id;
        // Handle renewal - add credits
        if (attrs.status === 'active') {
          const { data: currentBalance } = await supabase.rpc('get_credit_balance', {
            p_parent_id: userId
          });

          await supabase.from('credit_ledger').insert({
            parent_id: userId,
            amount: credits,
            balance_after: (currentBalance || 0) + credits,
            type: 'subscription',
            description: 'Subscription renewal: ' + planId + ' (' + credits + ' credits)',
            stripe_payment_id: 'ls_renew_' + subId + '_' + Date.now(),
          });
        }

        await supabase.from('subscriptions')
          .update({
            status: attrs.status === 'active' ? 'active' : attrs.status,
            current_period_end: attrs.renews_at || null,
          })
          .eq('stripe_subscription_id', 'ls_sub_' + subId);
        break;
      }

      case 'subscription_cancelled': {
        const subId = attrs.id || event.data.id;
        await supabase.from('subscriptions')
          .update({ status: 'cancelled' })
          .eq('stripe_subscription_id', 'ls_sub_' + subId);
        break;
      }
    }

    return res.status(200).json({ received: true });
  } catch (error) {
    console.error('Webhook processing error:', error);
    return res.status(500).json({ error: 'Webhook processing failed' });
  }
}
