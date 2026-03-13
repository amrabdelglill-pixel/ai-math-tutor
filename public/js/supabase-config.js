// Supabase client-side configuration
// Note: CDN creates global `var supabase` with { createClient }
// We reassign it to the initialized client instance
(function() {
  var url = 'https://gstjvjynkdvqncjyybwm.supabase.co';
  var key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdzdGp2anlua2R2cW5janl5YndtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIzNDI1MjQsImV4cCI6MjA4NzkxODUyNH0.oJUw3l8fI-zqTB2A1S08rtAKrnmGWtZt5e9-4xH2Kx8';
  window.supabaseClient = window.supabase.createClient(url, key);
})();

// Auth helper functions
async function getSession() {
  var client = window.supabaseClient;
  var result = await client.auth.getSession();
  return result.data.session;
}

async function getToken() {
  var session = await getSession();
  return session ? session.access_token : null;
}

async function apiCall(endpoint, options) {
  options = options || {};
  var token = await getToken();
  if (!token) {
    window.location.href = '/login';
    return null;
  }
  var headers = Object.assign({
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + token
  }, options.headers || {});
  var res = await fetch(endpoint, Object.assign({}, options, { headers: headers }));
  return res.json();
}

// Auth state listener — redirect if not logged in
function requireAuth() {
  window.supabaseClient.auth.onAuthStateChange(function(event, session) {
    if (!session && window.location.pathname !== '/login' && window.location.pathname !== '/') {
      window.location.href = '/login';
    }
  });
}
