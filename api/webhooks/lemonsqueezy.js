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
      // ---- Order completed (handles BOTH subscriptions and one-time packs) ----
      case 'order_created': {
        if (attrs.status !== 'paid') break;

        const userId = customData.user_id;
        const credits = parseInt(customData.credits || '0');
        const productType = customData.product_type;
        const planName = customData.plan_name;
        const billingCycle = customData.billing_cycle || 'monthly';
        const maxChildren = parseInt(customData.max_children || '1');
        const orderTotal = parseInt(attrs.total || '0'); // in cents — 0 means trial

        console.log('order_created:', JSON.stringify({ userId, credits, productType, planName, billingCycle, orderTotal, customData }));

        if (!userId || !credits) {
          console.error('Missing user_id or credits in order_created');
          break;
        }

        // Determine if this is a trial (subscription with $0 charge)
        const isTrial = productType === 'subscription' && orderTotal === 0;
        const TRIAL_CREDITS = 10;
        const creditsToGrant = isTrial ? TRIAL_CREDITS : credits;

        // Add credits
        const { data: currentBalance } = await supabase.rpc('get_credit_balance', {
          p_parent_id: userId
        });

        const creditDescription = isTrial
          ? `Free trial credits (${TRIAL_CREDITS} credits)`
          : `${customData.plan_id || 'Credit pack'} (${credits} credits)`;

        const { error: creditErr } = await supabase.from('credit_ledger').insert({
          parent_id: userId,
          amount: creditsToGrant,
          balance_after: (currentBalance || 0) + creditsToGrant,
          type: isTrial ? 'trial' : (productType === 'subscription' ? 'subscription' : 'purchase'),
          description: creditDescription,
          stripe_payment_id: `ls_order_${event.data.id}`,
        });
        if (creditErr) console.error('Error inserting credits:', JSON.stringify(creditErr));
        else console.log(`Granted ${creditsToGrant} credits (trial=${isTrial}) to user ${userId}`);

        // If this is a subscription purchase, also create the subscription record
        if (productType === 'subscription' && planName) {
          // Cancel any existing active/trialing subscription
          const { error: cancelErr } = await supabase.from('subscriptions')
            .update({ status: 'cancelled', updated_at: new Date().toISOString() })
            .eq('parent_id', userId)
            .in('status', ['active', 'trialing']);
          if (cancelErr) console.error('Error cancelling old sub:', JSON.stringify(cancelErr));

          // Trial = 14 days, paid = full billing cycle
          const periodDays = isTrial ? 14 : (billingCycle === 'annual' ? 365 : 30);
          const periodEnd = new Date(Date.now() + periodDays * 24 * 60 * 60 * 1000).toISOString();

          const { error: subErr } = await supabase.from('subscriptions').insert({
            parent_id: userId,
            stripe_subscription_id: `ls_order_${event.data.id}`,
            plan_name: planName,
            credits_per_month: credits,
            price_cents: Math.round(orderTotal),
            status: isTrial ? 'trialing' : 'active',
            current_period_start: new Date().toISOString(),
            current_period_end: periodEnd,
            billing_cycle: billingCycle,
            max_children: maxChildren,
          });
          if (subErr) {
            console.error('ERROR creating subscription in order_created:', JSON.stringify(subErr));
          } else {
            console.log(`Subscription created (status=${isTrial ? 'trialing' : 'active'}, period=${periodDays}d) for user ${userId}`);
          }
        }

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

        // Check if order_created already handled this (avoid duplicate subscription)
        const { data: existingSub } = await supabase.from('subscriptions')
          .select('id')
          .eq('parent_id', userId)
          .eq('status', 'active')
          .gte('created_at', new Date(Date.now() - 60000).toISOString()) // created in last 60s
          .limit(1);

        if (existingSub && existingSub.length > 0) {
          console.log('subscription_created: subscription already exists (created by order_created), updating with LS subscription ID');
          // Just update the stripe_subscription_id to the proper LS sub ID
          await supabase.from('subscriptions')
            .update({
              stripe_subscription_id: `ls_sub_${event.data.id}`,
              status: attrs.status === 'on_trial' ? 'trialing' : 'active',
              current_period_end: attrs.renews_at ? new Date(attrs.renews_at).toISOString() : undefined,
            })
            .eq('id', existingSub[0].id);
          break;
        }

        // No existing sub — create one (fallback if order_created didn't handle it)
        // Cancel any existing active subscription for this user
        const { error: cancelErr } = await supabase.from('subscriptions')
          .update({ status: 'cancelled', updated_at: new Date().toISOString() })
          .eq('parent_id', userId)
          .in('status', ['active', 'trialing']);
        if (cancelErr) console.error('Error cancelling old subscription:', cancelErr);

        const periodStart = attrs.renews_at ? new Date(attrs.created_at).toISOString() : new Date().toISOString();
        const periodEnd = attrs.renews_at ? new Date(attrs.renews_at).toISOString()
          : new Date(Date.now() + (billingCycle === 'annual' ? 365 : 30) * 24 * 60 * 60 * 1000).toISOString();

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
        console.log('Inserting subscription (fallback):', JSON.stringify(subRecord));
        const { error: insertErr } = await supabase.from('subscriptions').insert(subRecord);
        if (insertErr) {
          console.error('ERROR inserting subscription:', JSON.stringify(insertErr));
        } else {
          console.log('Subscription created successfully for user', userId);
        }

        // Credit the user (skip if trial — credits come on first payment)
        // Also skip if order_created already credited
        if (attrs.status !== 'on_trial') {
          // Check if credits were already added by order_created
          const { data: recentCredit } = await supabase.from('credit_ledger')
            .select('id')
            .eq('parent_id', userId)
            .gte('created_at', new Date(Date.now() - 60000).toISOString())
            .limit(1);
          if (!recentCredit || recentCredit.length === 0) {
            const { data: bal } = await supabase.rpc('get_credit_balance', { p_parent_id: userId });
            const { error: creditErr2 } = await supabase.from('credit_ledger').insert({
              parent_id: userId,
              amount: credits,
              balance_after: (bal || 0) + credits,
              type: 'subscription',
              description: `${planName} subscription activated (${credits} credits)`,
              stripe_payment_id: `ls_sub_${event.data.id}`,
            });
            if (creditErr2) console.error('ERROR inserting credits:', JSON.stringify(creditErr2));
          } else {
            console.log('Credits already added by order_created, skipping');
          }
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

        if (sub) {
          // Update period end and ensure status is active
          const newPeriodEnd = attrs.renews_at
            ? new Date(attrs.renews_at).toISOString()
            : new Date(Date.now() + (sub.billing_cycle === 'annual' ? 365 : 30) * 24 * 60 * 60 * 1000).toISOString();

          await supabase.from('subscriptions')
            .update({
              status: 'active',
              current_period_start: new Date().toISOString(),
              current_period_end: newPeriodEnd,
              updated_at: new Date().toISOString()
            })
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
          console.log(`Renewal: granted ${sub.credits_per_month} credits, period extended to ${newPeriodEnd}`);
        }
        break;
      }

      // ---- Subscription payment failed ----
      case 'subscription_payment_failed': {
        const subId = `ls_sub_${attrs.subscription_id}`;
        const { data: sub } = await supabase
          .from('subscriptions')
          .select('*')
          .eq('stripe_subscription_id', subId)
          .single();

        if (sub) {
          await supabase.from('subscriptions')
            .update({ status: 'past_due', updated_at: new Date().toISOString() })
            .eq('stripe_subscription_id', subId);

          // Notify parent
          await supabase.from('notifications').insert({
            parent_id: sub.parent_id,
            type: 'payment_failed',
            title: 'Payment failed',
            message: `Your ${sub.plan_name} subscription payment failed. Please update your payment method to avoid losing access.`,
          }).catch(() => {});

          console.log(`Payment failed for subscription ${subId}, status set to past_due`);
        }
        break;
      }

      // ---- Subscription expired (end of billing period after cancellation) ----
      case 'subscription_expired': {
        const subId = `ls_sub_${event.data.id}`;
        const { data: sub } = await supabase
          .from('subscriptions')
          .select('*')
          .eq('stripe_subscription_id', subId)
          .single();

        if (sub) {
          await supabase.from('subscriptions')
            .update({ status: 'expired', updated_at: new Date().toISOString() })
            .eq('stripe_subscription_id', subId);

          console.log(`Subscription ${subId} expired for user ${sub.parent_id}`);
        }
        break;
      }

      // ---- Subscription resumed (reactivated after pause/cancel) ----
      case 'subscription_resumed': {
        const subId = `ls_sub_${event.data.id}`;
        const periodEnd = attrs.renews_at ? new Date(attrs.renews_at).toISOString() : null;

        const updateData = {
          status: 'active',
          updated_at: new Date().toISOString(),
        };
        if (periodEnd) updateData.current_period_end = periodEnd;

        await supabase.from('subscriptions')
          .update(updateData)
          .eq('stripe_subscription_id', subId);

        console.log(`Subscription ${subId} resumed`);
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
