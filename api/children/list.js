import { createAuthClient, getUser } from '../../lib/supabase.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });

  const supabase = createAuthClient(req);

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('children')
      .select('*')
      .eq('parent_id', user.id)
      .eq('is_active', true)
      .order('created_at');

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ children: data });
  }

  if (req.method === 'POST') {
    const { name, grade, preferred_language } = req.body;
    if (!name || !grade) return res.status(400).json({ error: 'Name and grade are required' });
    if (grade < 1 || grade > 9) return res.status(400).json({ error: 'Grade must be 1-9' });

    const { data, error } = await supabase
      .from('children')
      .insert({ parent_id: user.id, name, grade, preferred_language: preferred_language || 'en' })
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json({ child: data });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
