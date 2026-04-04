import OpenAI from 'openai';
import { createServerClient, getUser } from '../lib/supabase.js';
import { getChildOrUser, getParentId } from '../lib/child-auth.js';
import { getSystemPrompt, checkForBlockedContent, detectStuckLoop, detectChildDistress, detectPersonalInfo, COUNTRY_CODE_MAP } from '../lib/prompts.js';
import { checkRateLimit, getClientIP, RATE_LIMITS } from '../lib/rate-limit.js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Reverse map: "UAE" -> "AE", "Egypt" -> "EG", etc.
const COUNTRY_TO_ISO = Object.fromEntries(
  Object.entries(COUNTRY_CODE_MAP).map(([iso, name]) => [name, iso])
);

/**
 * RAG: Retrieve relevant teaching examples from the knowledge base.
 * Embeds the student's question, queries Supabase pgvector for similar chunks.
 */
async function retrieveKnowledgeContext(supabase, question, { grade, country, subject }) {
  try {
    // Generate embedding for the student's question
    const embeddingRes = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: question,
      dimensions: 1536,
    });
    const queryEmbedding = embeddingRes.data[0].embedding;

    // Map country name to ISO code for knowledge base query
    const countryISO = COUNTRY_TO_ISO[country] || country;

    // Query Supabase for matching knowledge chunks
    const { data: chunks, error } = await supabase.rpc('match_knowledge_chunks', {
      query_embedding: queryEmbedding,
      match_threshold: 0.65,
      match_count: 3,
      filter_countries: [countryISO],
      filter_grades: [grade],
    });

    if (error || !chunks || chunks.length === 0) {
      // Fallback: try without country filter (broader match)
      const { data: fallbackChunks } = await supabase.rpc('match_knowledge_chunks', {
        query_embedding: queryEmbedding,
        match_threshold: 0.7,
        match_count: 3,
        filter_grades: [grade],
      });
      return fallbackChunks || [];
    }

    return chunks;
  } catch (err) {
    console.error('RAG retrieval error (non-fatal):', err.message);
    return []; // Non-fatal — chat works without RAG
  }
}

/**
 * Build a RAG context block to inject into the system prompt.
 */
