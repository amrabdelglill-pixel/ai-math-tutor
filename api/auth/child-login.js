import { createServerClient } from '../../lib/supabase.js';
import { signChildToken } from '../../lib/child-auth.js';

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Missing username or password' });
    }

    const supabase = createServerClient();

    // Call the database function to verify child credentials
    const { data, error } = await supabase.rpc('verify_child_login', {
      p_username: username,
      p_password: password
    });

    if (error) {
      console.error('verify_child_login error:', error);
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    if (!data || !data.child_id) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    // Generate JWT token with 24 hour expiration
    const expiresAt = Math.floor(Date.now() / 1000) + 24 * 60 * 60;
    const token = signChildToken({
      child_id: data.child_id,
      parent_id: data.parent_id,
      child_name: data.child_name,
      grade: data.grade,
      language: data.language,
      exp: expiresAt
    });

    return res.status(200).json({
      success: true,
      token,
      child: {
        id: data.child_id,
        name: data.child_name,
        grade: data.grade,
        language: data.language
      },
      credits: data.credits || 0
    });
  } catch (error) {
    console.error('Child login error:', error);
    return res.status(500).json({ error: 'Login failed. Please try again.' });
  }
}
