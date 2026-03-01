import { createServerClient, getUser } from '../../lib/supabase.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });

  const supabase = createServerClient();

  const { data: balance } = await supabase.rpc('get_credit_balance', {
    p_parent_id: user.id
  });

  // Get recent transactions
  const { data: transactions } = await supabase
    .from('credit_ledger')
    .select('*')
    .eq('parent_id', user.id)
    .order('created_at', { ascending: false })
    .limit(10);

  // Get subscription info
  const { data: subscription } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('parent_id', user.id)
    .eq('status', 'active')
    .single();

  return res.status(200).json({
    credits: balance || 0,
    recent_transactions: transactions || [],
    subscription: subscription || null
  });
}
