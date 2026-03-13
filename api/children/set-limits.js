import { createAuthClient, getUser } from '../../lib/supabase.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const { child_id, credit_limit_daily, credit_limit_weekly, credit_limit_monthly } = req.body;

    if (!child_id) {
      return res.status(400).json({ error: 'child_id is required' });
    }

    // Validate limits are positive integers or null
    const validateLimit = (val, name) => {
      if (val === null || val === undefined) return null;
      const n = parseInt(val);
      if (isNaN(n) || n < 0) throw new Error(name + ' must be a positive number or null');
      return n;
    };

    const daily = validateLimit(credit_limit_daily, 'credit_limit_daily');
    const weekly = validateLimit(credit_limit_weekly, 'credit_limit_weekly');
    const monthly = validateLimit(credit_limit_monthly, 'credit_limit_monthly');

    const supabase = createAuthClient(req);

    // Verify child belongs to this parent
    const { data: child, error: childErr } = await supabase
      .from('children')
      .select('id, parent_id')
      .eq('id', child_id)
      .eq('parent_id', user.id)
      .single();

    if (childErr || !child) {
      return res.status(404).json({ error: 'Child not found' });
    }

    // Update credit limits
    const { data, error } = await supabase
      .from('children')
      .update({
        credit_limit_daily: daily,
        credit_limit_weekly: weekly,
        credit_limit_monthly: monthly,
        updated_at: new Date().toISOString()
      })
      .eq('id', child_id)
      .select()
      .single();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({
      success: true,
      child: data,
      message: 'Credit limits updated successfully'
    });
  } catch (err) {
    console.error('Set limits error:', err);
    return res.status(400).json({ error: err.message });
  }
}
