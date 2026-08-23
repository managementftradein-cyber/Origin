const { sb } = require('./_supabase');

// Consolidated public POST endpoints. Each handler's logic (validation,
// tables touched, response shape) is unchanged from the original files —
// only the routing (type dispatch) is new.

async function handleContact(db, body) {
  const { name, email, phone, message } = body;
  if (!String(name || '').trim() || !String(message || '').trim()) {
    const err = new Error('Name and message are required');
    err.status = 400;
    throw err;
  }
  const settings = await db.from('church_settings').select('store_visitor_data').eq('id', 1).maybeSingle();
  const store = settings.error || !settings.data ? true : settings.data.store_visitor_data !== false;
  if (store) {
    const q = await db.from('visitors').insert({
      name: String(name).trim(),
      email: String(email || '').trim() || null,
      phone: String(phone || '').trim() || null,
      message: String(message).trim()
    });
    if (q.error) throw q.error;
  }
  return { status: 200, body: { ok: true, stored: store } };
}

async function handleSubscribe(db, body) {
  const email = String(body.email || '').trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    const err = new Error('Valid email required');
    err.status = 400;
    throw err;
  }
  const s = await db.from('church_settings').select('store_visitor_data').eq('id', 1).maybeSingle();
  const store = s.error || !s.data ? true : s.data.store_visitor_data !== false;
  if (store) {
    const q = await db.from('subscribers').upsert({ email }, { onConflict: 'email' });
    if (q.error) throw q.error;
  }
  return { status: 200, body: { ok: true, stored: store } };
}

async function handlePrayerRequest(db, body) {
  const { name, email, request, message, subject } = body;
  const text = String(request || message || '').trim();
  if (!text) {
    const err = new Error('Please enter your prayer request before submitting.');
    err.status = 400;
    throw err;
  }
  const q = await db.from('prayer_requests').insert({
    name: String(name || '').trim() || null,
    email: String(email || '').trim() || null,
    subject: String(subject || '').trim() || 'Prophetic Room',
    message: text
  });
  if (q.error) throw q.error;
  return { status: 201, body: { ok: true } };
}

const HANDLERS = {
  contact: handleContact,
  subscribe: handleSubscribe,
  'prayer-requests': handlePrayerRequest
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const type = String(req.query.type || '');
  const handler = HANDLERS[type];
  if (!handler) return res.status(400).json({ error: `Unknown form type: ${type}` });
  try {
    const result = await handler(sb(), req.body || {});
    return res.status(result.status).json(result.body);
  } catch (e) {
    console.error(e);
    return res.status(e.status || 500).json({ error: e.message || 'Could not submit form' });
  }
};
