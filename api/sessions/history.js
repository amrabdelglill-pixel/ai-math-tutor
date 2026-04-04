import { createServerClient, getUser } from '../../lib/supabase.js';
import { getChildOrUser, getParentId } from '../../lib/child-auth.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // Accept both parent Supabase JWT and child custom JWT
  const authContext = await getChildOrUser(req);
  if (!authContext) return res.status(401).json({ error: 'Not authenticated' });

  const parentId = getParentId(authContext);

  // Use service role client to bypass RLS — we verify ownership via parent_id
  const supabase = createServerClient();
  const { child_id, session_id } = req.query;

  let query = supabase
    .from('sessions')
    .select('*, children(name, grade), messages(role, content, created_at, flagged)')
    .eq('parent_id', parentId)
    .order('started_at', { ascending: false });

  if (session_id) {
    query = query.eq('id', session_id);
  } else {
    query = query.limit(50);
    if (child_id) {
      query = query.eq('child_id', child_id);
    }
  }

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  return res.status(200).json({ sessions: data });
}
