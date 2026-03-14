import { createAuthClient, getUser } from '../../lib/supabase.js';

// GET: Fetch parent profile
async function handleGetProfile(req, res) {
  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const supabase = createAuthClient(req);
    const { data, error } = await supabase
      .from('profiles')
      .select('id, email, full_name, phone, created_at, updated_at')
      .eq('id', user.id)
      .single();

    if (error) {
      // If no profile row exists yet, return basic user info
      if (error.code === 'PGRST116') {
        return res.status(200).json({
          profile: {
            id: user.id,
            email: user.email,
            full_name: null,
            phone: null,
            created_at: user.created_at,
            updated_at: null
          }
        });
      }
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({ profile: data });
  } catch (err) {
    console.error('Get profile error:', err);
    return res.status(500).json({ error: err.message });
  }
}

// PUT: Update parent profile
async function handleUpdateProfile(req, res) {
  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const { full_name, phone } = req.body;

    const updates = { updated_at: new Date().toISOString() };
    if (full_name !== undefined) updates.full_name = full_name;
    if (phone !== undefined) updates.phone = phone;

    const supabase = createAuthClient(req);

    // Try update first
    const { data, error } = await supabase
      .from('profiles')
      .upsert({
        id: user.id,
        email: user.email,
        ...updates
      }, { onConflict: 'id' })
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });

    return res.status(200).json({ success: true, profile: data, message: 'Profile updated successfully' });
  } catch (err) {
    console.error('Update profile error:', err);
    return res.status(500).json({ error: err.message });
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') return handleGetProfile(req, res);
  if (req.method === 'PUT') return handleUpdateProfile(req, res);
  return res.status(405).json({ error: 'Method not allowed' });
}
