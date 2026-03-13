import { createClient } from '@supabase/supabase-js';

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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  const child = verifyChildToken(req);
  if (!child) return res.status(401).json({ error: 'Not authenticated' });
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  try {
    const { data: cd, error: ce } = await supabase.from('children').select('credit_limit_daily, credit_limit_weekly, credit_limit_monthly').eq('id', child.child_id).single();
    if (ce) return res.status(500).json({ error: ce.message });
    if (!cd.credit_limit_daily && !cd.credit_limit_weekly && !cd.credit_limit_monthly) {
      return res.status(200).json({ allowed: true, limits: null, message: 'No limits set' });
    }
    const { data: usage, error: ue } = await supabase.rpc('get_child_credit_usage', { p_child_id: child.child_id });
    if (ue) return res.status(500).json({ error: ue.message });
    const u = usage && usage.length > 0 ? usage[0] : { daily_used: 0, weekly_used: 0, monthly_used: 0 };
    const limits = {};
    let blocked = false, reason = '';
    if (cd.credit_limit_daily) {
      limits.daily = { limit: cd.credit_limit_daily, used: u.daily_used || 0, remaining: Math.max(0, cd.credit_limit_daily - (u.daily_used || 0)) };
      if (limits.daily.remaining <= 0) { blocked = true; reason = 'Daily credit limit reached'; }
    }
    if (cd.credit_limit_weekly) {
      limits.weekly = { limit: cd.credit_limit_weekly, used: u.weekly_used || 0, remaining: Math.max(0, cd.credit_limit_weekly - (u.weekly_used || 0)) };
      if (limits.weekly.remaining <= 0) { blocked = true; reason = reason || 'Weekly credit limit reached'; }
    }
    if (cd.credit_limit_monthly) {
      limits.monthly = { limit: cd.credit_limit_monthly, used: u.monthly_used || 0, remaining: Math.max(0, cd.credit_limit_monthly - (u.monthly_used || 0)) };
      if (limits.monthly.remaining <= 0) { blocked = true; reason = reason || 'Monthly credit limit reached'; }
    }
    return res.status(200).json({ allowed: !blocked, limits, message: blocked ? reason : 'Within limits' });
  } catch (err) { return res.status(500).json({ error: err.message }); }
}
