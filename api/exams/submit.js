import { createServerClient } from '../../lib/supabase.js';
import { getChildOrUser, getParentId } from '../../lib/child-auth.js';

/**
 * POST /api/exams/submit
 * Submits exam answers, scores them, and identifies weak areas.
 *
 * Body: { attempt_id, answers: [{ question_id, child_answer, time_spent_seconds? }] }
 * Returns: { score, max_score, percentage, results: [...], weak_topics, strong_topics }
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const authContext = await getChildOrUser(req);
    if (!authContext) return res.status(401).json({ error: 'Not authenticated' });

    const parentId = getParentId(authContext);
    const supabase = createServerClient();

    const { attempt_id, answers } = req.body;

    if (!attempt_id || !answers || !Array.isArray(answers)) {
      return res.status(400).json({ error: 'attempt_id and answers array are required' });
    }

    // Get the attempt and verify ownership
    const { data: attempt } = await supabase
      .from('exam_attempts')
      .select('*, exams(parent_id, subject, grade, topic)')
      .eq('id', attempt_id)
      .single();

    if (!attempt) return res.status(404).json({ error: 'Attempt not found' });
    if (attempt.exams.parent_id !== parentId) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    if (attempt.status === 'completed') {
      return res.status(400).json({ error: 'This attempt has already been submitted' });
    }

    // Get all questions for this exam (with correct answers)
    const { data: questions } = await supabase
      .from('exam_questions')
      .select('id, question_index, question_text, correct_answer, explanation, topic, difficulty, points')
      .eq('exam_id', attempt.exam_id)
      .order('question_index');

    if (!questions || questions.length === 0) {
      return res.status(404).json({ error: 'No questions found for this exam' });
    }

    // Build a lookup map
    const questionMap = new Map(questions.map(q => [q.id, q]));

    // Score each answer
    let score = 0;
    let maxScore = 0;
    const topicResults = {}; // { topic: { correct: 0, total: 0 } }
    const results = [];
    const answerRows = [];

    for (const ans of answers) {
      const question = questionMap.get(ans.question_id);
      if (!question) continue;

      // Normalize answers for comparison
      const childAnswer = (ans.child_answer || '').trim();
      const correctAnswer = question.correct_answer.trim();

      // Flexible matching: case-insensitive, trim whitespace
      // For MCQ: compare letter only (A, B, C, D)
      let isCorrect = false;
      const childNorm = childAnswer.toLowerCase().replace(/[^a-z0-9\u0600-\u06FF]/g, '');
      const correctNorm = correctAnswer.toLowerCase().replace(/[^a-z0-9\u0600-\u06FF]/g, '');

      if (childNorm === correctNorm) {
        isCorrect = true;
      } else if (childAnswer.toLowerCase().startsWith(correctAnswer.toLowerCase().charAt(0)) && correctAnswer.length === 1) {
        // MCQ: child answered "B) xyz" and correct is "B"
        isCorrect = childAnswer.charAt(0).toLowerCase() === correctAnswer.charAt(0).toLowerCase();
      }

      if (isCorrect) score += question.points;
      maxScore += question.points;

      // Track by topic
      const topic = question.topic || 'general';
      if (!topicResults[topic]) topicResults[topic] = { correct: 0, total: 0 };
      topicResults[topic].total++;
      if (isCorrect) topicResults[topic].correct++;

      results.push({
        question_id: question.id,
        question_index: question.question_index,
        question_text: question.question_text,
        child_answer: childAnswer,
        correct_answer: question.correct_answer,
        is_correct: isCorrect,
        explanation: question.explanation,
        topic: question.topic,
        difficulty: question.difficulty
      });

      answerRows.push({
        attempt_id,
        question_id: question.id,
        child_answer: childAnswer,
        is_correct: isCorrect,
        time_spent_seconds: ans.time_spent_seconds || null
      });
    }

    const percentage = maxScore > 0 ? Math.round((score / maxScore) * 10000) / 100 : 0;

    // Identify weak and strong topics
    const weakTopics = [];
    const strongTopics = [];
    for (const [topic, result] of Object.entries(topicResults)) {
      const topicPct = result.total > 0 ? result.correct / result.total : 0;
      if (topicPct < 0.5) weakTopics.push(topic);
      else if (topicPct >= 0.8) strongTopics.push(topic);
    }

    // Calculate total time
    const totalTime = answers.reduce((sum, a) => sum + (a.time_spent_seconds || 0), 0);

    // Save answers
    if (answerRows.length > 0) {
      await supabase.from('exam_answers').insert(answerRows);
    }

    // Update attempt
    await supabase
      .from('exam_attempts')
      .update({
        completed_at: new Date().toISOString(),
        score,
        max_score: maxScore,
        percentage,
        time_spent_seconds: totalTime || null,
        weak_topics: weakTopics,
        strong_topics: strongTopics,
        status: 'completed'
      })
      .eq('id', attempt_id);

    // Update exam status
    await supabase
      .from('exams')
      .update({ status: 'completed', updated_at: new Date().toISOString() })
      .eq('id', attempt.exam_id);

    // Notify parent of exam completion
    await supabase.from('notifications').insert({
      parent_id: parentId,
      type: 'exam_completed',
      title: `Exam completed: ${percentage}%`,
      body: `Your child scored ${score}/${maxScore} (${percentage}%) on a ${attempt.exams.subject} exam (Grade ${attempt.exams.grade}).${weakTopics.length > 0 ? ` Weak areas: ${weakTopics.join(', ')}.` : ' Great performance!'}`,
      child_id: attempt.child_id
    });

    return res.status(200).json({
      attempt_id,
      score,
      max_score: maxScore,
      percentage,
      time_spent_seconds: totalTime,
      weak_topics: weakTopics,
      strong_topics: strongTopics,
      topic_breakdown: topicResults,
      results
    });

  } catch (error) {
    console.error('Exam submit error:', error);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
}
