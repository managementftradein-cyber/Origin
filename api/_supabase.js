const { createClient } = require('@supabase/supabase-js');

function sb() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Supabase environment variables are not configured');
  }
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

const tables = {
  sermons: 'sermons', events: 'events', announcements: 'announcements',
  prayer: 'prayer_requests', prayer_requests: 'prayer_requests', visitors: 'visitors', subscribers: 'subscribers',
  giving: 'giving_records', giving_records: 'giving_records', giving_accounts: 'giving_accounts', settings: 'church_settings',
  gallery: 'gallery_photos', departments: 'departments', news: 'news', prophetic_words: 'prophetic_words', live_status: 'live_status',
  community_posts: 'community_posts', community_comments: 'community_comments', profiles: 'profiles'
};

function isAdminEmail(email) {
  const allowed = String(process.env.ADMIN_EMAILS || '')
    .split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
  return allowed.includes(String(email || '').toLowerCase());
}

// Resolves the Supabase session tied to the request's bearer token, without
// requiring the caller to be a listed admin. Used by the community endpoints
// so any signed-up member can post, comment and like.
async function requireUser(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) throw Object.assign(new Error('Please sign in to continue'), { status: 401 });

  const client = sb();
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) throw Object.assign(new Error('Your session has expired. Please sign in again'), { status: 401 });

  // Belt-and-braces: a suspended member's existing session token may still
  // be technically valid for a short window even after their Supabase Auth
  // account is banned, so also block them at the profile level.
  try {
    const prof = await client.from('profiles').select('is_suspended').eq('id', data.user.id).maybeSingle();
    if (!prof.error && prof.data && prof.data.is_suspended) {
      throw Object.assign(new Error('Your account has been suspended.'), { status: 403 });
    }
  } catch (e) {
    if (e && e.status === 403) throw e;
  }

  return data.user;
}

async function requireAdmin(req) {
  const user = await requireUser(req);
  if (!isAdminEmail(user.email)) {
    throw Object.assign(new Error('You are not authorized to access the admin dashboard'), { status: 403 });
  }
  return user;
}

// Best-effort client IP for rate limiting. Vercel sets x-forwarded-for.
function clientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  if (xf) return String(xf).split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

// Fixed-window rate limit backed by the rate_limit_hits table (see
// supabase/rate_limiting_migration.sql). Fails OPEN (allows the request) if
// the check itself errors — e.g. the migration hasn't been run yet — so a
// missing migration degrades to "no rate limiting" rather than breaking the
// site.
async function checkRateLimit(db, key, limit, windowSeconds) {
  try {
    const { data, error } = await db.rpc('check_rate_limit', { p_key: key, p_limit: limit, p_window_seconds: windowSeconds });
    if (error) { console.warn('Rate limit check failed (allowing request):', error.message); return true; }
    return data !== false;
  } catch (e) {
    console.warn('Rate limit check error (allowing request):', e.message);
    return true;
  }
}

// Simple honeypot check for public forms: a hidden field real users never
// fill in. If it has a value, the submission is almost certainly a bot.
// Returns true (silently) so we don't tip bots off with a distinct error.
function isHoneypotTripped(body) {
  return !!(body && String(body.website || body.company_website || '').trim());
}

module.exports = { sb, tables, requireAdmin, requireUser, isAdminEmail, clientIp, checkRateLimit, isHoneypotTripped };
