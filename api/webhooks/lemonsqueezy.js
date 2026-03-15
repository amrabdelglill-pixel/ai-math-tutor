import crypto from 'crypto';
import { createServerClient } from '../../lib/supabase.js';

// Disable body parsing to verify HMAC signature on raw body
export const config = { api: { bodyParser: false } };

async function buffer(readable) {
  const chunks = [];
  for await (const chunk of readable) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

function verifySignature(rawBody, signature) {
  const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET;
  if (!secret) throw new Error('LEMONSQUEEZY_WEBHOOK_SECRET not set');
  const hmac = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(signature));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const rawBody = await buffer(req);
  const signature = req.headers['x-signature'];

  if (!signature) return res.status(400).json({ error: 'Missing signature' });

  try {
    if (!verifySignature(rawBody, signature)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }
  } catch (err) {
    console.error('Signature verification error:', err.message);
    return res.status(500).json({ error: 'Signature verification failed' });
  }

  const event = JSON.parse(rawBody.toString());
  const eventName = event.meta?.event_name;
  const customData = event.meta?.custom_data || {};
  const attrs = event.data?.attributes || {};

  const supabase = createServerClient();

  console.log(`LemonSqueezy webhook: ${eventName}`, { customData });

  try {
    switch (eventName) {
      // ---- One-time purchase completed ----
      case 'order_created': {
        if (attrs.status !== 'paid') break;

        const userId = customData.user_id;
        const credits = parseInt(customData.credits || '0');
        const productType = customData.product_type;

        if (!userId || !credits) {
          console.error('Missing user_id or credits in order_created');
          break;
        }

        const { data: currentBalance } = await supabase.rpc('get_credit_balance', {
          p_parent_id: userId
        });

        await supabase.from('credit_ledger').insert({
          parent_id: userId,
          amount: credits,
          balance_after: (currentBalance || 0) + credits,
          type: productType === 'subscription' ? 'subscription' : 'purchase',
          description: `${customData.plan_id || 'Credit pack'} (${credits} credits)`,
          stripe_payment_id: `ls_order_${event.data.id}`,
        });

        break;
      }

      // ---- Subscription created (first payment or trial start) ----
      case 'subscription_created': {
        const userId = customData.user_id;
        const credits = parseInt(customData.credits || '0');
        const planName = customData.plan_name;
        const billingCycle = customData.billing_cycle || 'monthly';
        const maxChildren = parseInt(customData.max_children || '1');

        console.log('subscription_created payload:', JSON.stringify({ userId, credits, planName, billingCycle, maxChildren, customData, attrsStatus: attrs.status }));

        if (!userId || !planName) {
          console.error('Missing user_id or plan_name in subscription_created. customData:', JSON.stringify(customData));
          break;
        }

        // Cancel any existing active subscription for this user
        const { error: cancelErr } = await supabase.from('subscriptions')
          .update({ status: 'cancelled', updated_at: new Date().toISOString() })
          .eq('parent_id', userId)
          .in('status', ['active', 'trialing']);
        if (cancelErr) console.error('Error cancelling old subscription:', cancelErr);

        // Determine period dates from LS
        const periodStart = attrs.renews_at ? new Date(attrs.created_at).toISOString() : new Date().toISOString();
        const periodEnd = attrs.renews_at ? new Date(attrs.renews_at).toISOString()
          : new Date(Date.now() + (billingCycle === 'annual' ? 365 : 30) * 24 * 60 * 60 * 1000).toISOString();

        // Create subscription record
        const subRecord = {
          parent_id: userId,
          stripe_subscription_id: `ls_sub_${event.data.id}`,
          plan_name: planName,
          credits_per_month: credits,
          price_cents: Math.round((attrs.first_subscription_item?.price || 0)),
          status: attrs.status === 'on_trial' ? 'trialing' : 'active',
          current_period_start: periodStart,
          current_period_end: periodEnd,
          billing_cycle: billingCycle,
          max_children: maxChildren,
        };
        console.log('Inserting subscription:', JSON.stringify(subRecord));
        const { error: insertErr } = await supabase.from('subscriptions').insert(subRecord);
        if (insertErr) {
          console.error('ERROR inserting subscription:', JSON.stringify(insertErr));
        } else {
          console.log('Subscription created successfully for user', userId);
        }

        // Credit the user (skip if trial — credits come on first payment)
        if (attrs.status !== 'on_trial') {
          const { data: bal } = await supabase.rpc('get_credit_balance', { p_parent_id: userId });
          const { error: creditErr } = await supabase.from('credit_ledger').insert({
            parent_id: userId,
            amount: credits,
            balance_after: (bal || 0) + credits,
            type: 'subscription',
            description: `${planName} subscription activated (${credits} credits)`,
            stripe_payment_id: `ls_sub_${event.data.id}`,
          });
          if (creditErr) console.error('ERROR inserting credits:', JSON.stringify(creditErr));
        }

        break;
      }

      // ---- Subscription renewed / payment received ----
      case 'subscription_updated': {
        const subId = `ls_sub_${event.data.id}`;

        // Fetch existing subscription
        const { data: existingSub } = await supabase
          .from('subscriptions')
          .select('*')
          .eq('stripe_subscription_id', subId)
          .single();

        if (!existingSub) {
          console.log('subscription_updated: no matching subscription found for', subId);
          break;
        }

        const newStatus = attrs.status === 'active' ? 'active'
          : attrs.status === 'on_trial' ? 'trialing'
          : attrs.status === 'cancelled' ? 'cancelled'
          : attrs.status;

        const periodEnd = attrs.renews_at ? new Date(attrs.renews_at).toISOString() : existingSub.current_period_end;

        // Update subscription
        await supabase.from('subscriptions')
          .update({
            status: newStatus,
            current_period_end: periodEnd,
            updated_at: new Date().toISOString(),
          })
          .eq('stripe_subscription_id', subId);

        // If status changed from trialing to active, grant first credits
        if (existingSub.status === 'trialing' && newStatus === 'active') {
          const { data: bal } = await supabase.rpc('get_credit_balance', { p_parent_id: existingSub.parent_id });
          await supabase.from('credit_ledger').insert({
            parent_id: existingSub.parent_id,
            amount: existingSub.credits_per_month,
            balance_after: (bal || 0) + existingSub.credits_per_month,
            type: 'subscription',
            description: `${existingSub.plan_name} subscription started (${existingSub.credits_per_month} credits)`,
            stripe_payment_id: subId,
          });
        }

        break;
      }

      // ---- Subscription cancelled ----
      case 'subscription_cancelled': {
        const subId = `ls_sub_${event.data.id}`;
        await supabase.from('subscriptions')
          .update({ status: 'cancelled', updated_at: new Date().toISOString() })
          .eq('stripe_subscription_id', subId);
        break;
      }

      // ---- Subscription payment (renewal credits) ----
      case 'subscription_payment_success': {
        const subId = `ls_sub_${attrs.subscription_id}`;
        const { data: sub } = await supabase
          .from('subscriptions')
          .select('*')
          .eq('stripe_subscription_id', subId)
          .single();

        if (sub && sub.status === 'active') {
          // Update period end
          const newPeriodEnd = attrs.renews_at
            ? new Date(attrs.renews_at).toISOString()
            : new Date(Date.now() + (sub.billing_cycle === 'annual' ? 365 : 30) * 24 * 60 * 60 * 1000).toISOString();

          await supabase.from('subscriptions')
            .update({ current_period_end: newPeriodEnd, updated_at: new Date().toISOString() })
            .eq('stripe_subscription_id', subId);

          // Grant renewal credits
          const { data: bal } = await supabase.rpc('get_credit_balance', { p_parent_id: sub.parent_id });
          await supabase.from('credit_ledger').insert({
            parent_id: sub.parent_id,
            amount: sub.credits_per_month,
            balance_after: (bal || 0) + sub.credits_per_month,
            type: 'subscription',
            description: `${sub.plan_name} renewal (${sub.credits_per_month} credits)`,
            stripe_payment_id: `ls_payment_${event.data.id}`,
          });
        }
        break;
      }

      default:
        console.log(`Unhandled LemonSqueezy event: ${eventName}`);
    }

    return res.status(200).json({ received: true });
  } catch (error) {
    console.error('Webhook processing error:', error);
    return res.status(500).json({ error: 'Webhook processing failed' });
  }
}
