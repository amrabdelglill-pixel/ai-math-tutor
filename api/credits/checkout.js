import { getUser } from '../../lib/supabase.js';

// LemonSqueezy variant IDs - UPDATE THESE after creating products
const VARIANTS = {
  // Monthly subscriptions
  starter_monthly: process.env.LS_VARIANT_STARTER_MONTHLY || 'PLACEHOLDER',
  standard_monthly: process.env.LS_VARIANT_STANDARD_MONTHLY || 'PLACEHOLDER',
  premium_monthly: process.env.LS_VARIANT_PREMIUM_MONTHLY || 'PLACEHOLDER',
  // Annual subscriptions
  starter_annual: process.env.LS_VARIANT_STARTER_ANNUAL || 'PLACEHOLDER',
  standard_annual: process.env.LS_VARIANT_STANDARD_ANNUAL || 'PLACEHOLDER',
  premium_annual: process.env.LS_VARIANT_PREMIUM_ANNUAL || 'PLACEHOLDER',
  // Credit packs (one-time)
  pack_30: process.env.LS_VARIANT_PACK_30 || 'PLACEHOLDER',
  pack_60: process.env.LS_VARIANT_PACK_60 || 'PLACEHOLDER',
  pack_150: process.env.LS_VARIANT_PACK_150 || 'PLACEHOLDER',
  pack_300: process.env.LS_VARIANT_PACK_300 || 'PLACEHOLDER',
};

// Credits mapping per variant
const CREDITS_MAP = {
  starter_monthly: 60,
  standard_monthly: 120,
  premium_monthly: 300,
  starter_annual: 60,
  standard_annual: 120,
  premium_annual: 300,
  pack_30: 30,
  pack_60: 60,
  pack_150: 150,
  pack_300: 300,
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });

  const { plan_id } = req.body;
  // plan_id: 'starter_monthly', 'premium_annual', 'pack_30', etc.

  if (!VARIANTS[plan_id] || VARIANTS[plan_id] === 'PLACEHOLDER') {
    return res.status(400).json({ error: 'Invalid plan or variant not configured' });
  }

  const storeId = process.env.LEMONSQUEEZY_STORE_ID;
  const apiKey = process.env.LEMONSQUEEZY_API_KEY;

  if (!storeId || !apiKey) {
    return res.status(500).json({ error: 'Payment system not configured' });
  }

  try {
    const checkoutPayload = {
      data: {
        type: 'checkouts',
        attributes: {
          checkout_data: {
            email: user.email,
            custom: {
              user_id: user.id,
              plan_id: plan_id,
              credits: String(CREDITS_MAP[plan_id]),
            },
          },
          checkout_options: {
            dark: true,
            embed: true,
          },
          product_options: {
            redirect_url: 'https://zeluu.com/dashboard.html?payment=success',
          },
        },
        relationships: {
          store: {
            data: { type: 'stores', id: storeId },
          },
          variant: {
            data: { type: 'variants', id: VARIANTS[plan_id] },
          },
        },
      },
    };

    const response = await fetch('https://api.lemonsqueezy.com/v1/checkouts', {
      method: 'POST',
      headers: {
        'Accept': 'application/vnd.api+json',
        'Content-Type': 'application/vnd.api+json',
        'Authorization': 'Bearer ' + apiKey,
      },
      body: JSON.stringify(checkoutPayload),
    });

    const result = await response.json();

    if (!response.ok) {
      console.error('LemonSqueezy error:', JSON.stringify(result));
      return res.status(500).json({ error: 'Failed to create checkout' });
    }

    const checkoutUrl = result.data.attributes.url;
    return res.status(200).json({ url: checkoutUrl });
  } catch (error) {
    console.error('Checkout error:', error);
    return res.status(500).json({ error: 'Failed to create checkout session' });
  }
}
