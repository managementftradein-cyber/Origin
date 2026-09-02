const { sb, requireUser } = require('./_supabase');

const BUCKET = 'community';
const MAX_BYTES = 4 * 1024 * 1024; // 4MB — smaller than the admin gallery limit
const ALLOWED = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

module.exports = async (req, res) => {
  try {
    const user = await requireUser(req);
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { contentType, dataBase64 } = req.body || {};
    const ext = ALLOWED[contentType];
    if (!ext) return res.status(400).json({ error: 'Unsupported image type. Use JPG, PNG, WEBP or GIF.' });
    if (!dataBase64) return res.status(400).json({ error: 'No image data received' });

    const buffer = Buffer.from(dataBase64, 'base64');
    if (buffer.length > MAX_BYTES) return res.status(400).json({ error: 'Image is larger than 4MB' });

    const path = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const db = sb();
    const up = await db.storage.from(BUCKET).upload(path, buffer, { contentType, upsert: false });
    if (up.error) throw up.error;

    const pub = db.storage.from(BUCKET).getPublicUrl(path);
    return res.status(201).json({ url: pub.data.publicUrl, path });
  } catch (e) {
    console.error(e);
    return res.status(e.status || 500).json({ error: e.message || 'Upload failed' });
  }
};
