// Live video meetings for the community platform, powered by Daily.co
// (https://daily.co). The Head Admin can start a call with any single
// department, or a whole-community call. Department heads and members can
// only join calls for their own department (or whole-community calls) —
// enforced below, not just hidden in the UI.
//
// Setup required: create a free Daily.co account, generate an API key
// (Dashboard > Developers), and add it to Vercel as the DAILY_API_KEY
// environment variable. Also run supabase/meetings_migration.sql. Nothing
// in this file works until both are done.

const { sb, requireUser, isAdminEmail } = require('./_supabase');

const DAILY_API = 'https://api.daily.co/v1';

function dailyKey() {
  const k = process.env.DAILY_API_KEY;
  if (!k) throw Object.assign(new Error('Video meetings are not set up yet. A Daily.co API key needs to be added (DAILY_API_KEY).'), { status: 500 });
  return k;
}

async function dailyFetch(path, opts = {}) {
  const r = await fetch(`${DAILY_API}${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${dailyKey()}`, 'Content-Type': 'application/json', ...(opts.headers || {}) }
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(d.error || d.info || 'Video service error'), { status: r.status >= 400 && r.status < 500 ? 400 : 502 });
  return d;
}

async function requireDeptContext(req, db) {
  const user = await requireUser(req);
  if (isAdminEmail(user.email)) return { user, isHeadAdmin: true, deptId: null };
  const p = await db.from('profiles').select('role,department_id').eq('id', user.id).maybeSingle();
  if (p.error) throw p.error;
  return { user, isHeadAdmin: false, deptId: p.data ? p.data.department_id : null };
}

async function startMeeting(req, res, db, ctx) {
  if (!ctx.isHeadAdmin) return res.status(403).json({ error: 'Only the head admin can start a meeting.' });
  const title = String((req.body || {}).title || 'TCC Meeting').trim().slice(0, 120) || 'TCC Meeting';
  const raw = String((req.body || {}).department_id || '').trim();
  const departmentId = raw && raw !== 'all' ? raw : null;

  const roomName = `tcc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const room = await dailyFetch('/rooms', {
    method: 'POST',
    body: JSON.stringify({
      name: roomName,
      privacy: 'private',
      properties: { enable_chat: true, enable_screenshare: true, exp: Math.floor(Date.now() / 1000) + 4 * 60 * 60, eject_at_room_exp: true }
    })
  });

  const ins = await db.from('department_meetings').insert({
    department_id: departmentId, title, created_by: ctx.user.id, room_name: room.name, status: 'live'
  }).select('*,departments(name)').single();
  if (ins.error) throw ins.error;

  const token = await dailyFetch('/meeting-tokens', {
    method: 'POST',
    body: JSON.stringify({ properties: { room_name: room.name, is_owner: true, user_name: 'Head Admin' } })
  });

  return res.status(201).json({
    meeting: { ...ins.data, department_name: (ins.data.departments && ins.data.departments.name) || 'All Departments' },
    join_url: `${room.url}?t=${token.token}`
  });
}

async function endMeeting(req, res, db, ctx) {
  if (!ctx.isHeadAdmin) return res.status(403).json({ error: 'Only the head admin can end a meeting.' });
  const id = String((req.body || {}).meeting_id || '');
  if (!id) return res.status(400).json({ error: 'Missing meeting_id' });
  const q = await db.from('department_meetings').select('*').eq('id', id).maybeSingle();
  if (q.error) throw q.error;
  if (!q.data) return res.status(404).json({ error: 'Meeting not found' });
  try { await dailyFetch(`/rooms/${q.data.room_name}`, { method: 'DELETE' }); } catch (e) { console.warn('Could not delete Daily room', e); }
  const upd = await db.from('department_meetings').update({ status: 'ended', ended_at: new Date().toISOString() }).eq('id', id);
  if (upd.error) throw upd.error;
  return res.json({ ok: true });
}

async function listActive(req, res, db, ctx) {
  const r = await db.from('department_meetings').select('*,departments(name)').eq('status', 'live').order('started_at', { ascending: false });
  if (r.error) throw r.error;
  const rows = (r.data || []).filter((m) => ctx.isHeadAdmin || !m.department_id || m.department_id === ctx.deptId);
  return res.json({ items: rows.map((m) => ({ ...m, department_name: (m.departments && m.departments.name) || 'All Departments' })) });
}

async function joinMeeting(req, res, db, ctx) {
  const id = String((req.body || {}).meeting_id || '');
  if (!id) return res.status(400).json({ error: 'Missing meeting_id' });
  const q = await db.from('department_meetings').select('*').eq('id', id).maybeSingle();
  if (q.error) throw q.error;
  const m = q.data;
  if (!m || m.status !== 'live') return res.status(404).json({ error: 'This meeting is not live.' });
  if (!ctx.isHeadAdmin && m.department_id && m.department_id !== ctx.deptId) {
    return res.status(403).json({ error: 'This meeting is for a different department.' });
  }
  const token = await dailyFetch('/meeting-tokens', {
    method: 'POST',
    body: JSON.stringify({ properties: { room_name: m.room_name, is_owner: false } })
  });
  const room = await dailyFetch(`/rooms/${m.room_name}`);
  return res.json({ join_url: `${room.url}?t=${token.token}` });
}

module.exports = async (req, res) => {
  const type = String(req.query.type || '');
  const db = sb();
  try {
    const ctx = await requireDeptContext(req, db);
    if (req.method === 'GET') {
      if (type === 'active') return await listActive(req, res, db, ctx);
      return res.status(400).json({ error: `Unknown meetings type: ${type}` });
    }
    if (req.method === 'POST') {
      if (type === 'start') return await startMeeting(req, res, db, ctx);
      if (type === 'end') return await endMeeting(req, res, db, ctx);
      if (type === 'join') return await joinMeeting(req, res, db, ctx);
      return res.status(400).json({ error: `Unknown meetings type: ${type}` });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error(e);
    return res.status(e.status || 500).json({ error: e.message || 'Server error' });
  }
};
