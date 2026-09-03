const crypto = require('crypto');
const { sb, requireUser, isAdminEmail } = require('./_supabase');

const SUSPEND_BAN_DURATION = '87600h'; // ~10 years — effectively blocks sign-in
const INVITE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// Resolves whether the caller is the Head Admin (via ADMIN_EMAILS) or a
// Department Head (via profiles.role), and — for department heads — which
// single department they're scoped to. Everything below enforces that a
// department head can only ever touch their own department.
async function requireDeptContext(req, db) {
  const user = await requireUser(req);
  if (isAdminEmail(user.email)) return { user, isHeadAdmin: true, deptId: null };
  const p = await db.from('profiles').select('role,department_id').eq('id', user.id).maybeSingle();
  if (p.error) throw p.error;
  if (!p.data || p.data.role !== 'department_head' || !p.data.department_id) {
    throw Object.assign(new Error('You do not have department head access'), { status: 403 });
  }
  return { user, isHeadAdmin: false, deptId: p.data.department_id };
}

async function emailMap(db, ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  const map = {};
  await Promise.all(unique.map(async (id) => {
    try {
      const { data } = await db.auth.admin.getUserById(id);
      if (data && data.user) map[id] = data.user.email;
    } catch (_) { /* ignore lookup failures for individual ids */ }
  }));
  return map;
}

function inviteUrl(req, token) {
  const origin = req.headers.origin || (process.env.SITE_URL || '');
  return origin ? `${origin}/community.html?invite=${token}` : `/community.html?invite=${token}`;
}

// ---- reads ----

async function validateInvite(req, res, db) {
  const token = String(req.query.token || '').trim();
  if (!token) return res.json({ valid: false, error: 'Missing invite link.' });
  const q = await db.from('department_invites').select('id,status,expires_at,department_id,departments(name)').eq('token', token).maybeSingle();
  if (q.error) throw q.error;
  const inv = q.data;
  if (!inv) return res.json({ valid: false, error: 'This invite link is invalid.' });
  if (inv.status !== 'pending') return res.json({ valid: false, error: 'This invite link has already been used or was revoked.' });
  if (inv.expires_at && new Date(inv.expires_at) < new Date()) return res.json({ valid: false, error: 'This invite link has expired.' });
  return res.json({ valid: true, department_name: (inv.departments && inv.departments.name) || 'the department' });
}

async function myDepartment(req, res, db, ctx) {
  if (ctx.isHeadAdmin) return res.json({ head_admin: true });
  const q = await db.from('departments').select('*').eq('id', ctx.deptId).maybeSingle();
  if (q.error) throw q.error;
  return res.json({ department: q.data });
}

async function listMembers(req, res, db, ctx) {
  const deptId = ctx.isHeadAdmin ? String(req.query.department_id || '') : ctx.deptId;
  if (!deptId) return res.status(400).json({ error: 'Missing department_id' });
  const q = await db.from('profiles').select('*').eq('department_id', deptId).order('created_at', { ascending: false });
  if (q.error) throw q.error;
  const rows = q.data || [];
  const emails = await emailMap(db, rows.map((r) => r.id));
  return res.json({ items: rows.map((r) => ({ ...r, email: emails[r.id] || null })) });
}

async function listAllMembers(req, res, db) {
  const q = await db.from('profiles').select('*,departments(name)').order('created_at', { ascending: false }).limit(500);
  if (q.error) throw q.error;
  const rows = q.data || [];
  const emails = await emailMap(db, rows.map((r) => r.id));
  return res.json({ items: rows.map((r) => ({ ...r, email: emails[r.id] || null, department_name: (r.departments && r.departments.name) || null })) });
}

async function listDepartmentHeads(req, res, db) {
  const q = await db.from('profiles').select('*,departments(name)').eq('role', 'department_head').order('created_at', { ascending: false });
  if (q.error) throw q.error;
  const rows = q.data || [];
  const emails = await emailMap(db, rows.map((r) => r.id));
  return res.json({ items: rows.map((r) => ({ ...r, email: emails[r.id] || null, department_name: (r.departments && r.departments.name) || null })) });
}

