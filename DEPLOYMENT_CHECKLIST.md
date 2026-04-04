# Deployment Checklist

## Pre-Deployment

- [ ] All new files created successfully
- [ ] All modified files updated without errors
- [ ] No syntax errors (run `npm test` if available)
- [ ] Vercel project linked (`vercel login`)

## Configuration

- [ ] Generate `CHILD_JWT_SECRET` (32-char random)
  ```bash
  openssl rand -hex 16
  ```

- [ ] Add to Vercel Project Settings → Environment Variables:
  ```
  CHILD_JWT_SECRET=<your-secret>
  ```

- [ ] Verify existing env vars still present:
  - [ ] `SUPABASE_URL`
  - [ ] `SUPABASE_SERVICE_ROLE_KEY`
  - [ ] `SUPABASE_ANON_KEY`
  - [ ] `OPENAI_API_KEY`
  - [ ] `STRIPE_SECRET_KEY`

## Database Setup

Create these RPC functions in Supabase:

- [ ] `verify_child_login(p_username, p_password)` → JSON
  - Must return: `{ child_id, parent_id, child_name, grade, language, credits }`
  - Must validate password hash
  - Return NULL if invalid

- [ ] `set_child_password(p_child_id, p_parent_id, p_username, p_password)` → void
  - Must verify child belongs to parent
  - Must hash password (bcrypt/argon2 cost 12+)
  - Must set `username` and `password_hash` columns
  - Must enforce unique username constraint

- [ ] Verify existing functions still present:
  - [ ] `get_credit_balance(p_parent_id)`
  - [ ] `deduct_credit(p_parent_id, p_session_id)`

## Database Schema Updates

- [ ] Add columns to `children` table:
  ```sql
  ALTER TABLE children ADD COLUMN username TEXT UNIQUE;
  ALTER TABLE children ADD COLUMN password_hash TEXT;
  ```

- [ ] Create index on username for faster lookups:
  ```sql
  CREATE INDEX idx_children_username ON children(username);
  ```

## File Verification

### New Files (All Must Exist)
- [ ] `/lib/child-auth.js`
- [ ] `/api/auth/child-login.js`
- [ ] `/api/children/set-credentials.js`
- [ ] `/public/child-login.html`
- [ ] `/IMPLEMENTATION_SUMMARY.md` (documentation)
- [ ] `/SETUP_GUIDE.md` (documentation)

### Modified Files (All Must Include Updates)
- [ ] `/api/chat.js` — imports child-auth, uses getChildOrUser, uses parentId
- [ ] `/api/sessions/create.js` — imports child-auth, dual-auth support
- [ ] `/api/credits/balance.js` — imports child-auth, dual-auth support
- [ ] `/public/app.html` — no Supabase CDN, child_token auth, JWT decode
- [ ] `/public/login.html` — redirects to /dashboard, has child-login link
- [ ] `/public/dashboard.html` — child credentials modal, transcript viewer
- [ ] `/vercel.json` — includes /child-login rewrite

## Code Quality Checks

- [ ] No console errors in browser
- [ ] No TypeErrors from missing imports
- [ ] All CORS headers present:
  - [ ] `/api/auth/child-login`
  - [ ] `/api/children/set-credentials`
  - [ ] `/api/chat`
  - [ ] `/api/sessions/create`
  - [ ] `/api/credits/balance`

- [ ] No hardcoded secrets in code
- [ ] All imports use relative paths correctly
- [ ] No `require()` statements (must be ESM)

## Manual Testing Before Deployment

### Test 1: Parent Registration & Login
1. [ ] Navigate to `/login`
2. [ ] Click "Sign Up" tab
3. [ ] Create account with email/password
4. [ ] Should redirect to `/dashboard`
5. [ ] Should show 0 credits, 0 children

### Test 2: Add Child & Set Credentials
1. [ ] At `/dashboard`, navigate to "Your Children" section
2. [ ] Add a child (name, grade, language)
3. [ ] Click "Set Login Credentials" button
4. [ ] Modal appears with username/password fields
5. [ ] Submit valid credentials (username: testchild, password: test1234)
6. [ ] Credentials saved, child shows username
7. [ ] Try "Change Login" to update credentials

