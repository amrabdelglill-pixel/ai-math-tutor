import OpenAI from 'openai';
import { createServerClient } from '../../lib/supabase.js';
import { getChildOrUser, getParentId } from '../../lib/child-auth.js';
import { CURRICULUM_MAP, COUNTRY_CODE_MAP } from '../../lib/prompts.js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * POST /api/exams/generate
 * Generates an AI-powered exam for a child based on subject, grade, topic, and difficulty.
 *
 * Body: { child_id, subject, topic?, difficulty?, question_count?, time_limit_seconds?, question_types? }
 * Returns: { exam_id, questions: [...] }
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

    const {
      child_id,
      subject = 'math',
      topic = null,
      difficulty = 'mixed',
      question_count = 10,
      time_limit_seconds = null,
      question_types = ['multiple_choice']
    } = req.body;

    if (!child_id) return res.status(400).json({ error: 'child_id is required' });
    if (question_count < 3 || question_count > 20) {
      return res.status(400).json({ error: 'question_count must be between 3 and 20' });
    }

    // Verify child belongs to parent
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

    // Build the question generation prompt
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

    // Call OpenAI to generate questions
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
      console.error('Failed to parse exam questions:', parseErr, completion.choices[0].message.content);
      return res.status(500).json({ error: 'Failed to generate exam questions. Please try again.' });
    }

    // Create the exam record
    const { data: exam, error: examErr } = await supabase
      .from('exams')
      .insert({
        parent_id: parentId,
        child_id,
        subject,
        grade,
        country,
        topic: topic || `${subject} - Grade ${grade}`,
        difficulty,
        question_count: questions.length,
        time_limit_seconds,
        status: 'generated'
      })
      .select()
      .single();

    if (examErr) {
      console.error('Exam insert error:', examErr);
      return res.status(500).json({ error: 'Failed to save exam' });
    }

    // Insert all questions
    const questionRows = questions.map((q, i) => ({
      exam_id: exam.id,
      question_index: q.question_index || i + 1,
      question_text: q.question_text,
      question_type: q.question_type || 'multiple_choice',
      options: q.options ? q.options : null,
      correct_answer: q.correct_answer,
      explanation: q.explanation || '',
      topic: q.topic || topic || subject,
      difficulty: q.difficulty || difficulty,
      points: 1
    }));

    const { data: savedQuestions, error: qErr } = await supabase
      .from('exam_questions')
      .insert(questionRows)
      .select('id, question_index, question_text, question_type, options, topic, difficulty, points');

    if (qErr) {
      console.error('Questions insert error:', qErr);
      return res.status(500).json({ error: 'Failed to save exam questions' });
    }

    // Create an attempt record (auto-start)
    const { data: attempt } = await supabase
      .from('exam_attempts')
      .insert({
        exam_id: exam.id,
        child_id,
        status: 'in_progress'
      })
      .select()
      .single();

    return res.status(200).json({
      exam_id: exam.id,
      attempt_id: attempt?.id,
      subject,
      grade,
      topic: exam.topic,
      difficulty,
      time_limit_seconds,
      question_count: savedQuestions.length,
      questions: savedQuestions // NOTE: correct_answer intentionally excluded
    });

  } catch (error) {
    console.error('Exam generate error:', error);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
}
