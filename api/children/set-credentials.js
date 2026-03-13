import { createServerClient, getUser } from '../../lib/supabase.js';

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // Require parent auth
    const user = await getUser(req);
    if (!user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { child_id, username, password } = req.body;
    if (!child_id || !username || !password) {
      return res.status(400).json({ error: 'Missing required fields: child_id, username, password' });
    }

    // Validate username: 3-20 chars, alphanumeric
    if (!/^[a-zA-Z0-9]{3,20}$/.test(username)) {
      return res.status(400).json({
        error: 'Username must be 3-20 characters and contain only letters and numbers'
      });
    }

    // Validate password: min 4 chars
    if (password.length < 4) {
      return res.status(400).json({ error: 'Password must be at least 4 characters' });
    }

    const supabase = createServerClient();

    // Verify child belongs to parent
    const { data: child } = await supabase
      .from('children')
      .select('id')
      .eq('id', child_id)
      .eq('parent_id', user.id)
      .single();

    if (!child) {
      return res.status(404).json({ error: 'Child not found' });
    }

    // Call RPC to set credentials
    const { data, error } = await supabase.rpc('set_child_password', {
      p_child_id: child_id,
      p_parent_id: user.id,
      p_username: username,
      p_password: password
    });

    if (error) {
      console.error('set_child_password error:', error);
      // Check if error is about duplicate username
      if (error.message.includes('unique') || error.message.includes('username')) {
        return res.status(400).json({ error: 'Username already taken' });
      }
      return res.status(500).json({ error: error.message || 'Failed to set credentials' });
    }

    return res.status(200).json({
      success: true,
      message: 'Credentials set successfully',
      username
    });
  } catch (error) {
    console.error('Set credentials error:', error);
    return res.status(500).json({ error: 'Failed to set credentials' });
  }
}
