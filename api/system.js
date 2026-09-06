// Consolidated tiny GET endpoints. Each handler's logic is unchanged from
// the original files — only the routing (type dispatch) is new.

const { sb, requireAdmin } = require('./_supabase');

function handleHealth() {
  // Public health checks should not reveal which privileged secrets/configuration
  // values exist. Keep this intentionally generic.
  const ok = !!process.env.SUPABASE_URL &&
    !!(process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY) &&
    !!process.env.SUPABASE_SERVICE_ROLE_KEY &&
    !!process.env.ADMIN_EMAILS;
  return { status: ok ? 200 : 500, body: { ok } };
}

function handleConfig() {
  const key = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!process.env.SUPABASE_URL || !key) {
    return { status: 500, body: { error: 'Supabase public configuration is not configured' } };
  }
  return { status: 200, body: { url: process.env.SUPABASE_URL, anonKey: key } };
}

function handleAuthStatus() {
  // This endpoint used to disclose whether an arbitrary email was configured
  // as an admin. It is retained only for compatibility and returns no email
  // enumeration result.
  return { status: 200, body: { ok: true } };
}

// Head-admin-only: list recent automated backups (created by
// api/cron-backup.js) with time-limited download links.
async function handleBackups(req) {
  await requireAdmin(req);
  const db = sb();
  const list = await db.storage.from('backups').list('', { limit: 30, sortBy: { column: 'name', order: 'desc' } });
  if (list.error) return { status: 500, body: { error: list.error.message } };
  const files = list.data || [];
  const items = await Promise.all(files.map(async (f) => {
    const signed = await db.storage.from('backups').createSignedUrl(f.name, 3600);
    return { name: f.name, created_at: f.created_at, size: f.metadata && f.metadata.size, url: signed.data ? signed.data.signedUrl : null };
  }));
  return { status: 200, body: { items } };
}

const HANDLERS = {
  health: () => handleHealth(),
  config: () => handleConfig(),
  'auth-status': (req) => handleAuthStatus(req),
  backups: (req) => handleBackups(req)
};

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const type = String(req.query.type || '');
  const handler = HANDLERS[type];
  if (!handler) return res.status(400).json({ error: `Unknown system type: ${type}` });
  try {
    const result = await handler(req);
    return res.status(result.status).json(result.body);
  } catch (e) {
    console.error(e);
    return res.status(e.status || 500).json({ error: e.message || 'Server error' });
  }
};
