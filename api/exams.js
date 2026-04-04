import OpenAI from 'openai';
import { createServerClient } from '../lib/supabase.js';
import { getChildOrUser, getParentId } from '../lib/child-auth.js';
import { CURRICULUM_MAP, COUNTRY_CODE_MAP } from '../lib/prompts.js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * POST /api/exams — Unified exam endpoint
 * Body must include: { action: 'generate' | 'submit' | 'history', ...params }
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
    const { action, ...params } = req.body;

    if (action === 'generate') return handleGenerate(req, res, supabase, parentId, params);
    if (action === 'submit') return handleSubmit(req, res, supabase, parentId, params);
    if (action === 'history') return handleHistory(req, res, supabase, parentId, params);

    return res.status(400).json({ error: 'Invalid action. Use: generate, submit, or history' });

  } catch (error) {
    console.error('Exam error:', error);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
}

// ============================================
// ACTION: generate — Create AI-powered exam
// ============================================
async function handleGenerate(req, res, supabase, parentId, params) {
  const {
    child_id,
    subject = 'math',
    topic = null,
    difficulty = 'mixed',
    question_count = 10,
    time_limit_seconds = null,
    question_types = ['multiple_choice']
  } = params;

  if (!child_id) return res.status(400).json({ error: 'child_id is required' });
  if (question_count < 3 || question_count > 20) {
    return res.status(400).json({ error: 'question_count must be between 3 and 20' });
  }

  const { data: child } = await supabase
    .from('children')
    .select('id, grade, country, preferred_language, name')
    .eq('id', child_id)
    .eq('parent_id', parentId)
    .single();

  if (!child) return res.status(404).json({ error: 'Child not found' });

  const grade = child.grade;
  const country = COUNTRY_CODE_MAP[child.country] || child.country || 'UAE';
  const curriculum = CURRICULUM_MAP[country] || CURRICULUM_MAP['UAE'];
  const language = child.preferred_language || 'en';

  const typeInstructions = question_types.map(t => {
    if (t === 'multiple_choice') return 'Multiple Choice (4 options labeled A, B, C, D)';
    if (t === 'true_false') return 'True/False';
    if (t === 'short_answer') return 'Short Answer (1-3 words expected)';
    if (t === 'fill_blank') return 'Fill in the Blank';
    return t;
  }).join(', ');

  const difficultyInstr = difficulty === 'mixed'
    ? `Mix of difficulties: ~30% easy, ~50% medium, ~20% hard. Label each question's difficulty.`
    : `All questions should be ${difficulty} difficulty.`;

  const topicInstr = topic
    ? `Focus specifically on: ${topic}`
    : `Cover a range of topics appropriate for Grade ${grade} ${subject}`;

  const prompt = `You are an expert exam creator for ${subject} aligned with the ${curriculum.name}.
Grade: ${grade}
Country: ${country}
${topicInstr}

Generate exactly ${question_count} exam questions.
Question types to use: ${typeInstructions}
${difficultyInstr}

IMPORTANT RULES:
- Questions MUST be appropriate for Grade ${grade} (${curriculum.gradeMap})
- Use ${country} curriculum standards and terminology
- For math: use ${curriculum.examples}
- Each question must test a specific concept or skill
- Provide a clear, educational explanation for each correct answer
- Explanations should help the child LEARN, not just know the answer
${language === 'ar' ? '- Write ALL questions and answers in Arabic (Modern Standard Arabic)\n- Use standard numerals (1, 2, 3) not Eastern Arabic' : '- Write in clear, simple English appropriate for the grade level'}

Return a JSON array with exactly ${question_count} objects. Each object must have:
{
  "question_index": <number 1 to ${question_count}>,
  "question_text": "<the question>",
  "question_type": "<multiple_choice|true_false|short_answer|fill_blank>",
  "options": ["A) ...", "B) ...", "C) ...", "D) ..."] or null for non-MCQ,
  "correct_answer": "<the correct answer, e.g. 'B' for MCQ, 'True'/'False' for T/F, or the text for short answer>",
  "explanation": "<2-3 sentence explanation of WHY this is correct and the concept behind it>",
  "topic": "<specific topic tested, e.g. 'fractions', 'photosynthesis', 'past tense'>",
  "difficulty": "<easy|medium|hard>"
}

Return ONLY the JSON array, no other text.`;

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 4000,
    temperature: 0.8,
    response_format: { type: 'json_object' }
  });

  let questions;
  try {
    const parsed = JSON.parse(completion.choices[0].message.content);
    questions = Array.isArray(parsed) ? parsed : parsed.questions || parsed.exam || Object.values(parsed)[0];
    if (!Array.isArray(questions)) throw new Error('Not an array');
  } catch (parseErr) {
    console.error('Failed to parse exam questions:', parseErr);
    return res.status(500).json({ error: 'Failed to generate exam questions. Please try again.' });
  }

  const { data: exam, error: examErr } = await supabase
    .from('exams')
    .insert({
      parent_id: parentId, child_id, subject, grade, country,
      topic: topic || `${subject} - Grade ${grade}`,
      difficulty, question_count: questions.length, time_limit_seconds, status: 'generated'
    })
    .select()
    .single();

  if (examErr) return res.status(500).json({ error: 'Failed to save exam' });

  const questionRows = questions.map((q, i) => ({
    exam_id: exam.id, question_index: q.question_index || i + 1,
    question_text: q.question_text, question_type: q.question_type || 'multiple_choice',
    options: q.options || null, correct_answer: q.correct_answer,
    explanation: q.explanation || '', topic: q.topic || topic || subject,
    difficulty: q.difficulty || difficulty, points: 1
  }));

  const { data: savedQuestions, error: qErr } = await supabase
    .from('exam_questions')
    .insert(questionRows)
    .select('id, question_index, question_text, question_type, options, topic, difficulty, points');

  if (qErr) return res.status(500).json({ error: 'Failed to save exam questions' });

  const { data: attempt } = await supabase
    .from('exam_attempts')
    .insert({ exam_id: exam.id, child_id, status: 'in_progress' })
    .select()
    .single();

  return res.status(200).json({
    exam_id: exam.id, attempt_id: attempt?.id, subject, grade,
    topic: exam.topic, difficulty, time_limit_seconds,
    question_count: savedQuestions.length, questions: savedQuestions
  });
}

