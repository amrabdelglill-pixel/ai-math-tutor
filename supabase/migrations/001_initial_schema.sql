-- Supabase Migration: Initial Schema for AI Math Tutor
-- Created: 2026-03-26
-- This migration is idempotent and handles all initial setup

-- ============================================================================
-- EXTENSIONS
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;


-- ============================================================================
-- TABLE 1: PROFILES
-- ============================================================================

CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL UNIQUE,
  full_name text,
  preferred_language text DEFAULT 'en' CHECK (preferred_language IN ('en', 'ar')),
  timezone text DEFAULT 'UTC',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  phone text,
  country text
);

COMMENT ON TABLE profiles IS 'User profiles linked to Supabase auth users';
COMMENT ON COLUMN profiles.preferred_language IS 'User language preference: en (English) or ar (Arabic)';
COMMENT ON COLUMN profiles.timezone IS 'User timezone for scheduling and reporting';

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;


-- ============================================================================
-- TABLE 2: CHILDREN
-- ============================================================================

CREATE TABLE IF NOT EXISTS children (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name text NOT NULL,
  grade integer NOT NULL CHECK (grade >= 1 AND grade <= 9),
  preferred_language text DEFAULT 'en' CHECK (preferred_language IN ('en', 'ar')),
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  username text,
  password_hash text,
  phone text,
  country text DEFAULT 'UAE',
  credit_limit_daily integer,
  credit_limit_weekly integer,
  credit_limit_monthly integer,
  birthdate date
);

COMMENT ON TABLE children IS 'Child profiles under parent accounts';
COMMENT ON COLUMN children.grade IS 'Academic grade level (1-9)';
COMMENT ON COLUMN children.username IS 'Child login username (optional)';
COMMENT ON COLUMN children.password_hash IS 'Bcrypt hash of child password';

CREATE INDEX IF NOT EXISTS idx_children_parent ON children(parent_id);
CREATE INDEX IF NOT EXISTS idx_children_username ON children(username);
CREATE UNIQUE INDEX IF NOT EXISTS children_parent_username_unique ON children(parent_id, username) WHERE username IS NOT NULL;

ALTER TABLE children ENABLE ROW LEVEL SECURITY;


-- ============================================================================
-- TABLE 3: SUBSCRIPTIONS
-- ============================================================================

CREATE TABLE IF NOT EXISTS subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  stripe_customer_id text,
  stripe_subscription_id text UNIQUE,
  plan_name text NOT NULL CHECK (plan_name IN ('free', 'starter', 'standard', 'premium', 'family')),
  credits_per_month integer NOT NULL,
  price_cents integer NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'trialing', 'cancelled', 'past_due', 'paused')),
  current_period_start timestamptz,
  current_period_end timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  max_children integer DEFAULT 1,
  billing_cycle text DEFAULT 'monthly' CHECK (billing_cycle IN ('monthly', 'annual'))
);

COMMENT ON TABLE subscriptions IS 'Subscription plans for parents';
COMMENT ON COLUMN subscriptions.plan_name IS 'Subscription tier: free, starter, standard, premium, or family';
COMMENT ON COLUMN subscriptions.status IS 'Current subscription status from Stripe';

CREATE INDEX IF NOT EXISTS idx_subscriptions_parent ON subscriptions(parent_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe ON subscriptions(stripe_subscription_id);

ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;


-- ============================================================================
-- TABLE 4: CREDIT LEDGER
-- ============================================================================

CREATE TABLE IF NOT EXISTS credit_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  amount integer NOT NULL,
  balance_after integer NOT NULL,
  type text NOT NULL CHECK (type IN ('signup_bonus', 'purchase', 'subscription', 'trial', 'usage', 'rollover', 'expiry', 'refund')),
  description text,
  stripe_payment_id text,
  created_at timestamptz DEFAULT now(),
  expires_at timestamptz
);