async function listInvites(req, res, db, ctx) {
  let q = db.from('department_invites').select('*,departments(name)').order('created_at', { ascending: false });
  if (!ctx.isHeadAdmin) q = q.eq('department_id', ctx.deptId);
  else if (req.query.department_id) q = q.eq('department_id', String(req.query.department_id));
  const r = await q;
  if (r.error) throw r.error;
  return res.json({ items: (r.data || []).map((i) => ({ ...i, department_name: (i.departments && i.departments.name) || null })) });
}

// ---- writes: heads & suspension (head admin, or department head within their own department) ----

async function assignHead(req, res, db) {
  const profileId = String((req.body || {}).profile_id || '');
  const departmentId = String((req.body || {}).department_id || '');
  if (!profileId || !departmentId) return res.status(400).json({ error: 'Missing profile_id or department_id' });
  const upd = await db.from('profiles').update({ role: 'department_head', department_id: departmentId }).eq('id', profileId).select().single();
  if (upd.error) throw upd.error;
  return res.json({ ok: true, profile: upd.data });
}

async function removeHead(req, res, db) {
  const profileId = String((req.body || {}).profile_id || '');
  if (!profileId) return res.status(400).json({ error: 'Missing profile_id' });
  const upd = await db.from('profiles').update({ role: 'member' }).eq('id', profileId).select().single();
  if (upd.error) throw upd.error;
  return res.json({ ok: true, profile: upd.data });
}

async function setSuspendedRoute(req, res, db, ctx, suspend) {
  const targetId = String((req.body || {}).profile_id || '');
  if (!targetId) return res.status(400).json({ error: 'Missing profile_id' });
  if (targetId === ctx.user.id) return res.status(400).json({ error: 'You cannot suspend your own account' });

  const targetQ = await db.from('profiles').select('id,role,department_id').eq('id', targetId).maybeSingle();
  if (targetQ.error) throw targetQ.error;
  const target = targetQ.data;
  if (!target) return res.status(404).json({ error: 'Member not found' });

  if (!ctx.isHeadAdmin) {
    if (target.department_id !== ctx.deptId) return res.status(403).json({ error: 'You can only manage members of your own department' });
    if (target.role === 'department_head') return res.status(403).json({ error: 'Only the head admin can suspend a department head' });
  }

  const upd = await db.from('profiles').update({
    is_suspended: suspend,
    suspended_at: suspend ? new Date().toISOString() : null,
    suspended_by: suspend ? ctx.user.id : null
  }).eq('id', targetId).select().single();
  if (upd.error) throw upd.error;

  // Also ban/unban at the Supabase Auth level so a suspended member truly
  // cannot sign in again, not just get blocked inside the app.
  try {
    await db.auth.admin.updateUserById(targetId, { ban_duration: suspend ? SUSPEND_BAN_DURATION : 'none' });
  } catch (e) { console.warn('Auth ban toggle failed', e); }

  return res.json({ ok: true, profile: upd.data });
}

// ---- invites ----

async function createInvite(req, res, db, ctx, req_) {
  const departmentId = ctx.isHeadAdmin ? String((req.body || {}).department_id || '') : ctx.deptId;
  if (!departmentId) return res.status(400).json({ error: 'Missing department_id' });
  const applicant_name = String((req.body || {}).applicant_name || '').trim() || null;
  const applicant_email = String((req.body || {}).applicant_email || '').trim() || null;
  const token = crypto.randomBytes(16).toString('hex');
  const expires_at = new Date(Date.now() + INVITE_TTL_MS).toISOString();
  const ins = await db.from('department_invites').insert({
    token, department_id: departmentId, created_by: ctx.user.id, applicant_name, applicant_email, expires_at
  }).select().single();
  if (ins.error) throw ins.error;
  return res.status(201).json({ ...ins.data, invite_url: inviteUrl(req_, token) });
}

