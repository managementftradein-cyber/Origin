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
  giving: 'giving_records', giving_records: 'giving_records', settings: 'church_settings',
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
  return data.user;
}

async function requireAdmin(req) {
  const user = await requireUser(req);
  if (!isAdminEmail(user.email)) {
    throw Object.assign(new Error('You are not authorized to access the admin dashboard'), { status: 403 });
  }
  return user;
}

module.exports = { sb, tables, requireAdmin, requireUser, isAdminEmail };