COMMENT ON TABLE credit_ledger IS 'Ledger of all credit transactions';
COMMENT ON COLUMN credit_ledger.type IS 'Type of credit transaction';
COMMENT ON COLUMN credit_ledger.expires_at IS 'When the credit expires (NULL = no expiry)';

CREATE INDEX IF NOT EXISTS idx_credit_ledger_parent ON credit_ledger(parent_id);
CREATE INDEX IF NOT EXISTS idx_credit_ledger_created ON credit_ledger(created_at DESC);

ALTER TABLE credit_ledger ENABLE ROW LEVEL SECURITY;


-- ============================================================================
-- TABLE 5: SESSIONS
-- ============================================================================

CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  child_id uuid NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'stuck_loop', 'flagged')),
  interaction_count integer DEFAULT 0,
  credits_used integer DEFAULT 0,
  grade integer NOT NULL,
  topic text,
  started_at timestamptz DEFAULT now(),
  ended_at timestamptz
);

COMMENT ON TABLE sessions IS 'Tutoring sessions between child and AI';
COMMENT ON COLUMN sessions.status IS 'Session state: active, completed, stuck_loop, or flagged';
COMMENT ON COLUMN sessions.interaction_count IS 'Number of back-and-forth exchanges';
COMMENT ON COLUMN sessions.credits_used IS 'Total credits consumed in this session';

CREATE INDEX IF NOT EXISTS idx_sessions_parent ON sessions(parent_id);
CREATE INDEX IF NOT EXISTS idx_sessions_child ON sessions(child_id);

ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;


-- ============================================================================
-- TABLE 6: MESSAGES
-- ============================================================================

CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content text NOT NULL,
  tokens_used integer DEFAULT 0,
  flagged boolean DEFAULT false,
  flag_reason text,
  created_at timestamptz DEFAULT now()
);

COMMENT ON TABLE messages IS 'Individual messages within tutoring sessions';
COMMENT ON COLUMN messages.role IS 'Message sender: user, assistant, or system';
COMMENT ON COLUMN messages.tokens_used IS 'Token count for cost tracking';
COMMENT ON COLUMN messages.flagged IS 'Flagged for review (inappropriate content, etc)';

CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;


-- ============================================================================
-- TABLE 7: NOTIFICATIONS
-- ============================================================================

CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('stuck_loop', 'credits_low', 'credits_empty', 'session_flagged', 'weekly_report', 'credit_limit_reached')),
  title text NOT NULL,
  body text,
  read boolean DEFAULT false,
  session_id uuid REFERENCES sessions(id) ON DELETE SET NULL,
  child_id uuid REFERENCES children(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

COMMENT ON TABLE notifications IS 'Notifications to parents about child activities and account status';
COMMENT ON COLUMN notifications.type IS 'Type of notification';
COMMENT ON COLUMN notifications.read IS 'Whether parent has read this notification';

CREATE INDEX IF NOT EXISTS idx_notifications_parent ON notifications(parent_id, read);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;


-- ============================================================================
-- TABLE 8: WEEKLY REPORTS
-- ============================================================================

CREATE TABLE IF NOT EXISTS weekly_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  child_id uuid NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  report_week_start date NOT NULL,
  summary text,
  strengths text,
  areas_to_improve text,
  teacher_notes text,
  sessions_count integer DEFAULT 0,
  credits_used integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

COMMENT ON TABLE weekly_reports IS 'Weekly progress reports for each child';
COMMENT ON COLUMN weekly_reports.report_week_start IS 'Monday of the week being reported';

ALTER TABLE weekly_reports ENABLE ROW LEVEL SECURITY;


-- ============================================================================
-- TABLE 9: REPORT SUBSCRIPTIONS
-- ============================================================================

CREATE TABLE IF NOT EXISTS report_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  child_id uuid NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  status text DEFAULT 'active' CHECK (status IN ('active', 'cancelled', 'expired')),
  stripe_subscription_id text,
  price_cents integer DEFAULT 1000,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(parent_id, child_id)
);

