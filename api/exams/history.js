import { createServerClient } from '../../lib/supabase.js';
import { getChildOrUser, getParentId } from '../../lib/child-auth.js';

/**
 * GET /api/exams/history?child_id=xxx&subject=math&limit=20
 * Returns exam history with scores, weak areas, and trend data.
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const authContext = await getChildOrUser(req);
    if (!authContext) return res.status(401).json({ error: 'Not authenticated' });

    const parentId = getParentId(authContext);
    const supabase = createServerClient();

    const { child_id, subject, limit = 20 } = req.query;
    if (!child_id) return res.status(400).json({ error: 'child_id is required' });

    // Verify child belongs to parent
    const { data: child } = await supabase
      .from('children')
      .select('id, name, grade')
      .eq('id', child_id)
      .eq('parent_id', parentId)
      .single();

    if (!child) return res.status(404).json({ error: 'Child not found' });

    // Fetch completed attempts with exam details
    let query = supabase
      .from('exam_attempts')
      .select(`
        id, score, max_score, percentage, time_spent_seconds,
        weak_topics, strong_topics, status, started_at, completed_at,
        exams(id, subject, grade, topic, difficulty, question_count, country)
      `)
      .eq('child_id', child_id)
      .eq('status', 'completed')
      .order('completed_at', { ascending: false })
      .limit(parseInt(limit));

    if (subject) {
      query = query.eq('exams.subject', subject);
    }

    const { data: attempts, error } = await query;

    if (error) {
      console.error('History fetch error:', error);
      return res.status(500).json({ error: 'Failed to fetch exam history' });
    }

    // Filter out attempts where exam subject didn't match (Supabase inner join quirk)
    const filteredAttempts = subject
      ? (attempts || []).filter(a => a.exams !== null)
      : (attempts || []);

    // Calculate aggregate stats
    const totalExams = filteredAttempts.length;
    const avgPercentage = totalExams > 0
      ? Math.round(filteredAttempts.reduce((s, a) => s + (a.percentage || 0), 0) / totalExams * 100) / 100
      : 0;

    // Aggregate weak topics across all exams
    const weakTopicCounts = {};
    const strongTopicCounts = {};
    for (const a of filteredAttempts) {
      for (const t of (a.weak_topics || [])) {
        weakTopicCounts[t] = (weakTopicCounts[t] || 0) + 1;
      }
      for (const t of (a.strong_topics || [])) {
        strongTopicCounts[t] = (strongTopicCounts[t] || 0) + 1;
      }
    }

    // Sort by frequency
    const topWeakTopics = Object.entries(weakTopicCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([topic, count]) => ({ topic, count }));

    const topStrongTopics = Object.entries(strongTopicCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([topic, count]) => ({ topic, count }));

    // Score trend (last N exams, oldest first)
    const scoreTrend = filteredAttempts
      .slice(0, 10)
      .reverse()
      .map(a => ({
        date: a.completed_at,
        percentage: a.percentage,
        subject: a.exams?.subject,
        topic: a.exams?.topic
      }));

    return res.status(200).json({
      child_name: child.name,
      child_grade: child.grade,
      total_exams: totalExams,
      average_percentage: avgPercentage,
      top_weak_topics: topWeakTopics,
      top_strong_topics: topStrongTopics,
      score_trend: scoreTrend,
      exams: filteredAttempts.map(a => ({
        attempt_id: a.id,
        exam_id: a.exams?.id,
        subject: a.exams?.subject,
        topic: a.exams?.topic,
        difficulty: a.exams?.difficulty,
        score: a.score,
        max_score: a.max_score,
        percentage: a.percentage,
        time_spent_seconds: a.time_spent_seconds,
        weak_topics: a.weak_topics,
        strong_topics: a.strong_topics,
        completed_at: a.completed_at
      }))
    });

  } catch (error) {
    console.error('Exam history error:', error);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
}
