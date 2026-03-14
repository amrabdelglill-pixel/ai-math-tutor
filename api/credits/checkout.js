import { getUser } from '../../lib/supabase.js';

const STORE_ID = '315398';

// LemonSqueezy variant IDs — one per product
// NOTE: If checkout fails with "variant not found", replace these with variant IDs
// from LemonSqueezy dashboard → Products → [Product] → Variants → copy variant ID
const PRODUCTS = {
  // Monthly subscriptions
  starter_monthly:  { variantId: '1401741', credits: 60,   plan: 'starter',  cycle: 'monthly', type: 'subscription', maxChildren: 1 },
  standard_monthly: { variantId: '1401764', credits: 120,  plan: 'standard', cycle: 'monthly', type: 'subscription', maxChildren: 2 },
  premium_monthly:  { variantId: '1401745', credits: 300,  plan: 'premium',  cycle: 'monthly', type: 'subscription', maxChildren: 3 },
  family_monthly:   { variantId: '1401766', credits: 1000, plan: 'family',   cycle: 'monthly', type: 'subscription', maxChildren: 999 },
  // Annual subscriptions
  starter_annual:   { variantId: '1401776', credits: 60,   plan: 'starter',  cycle: 'annual', type: 'subscription', maxChildren: 1 },
  standard_annual:  { variantId: '1401777', credits: 120,  plan: 'standard', cycle: 'annual', type: 'subscription', maxChildren: 2 },
  premium_annual:   { variantId: '1401788', credits: 300,  plan: 'premium',  cycle: 'annual', type: 'subscription', maxChildren: 3 },
  family_annual:    { variantId: '1401789', credits: 1000, plan: 'family',   cycle: 'annual', type: 'subscription', maxChildren: 999 },
  // One-time credit packs
  quick_topup:      { variantId: '1401809', credits: 100, type: 'pack' },
  credit_pack:      { variantId: '1401816', credits: 300, type: 'pack' },
  credit_tank:      { variantId: '1401821', credits: 1000, type: 'pack' },
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });

  const { plan_id } = req.body;
  const product = PRODUCTS[plan_id];
  if (!product) return res.status(400).json({ error: `Unknown plan: ${plan_id}` });

  try {
    const checkoutBody = {
      data: {
        type: 'checkouts',
        attributes: {
          checkout_data: {
            email: user.email,
            custom: {
              user_id: user.id,
              plan_id,
              credits: String(product.credits),
              product_type: product.type,
              ...(product.plan && { plan_name: product.plan }),
              ...(product.cycle && { billing_cycle: product.cycle }),
              ...(product.maxChildren && { max_children: String(product.maxChildren) }),
            },
          },
          product_options: {
            redirect_url: `${req.headers.origin || 'https://ai-math-tutor-lemon.vercel.app'}/dashboard.html?payment=success`,
          },
        },
        relationships: {
          store: { data: { type: 'stores', id: STORE_ID } },
          variant: { data: { type: 'variants', id: product.variantId } },
        },
      },
    };

    const lsRes = await fetch('https://api.lemonsqueezy.com/v1/checkouts', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.LEMONSQUEEZY_API_KEY}`,
        'Accept': 'application/vnd.api+json',
        'Content-Type': 'application/vnd.api+json',
      },
      body: JSON.stringify(checkoutBody),
    });

    if (!lsRes.ok) {
      const errText = await lsRes.text();
      console.error('LemonSqueezy error:', lsRes.status, errText);
      return res.status(502).json({ error: 'Payment provider error' });
    }

    const lsData = await lsRes.json();
    const checkoutUrl = lsData.data?.attributes?.url;

    if (!checkoutUrl) {
      console.error('No checkout URL in response:', JSON.stringify(lsData));
      return res.status(502).json({ error: 'No checkout URL returned' });
    }

    return res.status(200).json({ url: checkoutUrl });
  } catch (error) {
    console.error('LemonSqueezy checkout error:', error);
    return res.status(500).json({ error: 'Failed to create checkout session' });
  }
}
