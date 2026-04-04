# AI Math Tutor - Separate Parent & Child Auth Implementation

## Summary
Successfully implemented a dual-authentication architecture where parents and children log in separately on different devices using separate auth mechanisms.

---

## Files Created

### 1. `/lib/child-auth.js`
Helper library for custom JWT token management.

**Key Functions:**
- `signChildToken(payload)` — Creates HMAC-SHA256 signed JWT token
- `verifyChildToken(token)` — Decodes and validates JWT signature
- `getChildOrUser(req)` — Attempts parent auth first, then child JWT auth
- `getParentId(authContext)` — Extracts parent_id from either auth type
- `getChildId(authContext)` — Extracts child_id from child auth only

**Token Structure:**
```json
{
  "child_id": "uuid",
  "parent_id": "uuid",
  "child_name": "Ahmed",
  "grade": 5,
  "language": "en",
  "exp": 1234567890
}
```

Token expires in 24 hours. Signed with `process.env.CHILD_JWT_SECRET`.

---

### 2. `/api/auth/child-login.js`
Child login endpoint. POST `/api/auth/child-login`

**Request:**
```json
{ "username": "ahmed123", "password": "pass1234" }
```

**Response:**
```json
{
  "success": true,
  "token": "eyJ...",
  "child": {
    "id": "uuid",
    "name": "Ahmed",
    "grade": 5,
    "language": "en"
  },
  "credits": 100
}
```

**Process:**
1. Calls `verify_child_login(p_username, p_password)` RPC function
2. On success, generates JWT token with 24h expiration
3. Returns token + child metadata
4. CORS enabled

---

### 3. `/api/children/set-credentials.js`
Parent endpoint to set child login credentials. POST `/api/children/set-credentials`

**Requires:** Parent Supabase auth

**Request:**
```json
{
  "child_id": "uuid",
  "username": "ahmed123",
  "password": "pass1234"
}
```

**Validation:**
- Username: 3-20 alphanumeric characters
- Password: minimum 4 characters
- Child must belong to authenticated parent

**Response:**
```json
{
  "success": true,
  "message": "Credentials set successfully",
  "username": "ahmed123"
}
```

**Process:**
1. Verifies parent is authenticated (Supabase)
2. Validates username/password format
3. Calls `set_child_password(p_child_id, p_parent_id, p_username, p_password)` RPC
4. Returns success or error

---

### 4. `/public/child-login.html`
Kid-friendly login page. Route: `/child-login`

**Features:**
- Gradient background (purple)
- Large, friendly heading: "Ready to learn?"
- Username + Password fields
- Big "Start Learning!" button
- Error messaging
- Footer link to parent login
- Playful emoji (🧮)

**Process:**
1. POST to `/api/auth/child-login` with credentials
2. Stores returned token in localStorage as `child_token`
3. Redirects to `/app`
4. Checks for existing token on page load (redirects if found)

---

### 5. `/public/app.html` (UPDATED)
Chat interface — now child-only.

**Key Changes:**
- Removed Supabase CDN script
- Removed supabase-config.js reference
- Auth: reads `child_token` from localStorage
- Parses JWT payload (base64 decode only, no client-side signature verification)
- All API calls use `Authorization: Bearer {child_token}`
- Nav shows: child name, credit count, Sign Out button
- No Dashboard link
- Auto-creates session on page load
- Welcome message: "Hi {child_name}! I'm your math buddy..."
- Sign Out: clears localStorage, redirects to `/child-login`

**JWT Decode Function:**
```javascript
function decodeToken(token) {
  const parts = token.split('.');
  const payload = JSON.parse(atob(parts[1]));
  if (payload.exp && payload.exp < Date.now() / 1000) return null;
  return payload;
}
```

---

### 6. `/public/login.html` (UPDATED)
Parent login page — now parent-only.

**Changes:**
- Title: "MathBuddy - Parent Login"
- Redirects after login to `/dashboard` (was `/app`)
- Redirects if already logged in to `/dashboard` (was `/app`)
- Footer link: "Is your child looking to log in? Go to Student Login" → `/child-login`

---

### 7. `/public/dashboard.html` (UPDATED)
Parent dashboard with child management & session transcripts.

**New Sections:**
1. **Your Children**
   - Shows each child's username (if set)
   - "Set Login Credentials" button if not set
   - "Change Login" button if already set
   - Opens modal to set/change username + password

2. **Recent Sessions (Expandable)**
   - Shows child name, grade, message count, credits used, date
   - "View" button opens read-only transcript modal
   - Transcript shows chat bubbles with timestamps
   - Different colors for child (blue) vs assistant (gray)

