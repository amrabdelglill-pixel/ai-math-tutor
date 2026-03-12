// Supabase client-side configuration
const SUPABASE_URL = 'https://gstjvjynkdvqncjyybwm.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdzdGp2anlua2R2cW5janl5YndtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIzNDI1MjQsImV4cCI6MjA4NzkxODUyNH0.oJUw3l8fI-zqTB2A1S08rtAKrnmGWtZt5e9-4xH2Kx8';

// Initialize Supabase client
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Auth helper functions
async function getSession() {
  const { data: { session } } = await supabaseClient.auth.auth.getSession();
  return session;
}

async function getToken() {
  const session = await getSession();
  return session?.access_token || null;
}

async function apiCall(endpoint, options = {}) {
  const token = await getToken();
  if (!token) {
    window.location.href = '/login';
    return null;
  }
  const res = await fetch(endpoint, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      ...(options.headers || {})
    }
  });
  return res.json();
}

// Auth state listener — redirect if not logged in
function requireAuth() {
  supabaseClient.auth.auth.onAuthStateChange((event, session) => {
    if (!session && window.location.pathname !== '/login' && window.location.pathname !== '/') {
      window.location.href = '/login';
    }
  });
}