### Test 3: Child Login
1. [ ] Navigate to `/child-login`
2. [ ] Enter username + password set above
3. [ ] Click "Start Learning!"
4. [ ] Should redirect to `/app`
5. [ ] Should show child name + grade in nav
6. [ ] Should show credit balance

### Test 4: Child Chat
1. [ ] At `/app`, type "What is 2+2?"
2. [ ] Click "Send"
3. [ ] Should show user message, then AI response
4. [ ] Credit count should decrement by 1
5. [ ] Try multiple messages
6. [ ] Verify parent account balance decreases

### Test 5: Parent Views Transcripts
1. [ ] Log out as child
2. [ ] Log in as parent at `/login`
3. [ ] Go to `/dashboard`
4. [ ] Should see "Recent Sessions" section
5. [ ] Click "View" on a session
6. [ ] Modal shows read-only transcript
7. [ ] Messages match what child typed

### Test 6: Token Expiration
1. [ ] Get child JWT token from login response
2. [ ] Manually set token expiration to `exp: Date.now()/1000 - 10`
3. [ ] Store in localStorage as `child_token`
4. [ ] Navigate to `/app`
5. [ ] Should redirect to `/child-login` (token invalid)

### Test 7: Invalid Credentials
1. [ ] Navigate to `/child-login`
2. [ ] Enter wrong password
3. [ ] Should show error message
4. [ ] Page doesn't redirect

### Test 8: CORS Headers
1. [ ] Open browser DevTools
2. [ ] Go to `/child-login`
3. [ ] Submit login form
4. [ ] Check Network tab → Response Headers
5. [ ] Should have: `Access-Control-Allow-Origin: *`
6. [ ] Request should succeed without CORS error

## Deployment Steps

1. [ ] Commit all changes
   ```bash
   git add .
   git commit -m "feat: implement parent-child dual authentication"
   ```

2. [ ] Deploy to Vercel
   ```bash
   vercel deploy --prod
   ```

3. [ ] Verify deployment succeeded
   - [ ] No build errors in Vercel Dashboard
   - [ ] All functions deployed
   - [ ] Environment variables visible in project settings

4. [ ] Test in production
   - [ ] Parent can log in
   - [ ] Child can log in with credentials
   - [ ] Chat works
   - [ ] Credits deduct correctly
   - [ ] Parent sees transcripts

## Post-Deployment Monitoring

### First 24 Hours
- [ ] Monitor Vercel Function logs for errors
- [ ] Check Supabase RPC function errors
- [ ] Monitor credit balance changes
- [ ] Monitor session creation/chat API calls

### Check These Metrics
- [ ] Child login success rate (target: >95%)
- [ ] Chat response time (target: <2s)
- [ ] Credit deduction accuracy (target: 100%)
- [ ] Session transcript loading (target: <1s)

### Enable Alerts For
- [ ] Function execution time >5s
- [ ] Error rate >1%
- [ ] High latency (>3s)
- [ ] Failed RPC calls

## Rollback Plan

If critical issues occur:

1. [ ] Revert to previous commit
   ```bash
   git revert <commit-hash>
   git push
   ```

2. [ ] Redeploy from Vercel Dashboard
   ```
   Dashboard → Deployments → Select previous → Promote to Production
   ```

3. [ ] Notify users of temporary issue
4. [ ] Debug and fix locally
5. [ ] Redeploy when ready

## Known Limitations & Caveats

- [ ] JWT tokens in localStorage vulnerable to XSS (document in FAQ)
- [ ] No rate limiting on child-login (add if needed)
- [ ] No refresh token mechanism (24h expiration is reasonable)
- [ ] No session invalidation on logout (future enhancement)
- [ ] Transcripts not paginated (fine for <100 messages per session)

## Success Criteria

All of these must be true:

- [ ] ✓ Parents can register and log in
- [ ] ✓ Parents can manage children and set login credentials
- [ ] ✓ Children can log in with username/password
- [ ] ✓ Children see chat interface without parent data
- [ ] ✓ Chat works with child tokens
- [ ] ✓ Credits deduct from parent account
- [ ] ✓ Parent can view child session transcripts
- [ ] ✓ No CORS errors in browser console
- [ ] ✓ All API endpoints return correct responses
- [ ] ✓ Vercel deployment succeeds
- [ ] ✓ No console errors in production