**New Features:**
- Removed "Tutor" link from nav (parents don't access child interface)
- Credentials modal: username/password input with validation
- Transcript modal: displays all messages read-only

**JavaScript Functions:**
- `openSetCredentialsModal(childId, childName)` — Opens/creates credentials modal
- `closeCredentialsModal()` — Closes modal
- `submitCredentials(e, childId)` — Calls `/api/children/set-credentials`
- `viewTranscript(sessionId, childName)` — Fetches & displays session messages
- `closeTranscript()` — Closes transcript modal
- `escapeHtml(text)` — HTML escaping for message content

---

## Files Updated for Dual Auth

### 1. `/api/chat.js`
**Changes:**
- Import `getChildOrUser` and `getParentId` from child-auth
- Replace `getUser(req)` with `getChildOrUser(req)`
- Extract `parentId = getParentId(authContext)`
- Use `parentId` instead of `user.id` for all operations

**Auth Flow:**
1. Try parent Supabase auth first
2. Fall back to child JWT auth
3. Extract parent_id from whichever succeeded
4. Credit operations use parent_id

---

### 2. `/api/sessions/create.js`
**Changes:**
- Import `getChildOrUser` and `getParentId` from child-auth
- Import `createServerClient` (for server-side RPC calls)
- Replace `getUser(req)` + `createAuthClient(req)` with dual-auth approach
- Use `parentId` for session creation

**Auth Flow:**
Same as chat.js — try parent first, fall back to child, extract parent_id.

---

### 3. `/api/credits/balance.js`
**Changes:**
- Import `getChildOrUser` and `getParentId` from child-auth
- Replace `getUser(req)` with dual-auth approach
- Use `parentId` for all credit/subscription queries

**Auth Flow:**
Same dual-auth pattern. Returns balance, transactions, subscription (parent only).

---

### 4. `/vercel.json`
**Change:**
```json
"rewrites": [
  { "source": "/login", "destination": "/login.html" },
  { "source": "/child-login", "destination": "/child-login.html" },
  { "source": "/app", "destination": "/app.html" },
  { "source": "/dashboard", "destination": "/dashboard.html" }
]
```

Added rewrite for `/child-login` → `/child-login.html`

---

## Environment Variables Required

In Vercel project settings, set:

```
CHILD_JWT_SECRET=<strong-random-secret-32-chars>
```

This secret signs all child JWT tokens. Use a strong random value:
```bash
openssl rand -hex 16  # Generates 32-char hex string
```

---

## Database Functions Required

The implementation assumes these Supabase functions exist:

### 1. `verify_child_login(p_username, p_password)`
**Returns:**
```json
{
  "child_id": "uuid",
  "parent_id": "uuid",
  "child_name": "Ahmed",
  "grade": 5,
  "language": "en",
  "credits": 100
}
```

Should hash-verify the password against `children.password_hash`.

### 2. `set_child_password(p_child_id, p_parent_id, p_username, p_password)`
Should:
- Verify child belongs to parent
- Hash the password (bcrypt/argon2)
- Set `children.username` and `children.password_hash`
- Handle duplicate username errors

### 3. `get_credit_balance(p_parent_id)`
Already exists — returns integer credit count.

### 4. `deduct_credit(p_parent_id, p_session_id)`
Already exists — deducts 1 credit per message.

---

## Auth Flow Diagrams

### Parent Login
```
Parent → POST /login (Supabase) → /dashboard
        ↓
   Uses Supabase JWT in Authorization header
        ↓
   All API calls use parent auth → parent_id extracted from Supabase user
```

### Child Login
```
Child → POST /api/auth/child-login → /app
  ↓
  Credentials validated via verify_child_login RPC
  ↓
  Returns custom JWT token (signed with CHILD_JWT_SECRET)
  ↓
  Stored in localStorage as child_token
  ↓
  All API calls use Authorization: Bearer {child_token}
  ↓
  parent_id extracted from JWT payload for credit operations
```

### API Dual-Auth Pattern
```
Request → getChildOrUser(req)
  ↓
  Try: getUser(req) [Supabase auth]
    ✓ Return { type: 'parent', user, ... }
  ✗ Try: verifyChildToken(token) [Custom JWT]
    ✓ Return { type: 'child', child: { parent_id, child_id, ... } }
  ✗ Return null (401 Unauthorized)
  ↓
  getParentId(authContext) → parentId
  ↓
  Use parentId for all DB operations
```

---

## Testing Checklist

- [ ] Parent can sign up/log in to `/login` → `/dashboard`
- [ ] Parent can access dashboard without child_token
- [ ] Parent can add child and set login credentials
- [ ] Child can log in to `/child-login` with username/password
- [ ] Child gets JWT token stored in localStorage
- [ ] Child redirected to `/app` after login
- [ ] Child can send messages and get AI responses
- [ ] Credits deducted from parent account when child sends message
- [ ] Child JWT expires after 24 hours (redirect to `/child-login`)
- [ ] No credits modal shown when balance = 0
- [ ] Parent can view child's session transcripts
- [ ] Transcripts show read-only messages with timestamps
- [ ] Parent can change child login credentials
- [ ] Child sign out clears localStorage and redirects to `/child-login`
- [ ] Parent sign out redirects to home page
- [ ] CORS headers present on all API endpoints
- [ ] Child JWT and Supabase JWT work independently

---

## Notes

1. **No Signature Verification on Client:** The app.html JWT decode does NOT verify the signature (for simplicity). Signature verification happens only on the server in child-auth.js.

2. **localStorage Security:** Child JWT tokens stored in localStorage are vulnerable to XSS. For production, consider:
   - Storing in httpOnly secure cookies (requires server-side session)
   - Adding additional security headers

3. **Parent-to-Child Flow:** When parent sets credentials, the RPC function must properly hash the password before storing.

4. **Message Deduction:** Credits deducted per message exchange, using parent_id from either auth context.

5. **Session Ownership:** Sessions have `parent_id`, so both parent and child can access same session (parent reads transcripts, child continues chatting).
