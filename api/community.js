const { sb, requireUser, isAdminEmail } = require('./_supabase');

const MAX_POST_LEN = 3000;
const MAX_COMMENT_LEN = 1000;

// Tries to resolve the calling user from a bearer token, but never throws —
// used by public GET endpoints so a signed-in visitor sees their own like
// state while a signed-out visitor still gets the feed.
async function optionalUser(req) {
  try { return await requireUser(req); } catch (_) { return null; }
}

function displayName(profile, user) {
  return (profile && profile.display_name) || (user && String(user.email || '').split('@')[0]) || 'Member';
}

async function attachProfiles(db, rows, key = 'user_id') {
  const ids = [...new Set(rows.map(r => r[key]).filter(Boolean))];
  if (!ids.length) return {};
  const q = await db.from('profiles').select('id,display_name,avatar_url').in('id', ids);
  if (q.error) throw q.error;
  const map = {};
  for (const p of q.data || []) map[p.id] = p;
  return map;
}

async function getFeed(req, res, db) {
  const user = await optionalUser(req);
  const limit = Math.max(1, Math.min(50, Number(req.query.limit) || 20));
  const before = req.query.before ? String(req.query.before) : null;

  let q = db.from('community_posts').select('*').eq('is_hidden', false).order('created_at', { ascending: false }).limit(limit);
  if (before) q = q.lt('created_at', before);
  const posts = await q;
  if (posts.error) throw posts.error;
  const items = posts.data || [];
  if (!items.length) return res.json({ items: [] });

  const profiles = await attachProfiles(db, items);
  const ids = items.map(p => p.id);

  const [likeCounts, commentCounts, myLikes] = await Promise.all([
    db.from('community_likes').select('post_id').in('post_id', ids),
    db.from('community_comments').select('post_id').eq('is_hidden', false).in('post_id', ids),
    user ? db.from('community_likes').select('post_id').eq('user_id', user.id).in('post_id', ids) : Promise.resolve({ data: [] })
  ]);
  if (likeCounts.error) throw likeCounts.error;
  if (commentCounts.error) throw commentCounts.error;
  if (myLikes.error) throw myLikes.error;

  const likeTally = {}, commentTally = {}, likedSet = new Set((myLikes.data || []).map(x => x.post_id));
  for (const r of likeCounts.data || []) likeTally[r.post_id] = (likeTally[r.post_id] || 0) + 1;
  for (const r of commentCounts.data || []) commentTally[r.post_id] = (commentTally[r.post_id] || 0) + 1;

  return res.json({
    items: items.map(p => ({
      id: p.id, body: p.body, image_url: p.image_url, created_at: p.created_at,
      user_id: p.user_id, author: displayName(profiles[p.user_id], null),
      avatar_url: profiles[p.user_id]?.avatar_url || null,
      like_count: likeTally[p.id] || 0, comment_count: commentTally[p.id] || 0,
      liked_by_me: likedSet.has(p.id), mine: user ? user.id === p.user_id : false
    }))
  });
}

async function getComments(req, res, db) {
  const postId = String(req.query.post_id || '');
  if (!postId) return res.status(400).json({ error: 'Missing post_id' });
  const user = await optionalUser(req);
  const q = await db.from('community_comments').select('*').eq('post_id', postId).eq('is_hidden', false).order('created_at', { ascending: true }).limit(200);
  if (q.error) throw q.error;
  const items = q.data || [];
  const profiles = await attachProfiles(db, items);
  return res.json({
    items: items.map(c => ({
      id: c.id, body: c.body, created_at: c.created_at, user_id: c.user_id,
      author: displayName(profiles[c.user_id], null), avatar_url: profiles[c.user_id]?.avatar_url || null,
      mine: user ? user.id === c.user_id : false
    }))
  });
}

async function getProfile(req, res, db, user) {
  const q = await db.from('profiles').select('*').eq('id', user.id).maybeSingle();
  if (q.error) throw q.error;
  return res.json(q.data || { id: user.id, display_name: null, bio: null, avatar_url: null });
}

async function createPost(req, res, db, user) {
  const body = String((req.body || {}).body || '').trim();
  const image_url = String((req.body || {}).image_url || '').trim() || null;
  if (!body) return res.status(400).json({ error: 'Write something before posting' });
  if (body.length > MAX_POST_LEN) return res.status(400).json({ error: `Posts are limited to ${MAX_POST_LEN} characters` });
  const q = await db.from('community_posts').insert({ user_id: user.id, body, image_url }).select().single();
  if (q.error) throw q.error;
  return res.status(201).json(q.data);
}

