// ============================================
// Rate Limiter — In-memory per Vercel instance
// Sufficient for MVP abuse protection.
// For distributed rate limiting, upgrade to Upstash Redis.
// ============================================

const rateLimitStore = new Map();

// Clean expired entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore) {
    if (now - entry.windowStart > entry.windowMs * 2) {
      rateLimitStore.delete(key);
    }
  }
}, 5 * 60 * 1000);

/**
 * Check rate limit for a given key.
 * @param {string} key - Unique identifier (IP, userId, etc.)
 * @param {number} maxRequests - Max requests per window
 * @param {number} windowMs - Window duration in ms
 * @returns {{ allowed: boolean, remaining: number, resetIn: number }}
 */
export function checkRateLimit(key, maxRequests, windowMs) {
  const now = Date.now();
  let entry = rateLimitStore.get(key);

  if (!entry || now - entry.windowStart > windowMs) {
    // New window
    entry = { windowStart: now, count: 1, windowMs };
    rateLimitStore.set(key, entry);
    return { allowed: true, remaining: maxRequests - 1, resetIn: windowMs };
  }

  entry.count++;
  const remaining = Math.max(0, maxRequests - entry.count);
  const resetIn = windowMs - (now - entry.windowStart);

  if (entry.count > maxRequests) {
    return { allowed: false, remaining: 0, resetIn };
  }

  return { allowed: true, remaining, resetIn };
}

/**
 * Get client IP from Vercel request headers.
 * @param {object} req - HTTP request
 * @returns {string}
 */
export function getClientIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || req.headers['x-real-ip']
    || req.socket?.remoteAddress
    || 'unknown';
}

// Pre-configured limiters for common endpoints
export const RATE_LIMITS = {
  CHILD_LOGIN: { maxRequests: 10, windowMs: 15 * 60 * 1000 },  // 10 attempts per 15 min
  CHAT: { maxRequests: 60, windowMs: 60 * 1000 },               // 60 messages per minute
  CHECKOUT: { maxRequests: 5, windowMs: 60 * 1000 },            // 5 checkout attempts per minute
};
