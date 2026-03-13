import crypto from 'crypto';
import { getUser } from './supabase.js';

const JWT_SECRET = process.env.CHILD_JWT_SECRET;

// Sign a JWT token for child
export function signChildToken(payload) {
  // Create header.payload.signature
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');

  const message = `${header}.${body}`;
  const signature = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(message)
    .digest('base64url');

  return `${message}.${signature}`;
}

// Verify and decode JWT token
export function verifyChildToken(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [header, body, signature] = parts;
    const message = `${header}.${body}`;

    // Verify signature
    const expectedSignature = crypto
      .createHmac('sha256', JWT_SECRET)
      .update(message)
      .digest('base64url');

    if (signature !== expectedSignature) return null;

    // Decode payload
    const payload = JSON.parse(
      Buffer.from(body, 'base64url').toString('utf8')
    );

    // Check expiration
    if (payload.exp && payload.exp < Date.now() / 1000) {
      return null;
    }

    return payload;
  } catch (error) {
    return null;
  }
}

// Get auth context: try parent auth first, then child auth
export async function getChildOrUser(req) {
  // Try parent Supabase auth first
  try {
    const user = await getUser(req);
    if (user) {
      return { type: 'parent', user, child: null };
    }
  } catch (error) {
    // Fall through to child auth
  }

  // Try child JWT auth
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return null;

  const payload = verifyChildToken(token);
  if (!payload) return null;

  return {
    type: 'child',
    user: null,
    child: {
      id: payload.child_id,
      parent_id: payload.parent_id,
      name: payload.child_name,
      grade: payload.grade,
      language: payload.language
    }
  };
}

// Get parent_id from either parent or child auth context
export function getParentId(authContext) {
  if (authContext.type === 'parent') {
    return authContext.user.id;
  } else if (authContext.type === 'child') {
    return authContext.child.parent_id;
  }
  return null;
}

// Get child_id from auth context (returns null for parents)
export function getChildId(authContext) {
  if (authContext.type === 'child') {
    return authContext.child.id;
  }
  return null;
}