async function revokeInvite(req, res, db, ctx) {
  const id = String((req.body || {}).id || '');
  if (!id) return res.status(400).json({ error: 'Missing id' });
  const row = await db.from('department_invites').select('department_id,status').eq('id', id).maybeSingle();
  if (row.error) throw row.error;
  if (!row.data) return res.status(404).json({ error: 'Invite not found' });
  if (!ctx.isHeadAdmin && row.data.department_id !== ctx.deptId) return res.status(403).json({ error: 'You can only revoke invites for your own department' });
  const upd = await db.from('department_invites').update({ status: 'revoked' }).eq('id', id).eq('status', 'pending');
  if (upd.error) throw upd.error;
  return res.json({ ok: true });
}

// Public: an applicant redeems an invite link to create their account. This
// is the ONLY way to create a community account — there is no open signup.
async function applyWithInvite(req, res, db) {
  const body = req.body || {};
  const token = String(body.token || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (!token) return res.status(400).json({ error: 'Missing invite link.' });
  if (!email || !password) return res.status(400).json({ error: 'Enter an email and password.' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });

  const q = await db.from('department_invites').select('*').eq('token', token).maybeSingle();
  if (q.error) throw q.error;
  const inv = q.data;
  if (!inv) return res.status(400).json({ error: 'This invite link is invalid.' });
  if (inv.status !== 'pending') return res.status(400).json({ error: 'This invite link has already been used or was revoked.' });
  if (inv.expires_at && new Date(inv.expires_at) < new Date()) return res.status(400).json({ error: 'This invite link has expired.' });

  const created = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) {
    const m = String(created.error.message || '');
    if (/already registered|already exists/i.test(m)) return res.status(400).json({ error: 'An account with this email already exists. Please sign in instead.' });
    return res.status(400).json({ error: m || 'Could not create your account.' });
  }
  const newUser = created.data.user;

  const prof = await db.from('profiles').upsert({ id: newUser.id, department_id: inv.department_id, role: 'member' }, { onConflict: 'id' });
  if (prof.error) throw prof.error;

  await db.from('department_invites').update({ status: 'used', used_at: new Date().toISOString(), used_by: newUser.id }).eq('id', inv.id).eq('status', 'pending');

  return res.status(201).json({ ok: true });
}

module.exports = async (req, res) => {
  const type = String(req.query.type || '');
  const db = sb();
  try {
    if (req.method === 'GET') {
      if (type === 'validate-invite') return await validateInvite(req, res, db);
      const ctx = await requireDeptContext(req, db);
      if (type === 'my-department') return await myDepartment(req, res, db, ctx);
      if (type === 'members') return await listMembers(req, res, db, ctx);
      if (type === 'invites') return await listInvites(req, res, db, ctx);
      if (type === 'all-members') { if (!ctx.isHeadAdmin) return res.status(403).json({ error: 'Head admin only' }); return await listAllMembers(req, res, db); }
      if (type === 'department-heads') { if (!ctx.isHeadAdmin) return res.status(403).json({ error: 'Head admin only' }); return await listDepartmentHeads(req, res, db); }
      return res.status(400).json({ error: `Unknown roles type: ${type}` });
    }
    if (req.method === 'POST') {
      if (type === 'apply') return await applyWithInvite(req, res, db);
      const ctx = await requireDeptContext(req, db);
      if (type === 'create-invite') return await createInvite(req, res, db, ctx, req);
      if (type === 'revoke-invite') return await revokeInvite(req, res, db, ctx);
      if (type === 'suspend') return await setSuspendedRoute(req, res, db, ctx, true);
      if (type === 'unsuspend') return await setSuspendedRoute(req, res, db, ctx, false);
      if (type === 'assign-head') { if (!ctx.isHeadAdmin) return res.status(403).json({ error: 'Head admin only' }); return await assignHead(req, res, db); }
      if (type === 'remove-head') { if (!ctx.isHeadAdmin) return res.status(403).json({ error: 'Head admin only' }); return await removeHead(req, res, db); }
      return res.status(400).json({ error: `Unknown roles type: ${type}` });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error(e);
    return res.status(e.status || 500).json({ error: e.message || 'Server error' });
  }
};
