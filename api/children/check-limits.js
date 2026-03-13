import { createServerClient } from '../../lib/supabase.js';
import { verifyChildToken } from '../../lib/child-auth.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization?.replace('Bearer ', '');
  if (!authHeader) return res.status(401).json({ error: 'Not authenticated' });

  let childId = req.query.child_id;

  // Try child token first
  const childPayload = verifyChildToken(authHeader);
  if (childPayload) {
    childId = childPayload.child_id;
  }

  if (!childId) {
    return res.status(400).json({ error: 'child_id is required' });
  }

  try {
    const supabase = createServerClient();

    const { data, error } = await supabase.rpc('get_child_limits_summary', {
      p_child_id: childId
    });

    if (error) {
      console.error('Check limits error:', error);
      return res.status(500).json({ error: error.message });
    }

    const limits = data;
    const exceeded = [];
    if (limits.daily?.exceeded) exceeded.push('daily');
    if (limits.weekly?.exceeded) exceeded.push('weekly');
    if (limits.monthly?.exceeded) exceeded.push('monthly');

    if (exceeded.length > 0) {
      const { data: child } = await supabase
        .from('children')
        .select('name, parent_id')
        .eq('id', childId)
        .single();

      if (child) {
        const today = new Date().toISOString().split('T')[0];
        const { data: existing } = await supabase
          .from('notifications')
          .select('id')
          .eq('parent_id', child.parent_id)
          .eq('child_id', childId)
          .eq('type', 'credit_limit_reached')
          .gte('created_at', today + 'T00:00:00Z')
          .limit(1);

        if (!existing || existing.length === 0) {
          await supabase.from('notifications').insert({
            parent_id: child.parent_id,
            child_id: childId,
            type: 'credit_limit_reached',
            title: child.name + ' reached credit limit',
            body: child.name + ' has exceeded their ' + exceeded.join(' and ') + ' credit limit.'
          });
        }
      }
    }

    return res.status(200).json({
      child_id: childId,
      limits: data,
      exceeded: exceeded,
      should_notify: exceeded.length > 0
    });
  } catch (err) {
    console.error('Check limits error:', err);
    return res.status(500).json({ error: 'Failed to check limits' });
  }
}