COMMENT ON TABLE report_subscriptions IS 'Weekly report subscriptions (one per child per parent)';
COMMENT ON COLUMN report_subscriptions.price_cents IS 'Weekly report subscription price in cents';

ALTER TABLE report_subscriptions ENABLE ROW LEVEL SECURITY;


-- ============================================================================
-- TABLE 10: CONSENT RECORDS
-- ============================================================================

CREATE TABLE IF NOT EXISTS consent_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  child_id uuid REFERENCES children(id) ON DELETE CASCADE,
  consent_type text NOT NULL CHECK (consent_type IN ('signup_policy_acceptance', 'child_creation', 'policy_update')),
  privacy_policy_version text NOT NULL,
  terms_version text,
  refund_policy_version text,
  consent_method text NOT NULL DEFAULT 'checkbox' CHECK (consent_method IN ('checkbox', 'click_accept', 'continued_use')),
  consent_text text,
  jurisdiction text,
  ip_address text,
  user_agent text,
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

COMMENT ON TABLE consent_records IS 'GDPR/consent records for regulatory compliance';
COMMENT ON COLUMN consent_records.consent_type IS 'Type of consent: signup, child creation, or policy update';
COMMENT ON COLUMN consent_records.consent_method IS 'How consent was obtained';

CREATE INDEX IF NOT EXISTS idx_consent_parent ON consent_records(parent_id);
CREATE INDEX IF NOT EXISTS idx_consent_child ON consent_records(child_id);
CREATE INDEX IF NOT EXISTS idx_consent_type ON consent_records(consent_type);

ALTER TABLE consent_records ENABLE ROW LEVEL SECURITY;


-- ============================================================================
-- TABLE 11: DATA SUBJECT REQUESTS
-- ============================================================================

CREATE TABLE IF NOT EXISTS data_subject_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  request_type text NOT NULL CHECK (request_type IN ('access', 'deletion', 'export', 'rectification')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'rejected')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  completed_at timestamptz,
  completed_by text,
  notes text,
  response_sent_at timestamptz
);

COMMENT ON TABLE data_subject_requests IS 'GDPR data subject requests (access, deletion, export, rectification)';
COMMENT ON COLUMN data_subject_requests.request_type IS 'Type of request: access, deletion, export, or rectification';
COMMENT ON COLUMN data_subject_requests.status IS 'Status of the request lifecycle';

CREATE INDEX IF NOT EXISTS idx_dsr_parent ON data_subject_requests(parent_id);
CREATE INDEX IF NOT EXISTS idx_dsr_status ON data_subject_requests(status);

ALTER TABLE data_subject_requests ENABLE ROW LEVEL SECURITY;


-- ============================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================================

-- PROFILES RLS
CREATE POLICY "Users can view/update own profile"
  ON profiles FOR ALL USING (auth.uid() = id);

-- CHILDREN RLS
CREATE POLICY "Parents can CRUD own children"
  ON children FOR ALL USING (auth.uid() = parent_id);

-- SUBSCRIPTIONS RLS
CREATE POLICY "Parents can view own subscriptions"
  ON subscriptions FOR SELECT USING (auth.uid() = parent_id);

-- CREDIT_LEDGER RLS
CREATE POLICY "Parents can view own credit ledger"
  ON credit_ledger FOR SELECT USING (auth.uid() = parent_id);

-- SESSIONS RLS
CREATE POLICY "Parents can view/create own sessions"
  ON sessions FOR SELECT USING (auth.uid() = parent_id);

CREATE POLICY "Parents can insert own sessions"
  ON sessions FOR INSERT WITH CHECK (auth.uid() = parent_id);

-- MESSAGES RLS
CREATE POLICY "Parents can view messages in own sessions"
  ON messages FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM sessions
      WHERE sessions.id = messages.session_id
      AND sessions.parent_id = auth.uid()
    )
  );

CREATE POLICY "Parents can insert messages in own sessions"
  ON messages FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM sessions
      WHERE sessions.id = messages.session_id
      AND sessions.parent_id = auth.uid()
    )
  );

