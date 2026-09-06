const { sb, requireUser } = require('./_supabase');

const BUCKET = 'community';
const MAX_BYTES = 4 * 1024 * 1024; // 4MB — smaller than the admin gallery limit
const ALLOWED = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

function matchesImageSignature(buffer, contentType) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return false;
  if (contentType === 'image/jpeg') return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (contentType === 'image/png') return buffer.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]));
  if (contentType === 'image/gif') return buffer.subarray(0, 6).toString('ascii') === 'GIF87a' || buffer.subarray(0, 6).toString('ascii') === 'GIF89a';
  if (contentType === 'image/webp') return buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
  return false;
}

module.exports = async (req, res) => {
  try {
    const user = await requireUser(req);
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { contentType, dataBase64 } = req.body || {};
    const ext = ALLOWED[contentType];
    if (!ext) return res.status(400).json({ error: 'Unsupported image type. Use JPG, PNG, WEBP or GIF.' });
    if (!dataBase64) return res.status(400).json({ error: 'No image data received' });

    const normalizedBase64 = String(dataBase64).replace(/^data:[^;]+;base64,/, '').replace(/\s+/g, '');
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalizedBase64) || normalizedBase64.length > Math.ceil((MAX_BYTES * 4) / 3) + 8) return res.status(400).json({ error: 'Invalid or oversized image data' });
    const buffer = Buffer.from(normalizedBase64, 'base64');
    if (!matchesImageSignature(buffer, contentType)) return res.status(400).json({ error: 'Image data does not match the declared image type' });
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