async function createComment(req, res, db, user) {
  const post_id = String((req.body || {}).post_id || '');
  const body = String((req.body || {}).body || '').trim();
  if (!post_id) return res.status(400).json({ error: 'Missing post_id' });
  if (!body) return res.status(400).json({ error: 'Write a comment before submitting' });
  if (body.length > MAX_COMMENT_LEN) return res.status(400).json({ error: `Comments are limited to ${MAX_COMMENT_LEN} characters` });
  const q = await db.from('community_comments').insert({ post_id, user_id: user.id, body }).select().single();
  if (q.error) throw q.error;
  return res.status(201).json(q.data);
}

async function toggleLike(req, res, db, user) {
  const post_id = String((req.body || {}).post_id || '');
  if (!post_id) return res.status(400).json({ error: 'Missing post_id' });
  const existing = await db.from('community_likes').select('post_id').eq('post_id', post_id).eq('user_id', user.id).maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) {
    const del = await db.from('community_likes').delete().eq('post_id', post_id).eq('user_id', user.id);
    if (del.error) throw del.error;
    return res.json({ liked: false });
  }
  const ins = await db.from('community_likes').insert({ post_id, user_id: user.id });
  if (ins.error) throw ins.error;
  return res.json({ liked: true });
}

async function saveProfile(req, res, db, user) {
  const display_name = String((req.body || {}).display_name || '').trim().slice(0, 60) || null;
  const bio = String((req.body || {}).bio || '').trim().slice(0, 280) || null;
  const avatar_url = String((req.body || {}).avatar_url || '').trim() || null;
  if (!display_name) return res.status(400).json({ error: 'Please enter a display name' });
  const q = await db.from('profiles').upsert({ id: user.id, display_name, bio, avatar_url, updated_at: new Date().toISOString() }, { onConflict: 'id' }).select().single();
  if (q.error) throw q.error;
  return res.status(201).json(q.data);
}

async function removePost(req, res, db, user) {
  const id = String((req.body || {}).id || '');
  if (!id) return res.status(400).json({ error: 'Missing id' });
  const row = await db.from('community_posts').select('user_id').eq('id', id).maybeSingle();
  if (row.error) throw row.error;
  if (!row.data) return res.status(404).json({ error: 'Post not found' });
  if (row.data.user_id !== user.id && !isAdminEmail(user.email)) {
    return res.status(403).json({ error: 'You can only delete your own posts' });
  }
  const del = await db.from('community_posts').delete().eq('id', id);
  if (del.error) throw del.error;
  return res.json({ ok: true });
}

async function removeComment(req, res, db, user) {
  const id = String((req.body || {}).id || '');
  if (!id) return res.status(400).json({ error: 'Missing id' });
  const row = await db.from('community_comments').select('user_id').eq('id', id).maybeSingle();
  if (row.error) throw row.error;
  if (!row.data) return res.status(404).json({ error: 'Comment not found' });
  if (row.data.user_id !== user.id && !isAdminEmail(user.email)) {
    return res.status(403).json({ error: 'You can only delete your own comments' });
  }
  const del = await db.from('community_comments').delete().eq('id', id);
  if (del.error) throw del.error;
  return res.json({ ok: true });
}

module.exports = async (req, res) => {
  const type = String(req.query.type || '');
  const db = sb();
  try {
    if (req.method === 'GET') {
      if (type === 'feed') return await getFeed(req, res, db);
      if (type === 'comments') return await getComments(req, res, db);
      if (type === 'profile') return await getProfile(req, res, db, await requireUser(req));
      return res.status(400).json({ error: `Unknown community type: ${type}` });
    }
    if (req.method === 'POST') {
      const user = await requireUser(req);
      if (type === 'post') return await createPost(req, res, db, user);
      if (type === 'comment') return await createComment(req, res, db, user);
      if (type === 'like') return await toggleLike(req, res, db, user);
      if (type === 'profile') return await saveProfile(req, res, db, user);
      return res.status(400).json({ error: `Unknown community type: ${type}` });
    }
    if (req.method === 'DELETE') {
      const user = await requireUser(req);
      if (type === 'post') return await removePost(req, res, db, user);
      if (type === 'comment') return await removeComment(req, res, db, user);
      return res.status(400).json({ error: `Unknown community type: ${type}` });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error(e);
    return res.status(e.status || 500).json({ error: e.message || 'Server error' });
  }
};
