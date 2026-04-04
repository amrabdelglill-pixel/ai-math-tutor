# Setup Guide: Parent & Child Dual Authentication

## Quick Start

### 1. Set Environment Variable

In Vercel project settings, add:

```
CHILD_JWT_SECRET=<your-32-char-random-secret>
```

Generate a secure secret:
```bash
openssl rand -hex 16
```

### 2. Deploy Changes

```bash
vercel deploy
```

All new files and modifications will be deployed automatically.

### 3. Verify Database Functions

Ensure these Supabase RPC functions exist:

#### `verify_child_login(p_username, p_password)`
```sql
CREATE OR REPLACE FUNCTION public.verify_child_login(
  p_username TEXT,
  p_password TEXT
)
RETURNS JSON AS $$
BEGIN
  -- Query children table, verify password hash
  -- Return: { child_id, parent_id, child_name, grade, language, credits }
  -- Or NULL if invalid
END;
$$ LANGUAGE plpgsql;
```

#### `set_child_password(p_child_id, p_parent_id, p_username, p_password)`
```sql
CREATE OR REPLACE FUNCTION public.set_child_password(
  p_child_id UUID,
  p_parent_id UUID,
  p_username TEXT,
  p_password TEXT
)
RETURNS void AS $$
BEGIN
  -- Verify child belongs to parent
  -- Hash password (bcrypt/argon2)
  -- Update children table: username, password_hash
END;
$$ LANGUAGE plpgsql;
```

---

## User Flows

### Parent Setup

1. Parent goes to `/login`
2. Signs in with email + password (Supabase auth)
3. Redirected to `/dashboard`
4. Adds child and sets login credentials
5. Receives username + password to give to child

### Child Login

1. Child goes to `/child-login`
2. Enters username + password (set by parent)
3. System validates via `verify_child_login` RPC
4. Returns JWT token with 24h expiration
5. Stored in localStorage as `child_token`
6. Redirected to `/app` (chat interface)

### During Chat Session

1. Child's messages sent with `Authorization: Bearer {child_token}`
2. `/api/chat` receives request
3. `getChildOrUser()` validates JWT signature
4. Extracts parent_id from JWT payload
5. Deducts credit from parent account
6. Returns response to child

### Parent View Sessions

1. Parent at `/dashboard`
2. Click "View" on any session
3. Modal shows read-only chat transcript
4. Can update child's login credentials
5. Can start/stop tutoring from dashboard

---

## Testing Without Vercel

### Local Development

```bash
vercel dev
```

This starts a local development server with all API routes.

### Manual Testing

#### Test Child Login
```bash
curl -X POST http://localhost:3000/api/auth/child-login \
  -H "Content-Type: application/json" \
  -d '{"username":"ahmed123","password":"pass1234"}'
```

Expected response:
```json
{
  "success": true,
  "token": "eyJ...",
  "child": { "id": "...", "name": "Ahmed", "grade": 5, "language": "en" },
  "credits": 100
}
```

#### Test Child Chat (with returned token)
```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer {token_from_above}" \
  -d '{
    "message": "What is 2+2?",
    "session_id": "xxx",
    "child_id": "yyy"
  }'
```

#### Test Parent Set Credentials
```bash
curl -X POST http://localhost:3000/api/children/set-credentials \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer {parent_supabase_token}" \
  -d '{
    "child_id": "xxx",
    "username": "ahmed123",
    "password": "pass1234"
  }'
```

---

## File Structure

```
ai-math-tutor/
├── lib/
│   ├── child-auth.js          # NEW: JWT token functions
│   ├── supabase.js            # Parent auth helper (existing)
│   └── prompts.js             # AI prompts (existing)
├── api/
│   ├── auth/
│   │   └── child-login.js     # NEW: Child login endpoint
│   ├── chat.js                # UPDATED: Dual-auth support
│   ├── credits/
│   │   └── balance.js         # UPDATED: Dual-auth support
│   ├── sessions/
│   │   ├── create.js          # UPDATED: Dual-auth support
│   │   └── history.js         # Parent reads transcripts (existing)
│   ├── children/
│   │   ├── list.js            # Parent management (existing)
│   │   └── set-credentials.js # NEW: Set child login
│   └── ...other endpoints
├── public/
│   ├── child-login.html       # NEW: Kid-friendly login
│   ├── login.html             # UPDATED: Parent-only, link to child-login
│   ├── app.html               # UPDATED: Child-only, child token auth
│   ├── dashboard.html         # UPDATED: Credentials + transcripts
│   ├── index.html             # Home (existing)
│   ├── css/
│   │   └── styles.css         # Styling (existing)
│   └── js/
│       └── supabase-config.js # Parent auth config (existing)
├── vercel.json                # UPDATED: Added /child-login rewrite
└── package.json               # Dependencies (existing)
```

---

## Security Notes

### Production Considerations

1. **JWT Storage:** Child tokens stored in localStorage are vulnerable to XSS. Consider:
   - Use httpOnly secure cookies (requires backend sessions)
   - Add CSP headers to prevent XSS
   - Implement rate limiting on child-login endpoint

2. **Password Security:** Parent's `set_child_password` RPC should:
   - Use bcrypt or Argon2 hashing (cost 12+)
   - Never store plain-text passwords
   - Validate username uniqueness at database level

3. **Rate Limiting:** Add rate limiting to:
   - `/api/auth/child-login` (brute force protection)
   - `/api/chat` (cost control)

4. **Token Rotation:** Consider:
   - Refresh tokens (separate from access token)
   - Token blacklist on logout
   - Shorter expiration for sensitive operations

### Current Implementation

- ✓ HMAC-SHA256 token signing
- ✓ 24-hour expiration check
- ✓ Username/password validation
- ✓ Parent ownership verification
- ✓ CORS headers present
- ✗ No rate limiting (add middleware)
- ✗ No refresh tokens (24h is reasonable for tutoring)

---

## Troubleshooting

### Child can't log in
1. Check `verify_child_login` RPC exists and has correct signature
2. Verify username/password stored correctly in database
3. Check `CHILD_JWT_SECRET` is set in Vercel
4. Look for errors in Vercel Function logs

### Credit deduction not working
1. Check parent_id extracted correctly from JWT
2. Verify `get_credit_balance` and `deduct_credit` RPCs exist
3. Check parent has credits (try balance endpoint)

### Transcript showing empty
1. Ensure `messages` table exists and has messages
2. Check session_id is correct
3. Try `/api/sessions/history?session_id=xxx` directly

### Parent can't set credentials
1. Verify parent is authenticated (Supabase token valid)
2. Check child_id belongs to parent
3. Verify `set_child_password` RPC exists
4. Check username is unique (duplicate error)

---

## What's Next

1. **Email Notifications:** Notify parent when child starts/completes session
2. **Session Recording:** Detailed activity logs for parent monitoring
3. **Time Limits:** Set daily tutoring time limits per child
4. **Progress Tracking:** Dashboard showing skill progression
5. **Offline Mode:** Allow children to compose messages offline
