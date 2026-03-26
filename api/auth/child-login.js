import { createServerClient } from '../../lib/supabase.js';
import { signChildToken } from '../../lib/child-auth.js';
import { checkRateLimit, getClientIP, RATE_LIMITS } from '../../lib/rate-limit.js';

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // Rate limit: 10 attempts per 15 minutes per IP
    const ip = getClientIP(req);
    const rl = checkRateLimit(`child-login:${ip}`, RATE_LIMITS.CHILD_LOGIN.maxRequests, RATE_LIMITS.CHILD_LOGIN.windowMs);
    if (!rl.allowed) {
      res.setHeader('Retry-After', Math.ceil(rl.resetIn / 1000));
      return res.status(429).json({
        error: 'Too many login attempts. Please wait and try again.',
        retryAfter: Math.ceil(rl.resetIn / 1000)
      });
    }

    const { parent_email, username, password } = req.body;
    if (!parent_email || !username || !password) {
      return res.status(400).json({ error: 'Missing parent email, username, or password' });
    }

    const supabase = createServerClient();

    // Call the database function to verify child credentials (scoped by parent email)
    const { data, error } = await supabase.rpc('verify_child_login', {
      p_parent_email: parent_email.toLowerCase().trim(),
      p_username: username,
      p_password: password
    });

    if (error) {
      console.error('verify_child_login error:', error);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (!data || !data.child_id) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Generate JWT token with 24 hour expiration
    const expiresAt = Math.floor(Date.now() / 1000) + 24 * 60 * 60;
    const token = signChildToken({
      child_id: data.child_id,
      parent_id: data.parent_id,
      child_name: data.name,
      grade: data.grade,
      language: data.language || 'en',
      exp: expiresAt
    });

    return res.status(200).json({
      success: true,
      token,
      child: {
        id: data.child_id,
        name: data.name,
        grade: data.grade,
        language: data.language || 'en'
      },
      credits: data.credits || 0
    });
  } catch (error) {
    console.error('Child login error:', error);
    return res.status(500).json({ error: 'Login failed. Please try again.' });
  }
}
