import { getUser } from '../../lib/supabase.js';

// LemonSqueezy product configuration
const PRODUCTS = {
  // Monthly subscriptions
  starter_monthly:  { variant: '1401741', credits: 60,   name: 'Starter Monthly' },
  standard_monthly: { variant: '1401764', credits: 120,  name: 'Standard Monthly' },
  premium_monthly:  { variant: '1401745', credits: 300,  name: 'Premium Monthly' },
  family_monthly:   { variant: '1401766', credits: 1000, name: 'Family Monthly' },
  // Annual subscriptions
  starter_annual:   { variant: '1401776', credits: 60,   name: 'Starter Annual' },
  standard_annual:  { variant: '1401777', credits: 120,  name: 'Standard Annual' },
  premium_annual:   { variant: '1401788', credits: 300,  name: 'Premium Annual' },
  family_annual:    { variant: '1401789', credits: 1000, name: 'Family Annual' },
  // One-time credit packs
  quick_topup:      { variant: '1401809', credits: 100,  name: 'Quick Top-Up' },
  credit_pack:      { variant: '1401816', credits: 300,  name: 'Credit Pack' },
  credit_tank:      { variant: '1401821', credits: 1000, name: 'Credit Tank' },
};

const STORE_ID = process.env.LEMONSQUEEZY_STORE_ID || '315398';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });

  const { plan_id } = req.body;

  if (!PRODUCTS[plan_id]) {
    return res.status(400).json({ error: 'Invalid plan_id. Valid options: ' + Object.keys(PRODUCTS).join(', ') });
  }

  const product = PRODUCTS[plan_id];
  const apiKey = process.env.LEMONSQUEEZY_API_KEY;

  if (!apiKey) {
    return res.status(500).json({ error: 'Payment system not configured' });
  }

  try {
    const response = await fetch('https://api.lemonsqueezy.com/v1/checkouts', {
      method: 'POST',
      headers: {
        'Accept': 'application/vnd.api+json',
        'Content-Type': 'application/vnd.api+json',
        'Authorization': 'Bearer ' + apiKey,
      },
      body: JSON.stringify({
        data: {
          type: 'checkouts',
          attributes: {
            checkout_data: {
              email: user.email,
              custom: {
                user_id: user.id,
                plan_id: plan_id,
                credits: String(product.credits),
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
              data: { type: 'stores', id: STORE_ID },
            },
            variant: {
              data: { type: 'variants', id: product.variant },
            },
          },
        },
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      console.error('LemonSqueezy error:', JSON.stringify(result));
      return res.status(500).json({ error: 'Failed to create checkout' });
    }

    return res.status(200).json({ url: result.data.attributes.url });
  } catch (error) {
    console.error('Checkout error:', error);
    return res.status(500).json({ error: 'Failed to create checkout session' });
  }
}