// ============================================
// ACTION: submit — Score exam answers
// ============================================
async function handleSubmit(req, res, supabase, parentId, params) {
  const { attempt_id, answers } = params;

  if (!attempt_id || !answers || !Array.isArray(answers)) {
    return res.status(400).json({ error: 'attempt_id and answers array are required' });
  }

  const { data: attempt } = await supabase
    .from('exam_attempts')
    .select('*, exams(parent_id, subject, grade, topic)')
    .eq('id', attempt_id)
    .single();

  if (!attempt) return res.status(404).json({ error: 'Attempt not found' });
  if (attempt.exams.parent_id !== parentId) return res.status(403).json({ error: 'Not authorized' });
  if (attempt.status === 'completed') return res.status(400).json({ error: 'Already submitted' });

  const { data: questions } = await supabase
    .from('exam_questions')
    .select('id, question_index, question_text, correct_answer, explanation, topic, difficulty, points')
    .eq('exam_id', attempt.exam_id)
    .order('question_index');

  if (!questions || questions.length === 0) return res.status(404).json({ error: 'No questions found' });

  const questionMap = new Map(questions.map(q => [q.id, q]));
  let score = 0, maxScore = 0;
  const topicResults = {}, results = [], answerRows = [];

  for (const ans of answers) {
    const question = questionMap.get(ans.question_id);
    if (!question) continue;

    const childAnswer = (ans.child_answer || '').trim();
    const correctAnswer = question.correct_answer.trim();

    let isCorrect = false;
    const childNorm = childAnswer.toLowerCase().replace(/[^a-z0-9\u0600-\u06FF]/g, '');
    const correctNorm = correctAnswer.toLowerCase().replace(/[^a-z0-9\u0600-\u06FF]/g, '');

    if (childNorm === correctNorm) {
      isCorrect = true;
    } else if (correctAnswer.length === 1 && childAnswer.length > 0) {
      isCorrect = childAnswer.charAt(0).toLowerCase() === correctAnswer.charAt(0).toLowerCase();
    }

    if (isCorrect) score += question.points;
    maxScore += question.points;

    const topic = question.topic || 'general';
    if (!topicResults[topic]) topicResults[topic] = { correct: 0, total: 0 };
    topicResults[topic].total++;
    if (isCorrect) topicResults[topic].correct++;

    results.push({
      question_id: question.id, question_index: question.question_index,
      question_text: question.question_text, child_answer: childAnswer,
      correct_answer: question.correct_answer, is_correct: isCorrect,
      explanation: question.explanation, topic: question.topic, difficulty: question.difficulty
    });

    answerRows.push({
      attempt_id, question_id: question.id, child_answer: childAnswer,
      is_correct: isCorrect, time_spent_seconds: ans.time_spent_seconds || null
    });
  }

  const percentage = maxScore > 0 ? Math.round((score / maxScore) * 10000) / 100 : 0;

  const weakTopics = [], strongTopics = [];
  for (const [topic, result] of Object.entries(topicResults)) {
    const pct = result.total > 0 ? result.correct / result.total : 0;
    if (pct < 0.5) weakTopics.push(topic);
    else if (pct >= 0.8) strongTopics.push(topic);
  }

  const totalTime = answers.reduce((sum, a) => sum + (a.time_spent_seconds || 0), 0);

  if (answerRows.length > 0) await supabase.from('exam_answers').insert(answerRows);

  await supabase.from('exam_attempts').update({
    completed_at: new Date().toISOString(), score, max_score: maxScore,
    percentage, time_spent_seconds: totalTime || null,
    weak_topics: weakTopics, strong_topics: strongTopics, status: 'completed'
  }).eq('id', attempt_id);

  await supabase.from('exams').update({ status: 'completed', updated_at: new Date().toISOString() }).eq('id', attempt.exam_id);

  await supabase.from('notifications').insert({
    parent_id: parentId, type: 'exam_completed',
    title: `Exam completed: ${percentage}%`,
    body: `Your child scored ${score}/${maxScore} (${percentage}%) on a ${attempt.exams.subject} exam.${weakTopics.length > 0 ? ` Weak areas: ${weakTopics.join(', ')}.` : ' Great performance!'}`,
    child_id: attempt.child_id
  });

  return res.status(200).json({
    attempt_id, score, max_score: maxScore, percentage,
    time_spent_seconds: totalTime, weak_topics: weakTopics,
    strong_topics: strongTopics, topic_breakdown: topicResults, results
  });
}

