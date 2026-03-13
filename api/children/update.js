import { createAuthClient, getUser } from '../../lib/supabase.js';

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Authenticate parent
  const user = await getUser(req);
  if (!user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const supabase = createAuthClient(req);

  // PUT: Update child details
  if (req.method === 'PUT') {
    try {
      const { child_id, name, grade, preferred_language, username, country } = req.body;

      if (!child_id) {
        return res.status(400).json({ error: 'child_id is required' });
      }

      // Verify child belongs to this parent
      const { data: child, error: childErr } = await supabase
        .from('children')
        .select('id, parent_id')
        .eq('id', child_id)
        .eq('parent_id', user.id)
        .eq('is_active', true)
        .single();

      if (childErr || !child) {
        return res.status(404).json({ error: 'Child not found or does not belong to you' });
      }

      // Build update object with only provided fields
      const updates = {};
      if (name !== undefined) updates.name = name.trim();
      if (grade !== undefined) updates.grade = grade;
      if (preferred_language !== undefined) updates.preferred_language = preferred_language;
      if (username !== undefined) {
        const cleanUsername = username.trim().toLowerCase();
        if (cleanUsername.length < 3) {
          return res.status(400).json({ error: 'Username must be at least 3 characters' });
        }
        // Check username uniqueness for this parent
        const { data: existing } = await supabase
          .from('children')
          .select('id')
          .eq('parent_id', user.id)
          .eq('username', cleanUsername)
          .neq('id', child_id)
          .eq('is_active', true)
          .single();

        if (existing) {
          return res.status(409).json({ error: 'Username already taken by another child' });
        }
        updates.username = cleanUsername;
      }
      if (country !== undefined) updates.country = country;
      updates.updated_at = new Date().toISOString();

      if (Object.keys(updates).length === 1) {
        return res.status(400).json({ error: 'No fields to update' });
      }

      const { data, error } = await supabase
        .from('children')
        .update(updates)
        .eq('id', child_id)
        .select()
        .single();

      if (error) {
        return res.status(500).json({ error: error.message });
      }

      return res.status(200).json({
        success: true,
        child: data,
        message: 'Child updated successfully'
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // DELETE: Soft-delete child (set is_active = false)
  if (req.method === 'DELETE') {
    try {
      const child_id = req.query.child_id || req.body?.child_id;

      if (!child_id) {
        return res.status(400).json({ error: 'child_id is required' });
      }

      // Verify child belongs to this parent
      const { data: child, error: childErr } = await supabase
        .from('children')
        .select('id, parent_id, name')
        .eq('id', child_id)
        .eq('parent_id', user.id)
        .eq('is_active', true)
        .single();

      if (childErr || !child) {
        return res.status(404).json({ error: 'Child not found or already removed' });
      }

      // Soft delete
      const { error } = await supabase
        .from('children')
        .update({
          is_active: false,
          updated_at: new Date().toISOString()
        })
        .eq('id', child_id);

      if (error) {
        return res.status(500).json({ error: error.message });
      }

      return res.status(200).json({
        success: true,
        message: child.name + ' has been removed successfully'
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
