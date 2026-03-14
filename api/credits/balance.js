import { createServerClient, getUser } from '../../lib/supabase.js';
import { getChildOrUser, getParentId } from '../../lib/child-auth.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authContext = await getChildOrUser(req);
  if (!authContext) return res.status(401).json({ error: 'Not authenticated' });

  const parentId = getParentId(authContext);
  const supabase = createServerClient();

  const { data: balance } = await supabase.rpc('get_credit_balance', {
    p_parent_id: parentId
  });

  // Get recent transactions (parent only)
  const { data: transactions } = await supabase
    .from('credit_ledger')
    .select('*')
    .eq('parent_id', parentId)
    .order('created_at', { ascending: false })
    .limit(10);

  // Get subscription info (parent only) - include trialing status
  const { data: subscription } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('parent_id', parentId)
    .in('status', ['active', 'trialing'])
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  return res.status(200).json({
    credits: balance || 0,
    recent_transactions: transactions || [],
    subscription: subscription || null
  });
}
