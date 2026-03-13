import Stripe from 'stripe';
import { getUser } from '../../lib/supabase.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Pricing configuration
const PLANS = {
  starter:  { credits: 60,  price: 1200, name: 'Starter (60 credits)' },
  standard: { credits: 120, price: 1800, name: 'Standard (120 credits)' },
  premium:  { credits: 300, price: 3000, name: 'Premium (300 credits)' },
};

const PACKS = {
  pack_30:  { credits: 30,  price: 500,  name: 'Extra 30 credits' },
  pack_60:  { credits: 60,  price: 1000, name: 'Extra 60 credits' },
  pack_150: { credits: 150, price: 2000, name: 'Extra 150 credits' },
  pack_300: { credits: 300, price: 2500, name: 'Extra 300 credits' },
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });

  const { type, plan_id } = req.body;
  // type: 'subscription' or 'pack'

  try {
    let sessionConfig;

    if (type === 'subscription' && PLANS[plan_id]) {
      const plan = PLANS[plan_id];
      sessionConfig = {
        mode: 'subscription',
        line_items: [{
          price_data: {
            currency: 'usd',
            recurring: { interval: 'month' },
            product_data: { name: plan.name },
            unit_amount: plan.price,
          },
          quantity: 1,
        }],
        metadata: {
          user_id: user.id,
          plan_id,
          credits: plan.credits.toString(),
          type: 'subscription'
        }
      };
    } else if (type === 'pack' && PACKS[plan_id]) {
      const pack = PACKS[plan_id];
      sessionConfig = {
        mode: 'payment',
        line_items: [{
          price_data: {
            currency: 'usd',
            product_data: { name: pack.name },
            unit_amount: pack.price,
          },
          quantity: 1,
        }],
        metadata: {
          user_id: user.id,
          plan_id,
          credits: pack.credits.toString(),
          type: 'pack'
        }
      };
    } else {
      return res.status(400).json({ error: 'Invalid plan or type' });
    }

    const checkoutSession = await stripe.checkout.sessions.create({
      ...sessionConfig,
      customer_email: user.email,
      success_url: `${req.headers.origin || 'https://ai-math-tutor-lemon.vercel.app'}/app?payment=success`,
      cancel_url: `${req.headers.origin || 'https://ai-math-tutor-lemon.vercel.app'}/app?payment=cancelled`,
    });

    return res.status(200).json({ url: checkoutSession.url });
  } catch (error) {
    console.error('Stripe checkout error:', error);
    return res.status(500).json({ error: 'Failed to create checkout session' });
  }
}
