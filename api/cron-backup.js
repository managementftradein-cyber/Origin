// Automated daily backup — triggered by Vercel Cron (see the "crons" entry
// in vercel.json). Dumps every important table to a single timestamped JSON
// file in a private 'backups' storage bucket, and prunes old backups so
// storage doesn't grow forever. This exists independently of whatever
// backup retention your Supabase plan includes — belt and braces.
//
// Setup required: run supabase/backups_migration.sql (creates the private
// 'backups' bucket), and set a CRON_SECRET environment variable in Vercel
// so this endpoint can't be triggered by anyone else.

const { sb } = require('./_supabase');

const BUCKET = 'backups';
const KEEP = 14; // keep the last 14 daily backups
const TABLES = [
  'profiles', 'departments', 'department_invites', 'department_meetings',
  'community_posts', 'community_comments', 'community_likes',
  'events', 'sermons', 'announcements', 'news', 'prophetic_words', 'live_status',
  'gallery_photos', 'church_settings', 'visitors', 'subscribers', 'prayer_requests', 'giving_records'
];

function isAuthorized(req) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers['authorization'] || '';
  if (secret) return auth === `Bearer ${secret}`;
  // No secret configured — fall back to trusting Vercel's own cron user-agent.
  // Set CRON_SECRET for a real guarantee this can't be called by anyone else.
  return req.headers['user-agent'] === 'vercel-cron/1.0';
}

module.exports = async (req, res) => {
  if (!isAuthorized(req)) return res.status(401).json({ error: 'Unauthorized' });

  const db = sb();
  const snapshot = { generated_at: new Date().toISOString(), tables: {} };
  const errors = [];

  for (const t of TABLES) {
    try {
      const { data, error } = await db.from(t).select('*').limit(50000);
      if (error) { errors.push(`${t}: ${error.message}`); continue; }
      snapshot.tables[t] = data || [];
    } catch (e) {
      errors.push(`${t}: ${e.message}`);
    }
  }
  snapshot.errors = errors;

  const filename = `backup-${new Date().toISOString().slice(0, 10)}-${Date.now()}.json`;
  const buffer = Buffer.from(JSON.stringify(snapshot));

  const up = await db.storage.from(BUCKET).upload(filename, buffer, { contentType: 'application/json', upsert: false });
  if (up.error) {
    console.error('Backup upload failed', up.error);
    return res.status(500).json({ ok: false, error: up.error.message });
  }

  try {
    const list = await db.storage.from(BUCKET).list('', { limit: 200, sortBy: { column: 'name', order: 'desc' } });
    if (!list.error && list.data && list.data.length > KEEP) {
      const toDelete = list.data.slice(KEEP).map((f) => f.name);
      if (toDelete.length) await db.storage.from(BUCKET).remove(toDelete);
    }
  } catch (e) {
    console.warn('Backup cleanup failed', e);
  }

  return res.status(200).json({ ok: true, file: filename, tables: Object.keys(snapshot.tables).length, errors });
};
