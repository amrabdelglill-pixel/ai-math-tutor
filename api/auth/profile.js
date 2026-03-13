import { createAuthClient, getUser } from '../../lib/supabase.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  const supabase = createAuthClient(req);

  if (req.method === 'GET') {
    const { data, error } = await supabase.from('profiles').select('*').eq('id', user.id).single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ profile: { ...data, email: user.email } });
  }

  if (req.method === 'PUT') {
    const { full_name, phone, country } = req.body;
    const updates = { updated_at: new Date().toISOString() };
    if (full_name !== undefined) updates.full_name = full_name;
    if (phone !== undefined) updates.phone = phone;
    if (country !== undefined) updates.country = country;

    const { data, error } = await supabase.from('profiles').update(updates).eq('id', user.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ success: true, profile: { ...data, email: user.email } });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
