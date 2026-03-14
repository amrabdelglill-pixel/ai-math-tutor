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

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  try {
    // Get limit settings from children table
    const { data: cd, error: ce } = await supabase
      .from('children')
      .select('credit_limit_daily, credit_limit_weekly, credit_limit_monthly')
      .eq('id', child.child_id)
      .single();

    if (ce) return res.status(500).json({ error: ce.message });

    // If no limits set at all, allow
    if (!cd.credit_limit_daily && !cd.credit_limit_weekly && !cd.credit_limit_monthly) {
      return res.status(200).json({ allowed: true, limits: null, message: 'No limits set' });
    }

    // Use get_child_limits_summary RPC which returns all periods
    const { data: summary, error: ue } = await supabase
      .rpc('get_child_limits_summary', { p_child_id: child.child_id });

    if (ue) return res.status(500).json({ error: ue.message });

    const limits = {};
    let blocked = false, reason = '';

    if (cd.credit_limit_daily && summary.daily) {
      limits.daily = {
        limit: summary.daily.limit,
        used: summary.daily.usage || 0,
        remaining: summary.daily.remaining || 0
      };
      if (summary.daily.exceeded) { blocked = true; reason = 'Daily credit limit reached'; }
    }

    if (cd.credit_limit_weekly && summary.weekly) {
      limits.weekly = {
        limit: summary.weekly.limit,
        used: summary.weekly.usage || 0,
        remaining: summary.weekly.remaining || 0
      };
      if (summary.weekly.exceeded) { blocked = true; reason = reason || 'Weekly credit limit reached'; }
    }

    if (cd.credit_limit_monthly && summary.monthly) {
      limits.monthly = {
        limit: summary.monthly.limit,
        used: summary.monthly.usage || 0,
        remaining: summary.monthly.remaining || 0
      };
      if (summary.monthly.exceeded) { blocked = true; reason = reason || 'Monthly credit limit reached'; }
    }

    return res.status(200).json({
      allowed: !blocked,
      limits,
      message: blocked ? reason : 'Within limits'
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
