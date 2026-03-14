import { createClient } from '@supabase/supabase-js';
import { createAuthClient, getUser } from '../../lib/supabase.js';

// Child JWT token verification (for GET - check limits)
function verifyChildToken(req) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return null;
  const token = auth.replace('Bearer ', '');
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
    if (!payload.child_id || !payload.parent_id) return null;
    if (payload.exp && payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch (e) { return null; }
}

// GET: Child checks their credit limits
async function handleCheckLimits(req, res) {
  const child = verifyChildToken(req);
  if (!child) return res.status(401).json({ error: 'Not authenticated' });

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  try {
    const { data: cd, error: ce } = await supabase
      .from('children')
      .select('credit_limit_daily, credit_limit_weekly, credit_limit_monthly')
      .eq('id', child.child_id)
      .single();

    if (ce) return res.status(500).json({ error: ce.message });

    if (!cd.credit_limit_daily && !cd.credit_limit_weekly && !cd.credit_limit_monthly) {
      return res.status(200).json({ allowed: true, limits: null, message: 'No limits set' });
    }

    const { data: summary, error: ue } = await supabase
      .rpc('get_child_limits_summary', { p_child_id: child.child_id });

    if (ue) return res.status(500).json({ error: ue.message });

    const limits = {};
    let blocked = false, reason = '';

    if (cd.credit_limit_daily && summary.daily) {
      limits.daily = { limit: summary.daily.limit, used: summary.daily.usage || 0, remaining: summary.daily.remaining || 0 };
      if (summary.daily.exceeded) { blocked = true; reason = 'Daily credit limit reached'; }
    }
    if (cd.credit_limit_weekly && summary.weekly) {
      limits.weekly = { limit: summary.weekly.limit, used: summary.weekly.usage || 0, remaining: summary.weekly.remaining || 0 };
      if (summary.weekly.exceeded) { blocked = true; reason = reason || 'Weekly credit limit reached'; }
    }
    if (cd.credit_limit_monthly && summary.monthly) {
      limits.monthly = { limit: summary.monthly.limit, used: summary.monthly.usage || 0, remaining: summary.monthly.remaining || 0 };
      if (summary.monthly.exceeded) { blocked = true; reason = reason || 'Monthly credit limit reached'; }
    }

    return res.status(200).json({ allowed: !blocked, limits, message: blocked ? reason : 'Within limits' });
  } catch (err) { return res.status(500).json({ error: err.message }); }
}

// POST: Parent sets credit limits
async function handleSetLimits(req, res) {
  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const { child_id, credit_limit_daily, credit_limit_weekly, credit_limit_monthly } = req.body;
    if (!child_id) return res.status(400).json({ error: 'child_id is required' });

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

    const { data: child, error: childErr } = await supabase
      .from('children').select('id, parent_id')
      .eq('id', child_id).eq('parent_id', user.id).single();

    if (childErr || !child) return res.status(404).json({ error: 'Child not found' });

    const { data, error } = await supabase
      .from('children')
      .update({ credit_limit_daily: daily, credit_limit_weekly: weekly, credit_limit_monthly: monthly, updated_at: new Date().toISOString() })
      .eq('id', child_id).select().single();

    if (error) return res.status(500).json({ error: error.message });

    return res.status(200).json({ success: true, child: data, message: 'Credit limits updated successfully' });
  } catch (err) {
    console.error('Set limits error:', err);
    return res.status(400).json({ error: err.message });
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') return handleCheckLimits(req, res);
  if (req.method === 'POST') return handleSetLimits(req, res);
  return res.status(405).json({ error: 'Method not allowed' });
}