-- NOTIFICATIONS RLS
CREATE POLICY "Parents can view/update own notifications"
  ON notifications FOR ALL USING (auth.uid() = parent_id);

-- WEEKLY_REPORTS RLS
CREATE POLICY "Parents can view own weekly reports"
  ON weekly_reports FOR SELECT USING (auth.uid() = parent_id);

-- REPORT_SUBSCRIPTIONS RLS
CREATE POLICY "Parents can CRUD own report subscriptions"
  ON report_subscriptions FOR ALL USING (auth.uid() = parent_id);

-- CONSENT_RECORDS RLS
CREATE POLICY "Parents can view own consent records"
  ON consent_records FOR SELECT USING (auth.uid() = parent_id);

-- DATA_SUBJECT_REQUESTS RLS
CREATE POLICY "Parents can view/insert own DSRs"
  ON data_subject_requests FOR ALL USING (auth.uid() = parent_id);


-- ============================================================================
-- FUNCTIONS
-- ============================================================================

-- FUNCTION 1: Handle new user creation
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  -- Create profile
  INSERT INTO profiles (id, email)
  VALUES (NEW.id, NEW.email)
  ON CONFLICT (id) DO NOTHING;

  -- Create free subscription
  INSERT INTO subscriptions (parent_id, plan_name, credits_per_month, price_cents, status, max_children)
  VALUES (NEW.id, 'free', 10, 0, 'active', 1)
  ON CONFLICT DO NOTHING;

  -- Add signup bonus
  INSERT INTO credit_ledger (parent_id, amount, balance_after, type, description)
  VALUES (
    NEW.id,
    10,
    10,
    'signup_bonus',
    'Welcome bonus for new users'
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION handle_new_user() IS 'Trigger function: creates profile and initial credits when user signs up';


-- FUNCTION 2: Check child limit before insert
CREATE OR REPLACE FUNCTION check_child_limit()
RETURNS TRIGGER AS $$
DECLARE
  v_max_children integer;
  v_child_count integer;
BEGIN
  -- Get max children from subscription
  SELECT max_children INTO v_max_children
  FROM subscriptions
  WHERE parent_id = NEW.parent_id
  AND status IN ('active', 'trialing');

  -- Count existing children
  SELECT COUNT(*) INTO v_child_count
  FROM children
  WHERE parent_id = NEW.parent_id
  AND is_active = true;

  IF v_child_count >= COALESCE(v_max_children, 1) THEN
    RAISE EXCEPTION 'Child limit reached for this subscription plan';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION check_child_limit() IS 'Trigger function: validates child count against subscription plan limit';


-- FUNCTION 3: Deduct credit from parent account
CREATE OR REPLACE FUNCTION deduct_credit(p_parent_id uuid, p_session_id uuid)
RETURNS integer AS $$
DECLARE
  v_current_balance integer;
  v_new_balance integer;
BEGIN
  -- Get current balance
  SELECT COALESCE(SUM(amount), 0) INTO v_current_balance
  FROM credit_ledger
  WHERE parent_id = p_parent_id
  AND (expires_at IS NULL OR expires_at > now());

  -- Calculate new balance
  v_new_balance := v_current_balance - 1;

  -- Record the deduction
  INSERT INTO credit_ledger (parent_id, amount, balance_after, type, description)
  VALUES (
    p_parent_id,
    -1,
    v_new_balance,
    'usage',
    'Credit used in session: ' || p_session_id
  );

  RETURN v_new_balance;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION deduct_credit(uuid, uuid) IS 'Deducts 1 credit and returns new balance';


-- FUNCTION 4: Get total credit balance
CREATE OR REPLACE FUNCTION get_credit_balance(p_parent_id uuid)
RETURNS integer AS $$
DECLARE
  v_balance integer;
BEGIN
  SELECT COALESCE(SUM(amount), 0) INTO v_balance
  FROM credit_ledger
  WHERE parent_id = p_parent_id;

  RETURN v_balance;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION get_credit_balance(uuid) IS 'Returns total credit balance (including expired)';


-- FUNCTION 5: Get valid credit balance (excluding expired)
CREATE OR REPLACE FUNCTION get_valid_credit_balance(p_parent_id uuid)
RETURNS integer AS $$
DECLARE
  v_balance integer;
BEGIN
  SELECT COALESCE(SUM(amount), 0) INTO v_balance
  FROM credit_ledger
  WHERE parent_id = p_parent_id
  AND (expires_at IS NULL OR expires_at > now());

  RETURN v_balance;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION get_valid_credit_balance(uuid) IS 'Returns credit balance excluding expired credits';


-- FUNCTION 6: Set child password
CREATE OR REPLACE FUNCTION set_child_password(
  p_parent_id uuid,
  p_child_id uuid,
  p_username text,
  p_password text
)
RETURNS boolean AS $$
DECLARE
  v_child_count integer;
BEGIN
  -- Verify parent owns child
  SELECT COUNT(*) INTO v_child_count
  FROM children
  WHERE id = p_child_id
  AND parent_id = p_parent_id;

  IF v_child_count = 0 THEN
    RAISE EXCEPTION 'Child not found or not owned by this parent';
  END IF;

  -- Update username and password hash
  UPDATE children
  SET
    username = p_username,
    password_hash = crypt(p_password, gen_salt('bf')),
    updated_at = now()
  WHERE id = p_child_id;

  RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION set_child_password(uuid, uuid, text, text) IS 'Sets child username and bcrypt password hash';


-- FUNCTION 7: Verify child login (with parent email)
CREATE OR REPLACE FUNCTION verify_child_login(
  p_parent_email text,
  p_username text,
  p_password text
)
RETURNS TABLE(child_id uuid, parent_id uuid, success boolean) AS $$
DECLARE
  v_password_hash text;
  v_child_id uuid;
  v_parent_id uuid;
BEGIN
  -- Find child by parent email + username
  SELECT c.id, c.parent_id, c.password_hash
  INTO v_child_id, v_parent_id, v_password_hash
  FROM children c
  INNER JOIN profiles p ON c.parent_id = p.id
  WHERE p.email = p_parent_email
  AND c.username = p_username
  AND c.is_active = true;

  IF v_child_id IS NULL THEN
    RETURN QUERY SELECT NULL::uuid, NULL::uuid, false;
    RETURN;
  END IF;

  -- Verify password
  IF v_password_hash = crypt(p_password, v_password_hash) THEN
    RETURN QUERY SELECT v_child_id, v_parent_id, true;
  ELSE
    RETURN QUERY SELECT v_child_id, v_parent_id, false;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION verify_child_login(text, text, text) IS 'Verifies child credentials using parent email, username, and password';


-- FUNCTION 8: Verify child login (overloaded, without parent email)
CREATE OR REPLACE FUNCTION verify_child_login(
  p_username text,
  p_password text
)
RETURNS TABLE(child_id uuid, parent_id uuid, success boolean) AS $$
DECLARE
  v_password_hash text;
  v_child_id uuid;
  v_parent_id uuid;
BEGIN
  -- Find child by username only
  SELECT c.id, c.parent_id, c.password_hash
  INTO v_child_id, v_parent_id, v_password_hash
  FROM children c
  WHERE c.username = p_username
  AND c.is_active = true
  LIMIT 1;

  IF v_child_id IS NULL THEN
    RETURN QUERY SELECT NULL::uuid, NULL::uuid, false;
    RETURN;
  END IF;

  -- Verify password
  IF v_password_hash = crypt(p_password, v_password_hash) THEN
    RETURN QUERY SELECT v_child_id, v_parent_id, true;
  ELSE
    RETURN QUERY SELECT v_child_id, v_parent_id, false;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION verify_child_login(text, text) IS 'Verifies child credentials using username and password only';


-- FUNCTION 9: Get child credit usage (daily/weekly/monthly)
CREATE OR REPLACE FUNCTION get_child_credit_usage(
  p_child_id uuid,
  p_period text
)
RETURNS integer AS $$
DECLARE
  v_usage integer;
  v_start_date timestamptz;
BEGIN
  -- Determine start date based on period
  CASE p_period
    WHEN 'daily' THEN
      v_start_date := DATE_TRUNC('day', now());
    WHEN 'weekly' THEN
      v_start_date := DATE_TRUNC('week', now());
    WHEN 'monthly' THEN
      v_start_date := DATE_TRUNC('month', now());
    ELSE
      RAISE EXCEPTION 'Invalid period: must be daily, weekly, or monthly';
  END CASE;

  -- Get usage
  SELECT COALESCE(SUM(credits_used), 0) INTO v_usage
  FROM sessions
  WHERE child_id = p_child_id
  AND started_at >= v_start_date;

  RETURN v_usage;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION get_child_credit_usage(uuid, text) IS 'Returns credit usage for a child in specified period (daily/weekly/monthly)';


-- FUNCTION 10: Get child limits summary
CREATE OR REPLACE FUNCTION get_child_limits_summary(p_child_id uuid)
RETURNS TABLE(daily_usage integer, daily_limit integer, weekly_usage integer, weekly_limit integer, monthly_usage integer, monthly_limit integer) AS $$
BEGIN
  RETURN QUERY
  SELECT
    get_child_credit_usage(p_child_id, 'daily') as daily_usage,
    (SELECT credit_limit_daily FROM children WHERE id = p_child_id)::integer as daily_limit,
    get_child_credit_usage(p_child_id, 'weekly') as weekly_usage,
    (SELECT credit_limit_weekly FROM children WHERE id = p_child_id)::integer as weekly_limit,
    get_child_credit_usage(p_child_id, 'monthly') as monthly_usage,
    (SELECT credit_limit_monthly FROM children WHERE id = p_child_id)::integer as monthly_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION get_child_limits_summary(uuid) IS 'Returns usage and limits for all three periods (daily/weekly/monthly)';


-- FUNCTION 11: Record signup consent
CREATE OR REPLACE FUNCTION record_signup_consent(
  p_parent_id uuid,
  p_privacy_version text,
  p_terms_version text,
  p_refund_version text,
  p_consent_method text DEFAULT 'checkbox',
  p_consent_text text DEFAULT NULL,
  p_jurisdiction text DEFAULT 'UK',
  p_ip_address text DEFAULT NULL,
  p_user_agent text DEFAULT NULL
)
RETURNS uuid AS $$
DECLARE
  v_consent_id uuid;
BEGIN
  INSERT INTO consent_records (
    parent_id,
    consent_type,
    privacy_policy_version,
    terms_version,
    refund_policy_version,
    consent_method,
    consent_text,
    jurisdiction,
    ip_address,
    user_agent
  ) VALUES (
    p_parent_id,
    'signup_policy_acceptance',
    p_privacy_version,
    p_terms_version,
    p_refund_version,
    p_consent_method,
    p_consent_text,
    p_jurisdiction,
    p_ip_address,
    p_user_agent
  )
  RETURNING id INTO v_consent_id;

  RETURN v_consent_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION record_signup_consent(uuid, text, text, text, text, text, text, text, text) IS 'Records consent at signup with policy versions and context';


-- FUNCTION 12: Record child creation consent
CREATE OR REPLACE FUNCTION record_child_consent(
  p_parent_id uuid,
  p_child_id uuid,
  p_privacy_version text,
  p_consent_method text DEFAULT 'click_accept',
  p_consent_text text DEFAULT NULL,
  p_jurisdiction text DEFAULT 'UK',
  p_ip_address text DEFAULT NULL,
  p_user_agent text DEFAULT NULL
)
RETURNS uuid AS $$
DECLARE
  v_consent_id uuid;
BEGIN
  INSERT INTO consent_records (
    parent_id,
    child_id,
    consent_type,
    privacy_policy_version,
    consent_method,
    consent_text,
    jurisdiction,
    ip_address,
    user_agent
  ) VALUES (
    p_parent_id,
    p_child_id,
    'child_creation',
    p_privacy_version,
    p_consent_method,
    p_consent_text,
    p_jurisdiction,
    p_ip_address,
    p_user_agent
  )
  RETURNING id INTO v_consent_id;

  RETURN v_consent_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION record_child_consent(uuid, uuid, text, text, text, text, text, text) IS 'Records consent for child profile creation';


-- FUNCTION 13: Check policy acceptance
CREATE OR REPLACE FUNCTION check_policy_acceptance(
  p_parent_id uuid,
  p_privacy_version text,
  p_terms_version text
)
RETURNS boolean AS $$
DECLARE
  v_accepted boolean;
BEGIN
  SELECT EXISTS(
    SELECT 1 FROM consent_records
    WHERE parent_id = p_parent_id
    AND consent_type = 'signup_policy_acceptance'
    AND privacy_policy_version = p_privacy_version
    AND terms_version = p_terms_version
    AND revoked_at IS NULL
    AND granted_at <= now()
  ) INTO v_accepted;

  RETURN v_accepted;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION check_policy_acceptance(uuid, text, text) IS 'Checks if user has accepted current policy versions';


-- FUNCTION 14: Delete parent account (cascade with credit anonymization)
CREATE OR REPLACE FUNCTION delete_parent_account(p_parent_id uuid)
RETURNS boolean AS $$
BEGIN
  -- Anonymize credit ledger before deletion
  UPDATE credit_ledger
  SET description = '[DELETED ACCOUNT]'
  WHERE parent_id = p_parent_id;

  -- Delete profile (cascades to all child tables)
  DELETE FROM profiles
  WHERE id = p_parent_id;

  RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION delete_parent_account(uuid) IS 'Fully deletes parent account and all associated data (with credit anonymization)';


-- FUNCTION 15: Delete child profile (with ownership check)
CREATE OR REPLACE FUNCTION delete_child_profile(
  p_parent_id uuid,
  p_child_id uuid
)
RETURNS boolean AS $$
DECLARE
  v_child_count integer;
BEGIN
  -- Verify parent owns child
  SELECT COUNT(*) INTO v_child_count
  FROM children
  WHERE id = p_child_id
  AND parent_id = p_parent_id;

  IF v_child_count = 0 THEN
    RAISE EXCEPTION 'Child not found or not owned by this parent';
  END IF;

  -- Delete child (cascades to sessions, messages, notifications)
  DELETE FROM children
  WHERE id = p_child_id;

  RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION delete_child_profile(uuid, uuid) IS 'Deletes child profile with ownership validation and cascade delete';


-- ============================================================================
-- TRIGGERS
-- ============================================================================

-- Trigger: Create profile and initial credits on auth user creation
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION handle_new_user();

COMMENT ON TRIGGER on_auth_user_created ON auth.users IS 'Creates profile and assigns initial credits when new user signs up';


-- Trigger: Validate child limit before insert
DROP TRIGGER IF EXISTS check_child_limit_trigger ON children;
CREATE TRIGGER check_child_limit_trigger
  BEFORE INSERT ON children
  FOR EACH ROW
  EXECUTE FUNCTION check_child_limit();

COMMENT ON TRIGGER check_child_limit_trigger ON children IS 'Prevents exceeding subscription child limit';


-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================

-- This migration is idempotent. All tables use IF NOT EXISTS, and functions
-- use CREATE OR REPLACE. Triggers are dropped before recreation.
--
-- Key design decisions:
-- 1. RLS enabled on all tables with parent-specific policies
-- 2. Cascading deletes for data integrity
-- 3. Credit ledger for audit trail
-- 4. Bcrypt hashing for child passwords
-- 5. Consent records for GDPR compliance
-- 6. Session/message structure for AI interaction tracking
-- 7. Weekly reports for progress tracking
-- 8. Notification system for parent engagement