// ============================================
// ACTION: history — Exam results & analytics
// ============================================
async function handleHistory(req, res, supabase, parentId, params) {
  const { child_id, subject, limit = 20 } = params;
  if (!child_id) return res.status(400).json({ error: 'child_id is required' });

  const { data: child } = await supabase
    .from('children')
    .select('id, name, grade')
    .eq('id', child_id)
    .eq('parent_id', parentId)
    .single();

  if (!child) return res.status(404).json({ error: 'Child not found' });

  let query = supabase
    .from('exam_attempts')
    .select(`id, score, max_score, percentage, time_spent_seconds, weak_topics, strong_topics, status, started_at, completed_at, exams(id, subject, grade, topic, difficulty, question_count, country)`)
    .eq('child_id', child_id)
    .eq('status', 'completed')
    .order('completed_at', { ascending: false })
    .limit(parseInt(limit));

  const { data: attempts, error } = await query;
  if (error) return res.status(500).json({ error: 'Failed to fetch history' });

  const filtered = subject ? (attempts || []).filter(a => a.exams?.subject === subject) : (attempts || []);
  const totalExams = filtered.length;
  const avgPercentage = totalExams > 0
    ? Math.round(filtered.reduce((s, a) => s + (a.percentage || 0), 0) / totalExams * 100) / 100 : 0;

  const weakCounts = {}, strongCounts = {};
  for (const a of filtered) {
    for (const t of (a.weak_topics || [])) weakCounts[t] = (weakCounts[t] || 0) + 1;
    for (const t of (a.strong_topics || [])) strongCounts[t] = (strongCounts[t] || 0) + 1;
  }

  const topWeak = Object.entries(weakCounts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([topic, count]) => ({ topic, count }));
  const topStrong = Object.entries(strongCounts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([topic, count]) => ({ topic, count }));

  const scoreTrend = filtered.slice(0, 10).reverse().map(a => ({
    date: a.completed_at, percentage: a.percentage, subject: a.exams?.subject, topic: a.exams?.topic
  }));

  return res.status(200).json({
    child_name: child.name, child_grade: child.grade,
    total_exams: totalExams, average_percentage: avgPercentage,
    top_weak_topics: topWeak, top_strong_topics: topStrong, score_trend: scoreTrend,
    exams: filtered.map(a => ({
      attempt_id: a.id, exam_id: a.exams?.id, subject: a.exams?.subject,
      topic: a.exams?.topic, difficulty: a.exams?.difficulty,
      score: a.score, max_score: a.max_score, percentage: a.percentage,
      time_spent_seconds: a.time_spent_seconds, weak_topics: a.weak_topics,
      strong_topics: a.strong_topics, completed_at: a.completed_at
    }))
  });
}
