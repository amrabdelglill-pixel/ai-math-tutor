import { createAuthClient, getUser } from '../../lib/supabase.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });

  const supabase = createAuthClient(req);
  const { child_id, topic } = req.body;

  if (!child_id) return res.status(400).json({ error: 'child_id is required' });

  // Verify child belongs to parent
  const { data: child } = await supabase
    .from('children')
    .select('id, grade')
    .eq('id', child_id)
    .eq('parent_id', user.id)
    .single();

  if (!child) return res.status(404).json({ error: 'Child not found' });

  const { data: session, error } = await supabase
    .from('sessions')
    .insert({
      parent_id: user.id,
      child_id,
      grade: child.grade,
      topic: topic || 'Math practice'
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json({ session });
}
