import { createClient } from '@supabase/supabase-js';
import { createAuthClient, createServerClient, getUser } from '../lib/supabase.js';

/**
 * POST /api/children — Unified children endpoint
 * Body must include: { action: 'list' | 'add' | 'update' | 'delete' | 'set_credentials' | 'set_limits' | 'check_limits', ...params }
 *
 * Most actions require parent auth (Supabase JWT).
 * 'check_limits' uses child JWT auth.
 */

// Child JWT token verification (for check_limits)
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
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { action, ...params } = req.body;

    if (action === 'check_limits') return handleCheckLimits(req, res, params);

    // All other actions require parent auth
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'Not authenticated' });

    if (action === 'list') return handleList(req, res, user);
    if (action === 'add') return handleAdd(req, res, user, params);
    if (action === 'update') return handleUpdate(req, res, user, params);
    if (action === 'delete') return handleDelete(req, res, user, params);
    if (action === 'set_credentials') return handleSetCredentials(req, res, user, params);
    if (action === 'set_limits') return handleSetLimits(req, res, user, params);

    return res.status(400).json({ error: 'Invalid action. Use: list, add, update, delete, set_credentials, set_limits, or check_limits' });
  } catch (error) {
    console.error('Children error:', error);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
}

// ============================================
// ACTION: list — Get all children for parent
// ============================================
async function handleList(req, res, user) {
  const supabase = createAuthClient(req);
  const { data, error } = await supabase
    .from('children')
    .select('*')
    .eq('parent_id', user.id)
    .eq('is_active', true)
    .order('created_at');

  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ children: data });
}

// ============================================
// ACTION: add — Create a new child
// ============================================
async function handleAdd(req, res, user, params) {
  const { name, grade, preferred_language, phone } = params;
  if (!name || !grade) return res.status(400).json({ error: 'Name and grade are required' });
  if (grade < 1 || grade > 9) return res.status(400).json({ error: 'Grade must be 1-9' });

  const supabase = createAuthClient(req);
  const insertData = { parent_id: user.id, name, grade, preferred_language: preferred_language || 'en' };
  if (phone) insertData.phone = phone;

  const { data, error } = await supabase
    .from('children')
    .insert(insertData)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json({ child: data });
}

// ============================================
// ACTION: update — Update child details
// ============================================
async function handleUpdate(req, res, user, params) {
  const { child_id, name, grade, preferred_language, username, country } = params;
  if (!child_id) return res.status(400).json({ error: 'child_id is required' });

  const supabase = createAuthClient(req);

  const { data: child, error: childErr } = await supabase
    .from('children')
    .select('id, parent_id')
    .eq('id', child_id)
    .eq('parent_id', user.id)
    .eq('is_active', true)
    .single();

  if (childErr || !child) return res.status(404).json({ error: 'Child not found or does not belong to you' });

  const updates = {};
  if (name !== undefined) updates.name = name.trim();
  if (grade !== undefined) updates.grade = grade;
  if (preferred_language !== undefined) updates.preferred_language = preferred_language;
  if (username !== undefined) {
    const cleanUsername = username.trim().toLowerCase();
    if (cleanUsername.length < 3) return res.status(400).json({ error: 'Username must be at least 3 characters' });
    const { data: existing } = await supabase
      .from('children')
      .select('id')
      .eq('parent_id', user.id)
      .eq('username', cleanUsername)
      .neq('id', child_id)
      .eq('is_active', true)
      .single();
    if (existing) return res.status(409).json({ error: 'Username already taken by another child' });
    updates.username = cleanUsername;
  }
  if (country !== undefined) updates.country = country;
  updates.updated_at = new Date().toISOString();

  if (Object.keys(updates).length === 1) return res.status(400).json({ error: 'No fields to update' });

  const { data, error } = await supabase
    .from('children')
    .update(updates)
    .eq('id', child_id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ success: true, child: data, message: 'Child updated successfully' });
}

// ============================================
// ACTION: delete — Soft-delete child
// ============================================
async function handleDelete(req, res, user, params) {
  const { child_id } = params;
  if (!child_id) return res.status(400).json({ error: 'child_id is required' });

  const supabase = createAuthClient(req);

  const { data: child, error: childErr } = await supabase
    .from('children')
    .select('id, parent_id, name')
    .eq('id', child_id)
    .eq('parent_id', user.id)
    .eq('is_active', true)
    .single();

  if (childErr || !child) return res.status(404).json({ error: 'Child not found or already removed' });

  const { error } = await supabase
    .from('children')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('id', child_id);

  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ success: true, message: child.name + ' has been removed successfully' });
}

// ============================================
// ACTION: set_credentials — Parent sets child login
// ============================================
async function handleSetCredentials(req, res, user, params) {
  const { child_id, username, password } = params;
  if (!child_id || !username || !password) {
    return res.status(400).json({ error: 'Missing required fields: child_id, username, password' });
  }
  if (!/^[a-zA-Z0-9]{3,20}$/.test(username)) {
    return res.status(400).json({ error: 'Username must be 3-20 characters and contain only letters and numbers' });
  }
  if (password.length < 4) {
    return res.status(400).json({ error: 'Password must be at least 4 characters' });
  }

  const supabase = createServerClient();

  const { data: child } = await supabase
    .from('children')
    .select('id')
    .eq('id', child_id)
    .eq('parent_id', user.id)
    .single();

  if (!child) return res.status(404).json({ error: 'Child not found' });

  const { data, error } = await supabase.rpc('set_child_password', {
    p_child_id: child_id,
    p_parent_id: user.id,
    p_username: username,
    p_password: password
  });

  if (error) {
    console.error('set_child_password error:', error);
    if (error.message.includes('unique') || error.message.includes('username')) {
      return res.status(400).json({ error: 'Username already taken' });
    }
    return res.status(500).json({ error: error.message || 'Failed to set credentials' });
  }

  return res.status(200).json({ success: true, message: 'Credentials set successfully', username });
}

// ============================================
// ACTION: set_limits — Parent sets credit limits
// ============================================
async function handleSetLimits(req, res, user, params) {
  const { child_id, credit_limit_daily, credit_limit_weekly, credit_limit_monthly } = params;
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
}

// ============================================
// ACTION: check_limits — Child checks own limits
// ============================================
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