function buildRAGContext(chunks) {
  if (!chunks || chunks.length === 0) return '';

  const examples = chunks
    .map((c, i) => `[Teaching Example ${i + 1} — ${c.language === 'ar' ? 'Arabic' : 'English'} source, topics: ${(c.topics || []).join(', ') || 'general'}]\n${c.text.substring(0, 800)}`)
    .join('\n\n');

  return `\n\nTEACHING REFERENCE MATERIAL (from top educational channels):
Use these real teaching examples as inspiration for HOW to explain concepts. Adapt the style and approach, but use your own words. These show how experienced teachers explain similar topics to students at this grade level.

${examples}

Remember: Use these as STYLE and APPROACH references only. Always teach step-by-step in your own words.`;
}

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // 1. Authenticate user (parent or child)
    const authContext = await getChildOrUser(req);
    if (!authContext) {
      return res.status(401).json({ error: 'Not authenticated. Please log in.' });
    }
    const parentId = getParentId(authContext);

    // Rate limit: 60 messages per minute per user
    const ip = getClientIP(req);
    const rlKey = `chat:${parentId || ip}`;
    const rl = checkRateLimit(rlKey, RATE_LIMITS.CHAT.maxRequests, RATE_LIMITS.CHAT.windowMs);
    if (!rl.allowed) {
      res.setHeader('Retry-After', Math.ceil(rl.resetIn / 1000));
      return res.status(429).json({
        error: 'Slow down! You\'re sending messages too fast. Wait a moment and try again.',
        retryAfter: Math.ceil(rl.resetIn / 1000)
      });
    }

    const { message, session_id, child_id, language: langOverride, image } = req.body;
    if (!message || !session_id || !child_id) {
      return res.status(400).json({ error: 'Missing required fields: message, session_id, child_id' });
    }

    const supabase = createServerClient();

    // 2. Check child credit limits (daily/weekly/monthly)
    const { data: childLimits } = await supabase
      .from('children')
      .select('credit_limit_daily, credit_limit_weekly, credit_limit_monthly')
      .eq('id', child_id)
      .single();

    if (childLimits && (childLimits.credit_limit_daily || childLimits.credit_limit_weekly || childLimits.credit_limit_monthly)) {
      const { data: limitSummary } = await supabase.rpc('get_child_limits_summary', { p_child_id: child_id });
      if (limitSummary) {
        const exceeded =
          (limitSummary.daily?.exceeded) ||
          (limitSummary.weekly?.exceeded) ||
          (limitSummary.monthly?.exceeded);
        if (exceeded) {
          const reason = limitSummary.daily?.exceeded ? 'daily'
            : limitSummary.weekly?.exceeded ? 'weekly' : 'monthly';
          return res.status(429).json({
            error: 'Credit limit reached',
            message: `You've reached your ${reason} learning limit! Take a break and come back later.`,
            credits_remaining: await getBalance(supabase, parentId),
            limit_exceeded: reason
          });
        }
      }
    }

    // 3. Check for blocked content (prompt injection, off-topic)
    const contentCheck = checkForBlockedContent(message);
    if (contentCheck.blocked) {
      await supabase.from('messages').insert([
        { session_id, role: 'user', content: message, flagged: true, flag_reason: contentCheck.reason },
        { session_id, role: 'assistant', content: contentCheck.safeResponse }
      ]);
      return res.status(200).json({
        response: contentCheck.safeResponse,
        credits_remaining: await getBalance(supabase, parentId),
        flagged: true
      });
    }

    // 3b. Check for child distress signals
    const distressCheck = detectChildDistress(message);
    if (distressCheck.detected) {
      // Flag the message and notify parent immediately
      await supabase.from('notifications').insert({
        parent_id: parentId,
        type: 'child_distress',
        title: `${child_id ? 'Your child' : 'A child'} may need support`,
        body: 'Your child expressed something in their tutoring session that may need your attention. Please review the session.',
        session_id
      });
    }

    // 3c. Check for personal information sharing
    const piCheck = detectPersonalInfo(message);
    if (piCheck.detected) {
      await supabase.from('notifications').insert({
        parent_id: parentId,
        type: 'personal_info_shared',
        title: 'Personal information detected',
        body: 'Your child may have shared personal information during a tutoring session. Please review.',
        session_id
      });
    }

    // 4. Check credit balance
    const balance = await getBalance(supabase, parentId);
    if (balance <= 0) {
      return res.status(402).json({
        error: 'No credits remaining',
        message: "You've used all your credits! Ask your parent to get more so we can keep learning together.",
        credits_remaining: 0
      });
    }

    // 5. Get session info (grade, history, country)
    const { data: session } = await supabase
      .from('sessions')
      .select('*, children(grade, preferred_language, name, country)')
      .eq('id', session_id)
      .eq('parent_id', parentId)
      .single();

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const grade = session.children?.grade || 5;
    const language = langOverride || session.children?.preferred_language || 'en';
    const country = session.children?.country || 'UAE';

    // 6. Get conversation history
    const { data: history } = await supabase
      .from('messages')
      .select('role, content')
      .eq('session_id', session_id)
      .order('created_at', { ascending: true })
      .limit(20);

    // 7. Check for stuck loop
    const isStuck = detectStuckLoop(history || []);
    if (isStuck) {
      await supabase.from('notifications').insert({
        parent_id: parentId,
        type: 'stuck_loop',
        title: `${session.children?.name || 'Your child'} seems stuck`,
        body: `They've been working on a problem for a while and might need some help. Session topic: ${session.topic || 'Math practice'}`,
        session_id
      });
      await supabase.from('sessions')
        .update({ status: 'stuck_loop' })
        .eq('id', session_id);
    }

    // 8. RAG: Retrieve relevant teaching examples from knowledge base
    const subject = session.subject || 'math'; // default to math
    const ragChunks = await retrieveKnowledgeContext(supabase, message, {
      grade,
      country: COUNTRY_CODE_MAP[country] ? country : (COUNTRY_TO_ISO[country] || country),
      subject,
    });
    const ragContext = buildRAGContext(ragChunks);

    // 9. Build messages for OpenAI
    let userContent;
    if (image) {
      // Vision request with image
      userContent = [
        { type: 'text', text: message },
        { type: 'image_url', image_url: { url: image, detail: 'low' } }
      ];
    } else {
      userContent = message;
    }

    const systemPrompt = getSystemPrompt(grade, language, country, subject) + ragContext;

    const messages = [
      { role: 'system', content: systemPrompt },
      ...(history || []).map(m => ({ role: m.role, content: m.content })),
      { role: 'user', content: userContent }
    ];

    // 10. Call OpenAI
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages,
      max_tokens: 1200,
      temperature: 0.7,
    });

    const aiResponse = completion.choices[0].message.content;
    const tokensUsed = completion.usage?.total_tokens || 0;
    const cleanResponse = aiResponse
      .replace('[STUCK_LOOP]', '')
      .replace('[CHILD_DISTRESS]', '')
      .replace('[PERSONAL_INFO]', '')
      .replace('[OFF_TOPIC_REPEAT]', '')
      .trim();

    // 11. Deduct credit — 1 credit per 5 text msgs, 1 per 2 image msgs
    const msgsPerCredit = image ? 2 : 5;
    const { count: msgCount } = await supabase
      .from('messages')
      .select('*', { count: 'exact', head: true })
      .eq('session_id', session_id)
      .eq('role', 'user');

    let newBalance = await getBalance(supabase, parentId);
    if ((msgCount || 0) % msgsPerCredit === 0) {
      const { data: bal } = await supabase.rpc('deduct_credit', {
        p_parent_id: parentId,
        p_session_id: session_id
      });
      newBalance = bal;
    }

    // 12. Save messages
    await supabase.from('messages').insert([
      { session_id, role: 'user', content: message },
      { session_id, role: 'assistant', content: cleanResponse, tokens_used: tokensUsed }
    ]);

    // 13. Low credit notification
    if (newBalance !== null && newBalance <= 5 && newBalance > 0) {
      await supabase.from('notifications').insert({
        parent_id: parentId,
        type: 'credits_low',
        title: 'Credits running low',
        body: `You have ${newBalance} credits remaining. Top up to keep the learning going!`
      });
    }

    return res.status(200).json({
      response: cleanResponse,
      credits_remaining: newBalance,
      session_id,
      is_stuck: isStuck
    });

  } catch (error) {
    console.error('Chat error:', error);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
}

async function getBalance(supabase, parentId) {
  const { data } = await supabase.rpc('get_valid_credit_balance', { p_parent_id: parentId });
  return data || 0;
}

