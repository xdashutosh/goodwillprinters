const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { verifyToken, isAdmin } = require('../middleware/auth');
const { uploadMedia } = require('../middleware/upload');
const { processImage, processVideo, deleteByUrls } = require('../utils/assetProcessor');

// Group a flat row list into { collection: [rows sorted by sort_order, id] }
function groupRows(rows) {
  const out = {};
  for (const r of rows) {
    (out[r.collection] = out[r.collection] || []).push(r);
  }
  for (const k of Object.keys(out)) {
    out[k].sort((a, b) => (a.sort_order - b.sort_order) || (a.id - b.id));
  }
  return out;
}

const detectVideo = (file) =>
  (file.mimetype || '').startsWith('video/') ||
  /\.(mp4|webm|mov|m4v|ogv|mkv)$/i.test(file.originalname || '');

// ---------------------------------------------------------------------------
// Public — active assets, grouped by collection
// ---------------------------------------------------------------------------
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM site_assets WHERE is_active = true ORDER BY collection, sort_order, id`
    );
    res.json(groupRows(rows));
  } catch (err) {
    console.error('Assets fetch error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ---------------------------------------------------------------------------
// Admin — every asset (incl. inactive), grouped by collection
// ---------------------------------------------------------------------------
router.get('/admin/all', verifyToken, isAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM site_assets ORDER BY collection, sort_order, id`);
    res.json(groupRows(rows));
  } catch (err) {
    console.error('Assets admin fetch error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ---------------------------------------------------------------------------
// Admin — upload a file and attach it to an asset row.
//
//   body.collection  (required)  logical group
//   body.variant     'main' (default) | 'hover'
//   body.id          -> replace the file on this existing row
//   body.slot        -> upsert the keyed singleton (collection, slot)
//   (neither id nor slot) -> append a new free list item to the collection
//   body.title / subtitle / link / alt_text  (optional metadata)
// ---------------------------------------------------------------------------
router.post('/upload', verifyToken, isAdmin, uploadMedia.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const { collection, slot, id, variant = 'main' } = req.body;
    if (!collection) return res.status(400).json({ error: 'collection is required' });

    const isVideo = detectVideo(req.file);
    const kind = isVideo ? 'video' : 'image';
    const processed = isVideo
      ? await processVideo(req.file.buffer, { collection, slot, mimetype: req.file.mimetype })
      : await processImage(req.file.buffer, { collection, slot });

    const meta = {};
    for (const f of ['title', 'subtitle', 'link', 'alt_text']) {
      if (f in req.body) meta[f] = req.body[f] === '' ? null : req.body[f];
    }

    // 1) Replace the file on an existing row -------------------------------
    if (id) {
      const cur = await pool.query('SELECT * FROM site_assets WHERE id = $1', [id]);
      if (cur.rows.length === 0) return res.status(404).json({ error: 'Asset not found' });
      const row = cur.rows[0];
      if (variant === 'hover') {
        await deleteByUrls([row.hover_url, row.hover_webp_url]);
        const upd = await pool.query(
          `UPDATE site_assets SET hover_url=$1, hover_webp_url=$2, updated_at=CURRENT_TIMESTAMP WHERE id=$3 RETURNING *`,
          [processed.url, processed.webp_url || null, id]
        );
        return res.json(upd.rows[0]);
      }
      if (variant === 'poster') {
        // Replace only the poster/thumbnail image on a (usually video) row.
        await deleteByUrls([row.thumbnail_url]);
        const upd = await pool.query(
          `UPDATE site_assets SET thumbnail_url=$1, updated_at=CURRENT_TIMESTAMP WHERE id=$2 RETURNING *`,
          [processed.url, id]
        );
        return res.json(upd.rows[0]);
      }
      await deleteByUrls([row.url, row.webp_url, row.thumbnail_url]);
      const upd = await pool.query(
        `UPDATE site_assets SET kind=$1, url=$2, webp_url=$3, thumbnail_url=$4, updated_at=CURRENT_TIMESTAMP WHERE id=$5 RETURNING *`,
        [kind, processed.url, processed.webp_url || null, processed.thumbnail_url || null, id]
      );
      return res.json(upd.rows[0]);
    }

    // 2) Upsert a keyed singleton (collection, slot) ---------------------
    if (slot) {
      const cur = await pool.query('SELECT * FROM site_assets WHERE collection=$1 AND slot=$2', [collection, slot]);
      if (cur.rows.length > 0) {
        const row = cur.rows[0];
        if (variant === 'hover') {
          await deleteByUrls([row.hover_url, row.hover_webp_url]);
          const upd = await pool.query(
            `UPDATE site_assets SET hover_url=$1, hover_webp_url=$2, updated_at=CURRENT_TIMESTAMP WHERE id=$3 RETURNING *`,
            [processed.url, processed.webp_url || null, row.id]
          );
          return res.json(upd.rows[0]);
        }
        await deleteByUrls([row.url, row.webp_url, row.thumbnail_url]);
        const upd = await pool.query(
          `UPDATE site_assets
             SET kind=$1, url=$2, webp_url=$3, thumbnail_url=$4,
                 title=COALESCE($5,title), subtitle=COALESCE($6,subtitle),
                 link=COALESCE($7,link), alt_text=COALESCE($8,alt_text),
                 is_active=true, updated_at=CURRENT_TIMESTAMP
           WHERE id=$9 RETURNING *`,
          [kind, processed.url, processed.webp_url || null, processed.thumbnail_url || null,
            meta.title ?? null, meta.subtitle ?? null, meta.link ?? null, meta.alt_text ?? null, row.id]
        );
        return res.json(upd.rows[0]);
      }
      const ins = await pool.query(
        `INSERT INTO site_assets (collection, slot, kind, url, webp_url, thumbnail_url, title, subtitle, link, alt_text)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [collection, slot, kind, processed.url, processed.webp_url || null, processed.thumbnail_url || null,
          meta.title ?? null, meta.subtitle ?? null, meta.link ?? null, meta.alt_text ?? null]
      );
      return res.status(201).json(ins.rows[0]);
    }

    // 3) Append a new free list item ------------------------------------
    const mx = await pool.query(
      'SELECT COALESCE(MAX(sort_order),-1)+1 AS next FROM site_assets WHERE collection=$1',
      [collection]
    );
    const ins = await pool.query(
      `INSERT INTO site_assets (collection, kind, url, webp_url, thumbnail_url, title, subtitle, link, alt_text, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [collection, kind, processed.url, processed.webp_url || null, processed.thumbnail_url || null,
        meta.title ?? null, meta.subtitle ?? null, meta.link ?? null, meta.alt_text ?? null, mx.rows[0].next]
    );
    return res.status(201).json(ins.rows[0]);
  } catch (err) {
    console.error('Asset upload error:', err);
    res.status(500).json({ error: 'Failed to upload asset' });
  }
});

// ---------------------------------------------------------------------------
// Admin — reorder a collection: body { collection, ids: [id, id, ...] }
// ---------------------------------------------------------------------------
router.post('/reorder', verifyToken, isAdmin, async (req, res) => {
  const { collection, ids } = req.body || {};
  if (!collection || !Array.isArray(ids)) {
    return res.status(400).json({ error: 'collection and ids[] are required' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (let idx = 0; idx < ids.length; idx++) {
      await client.query(
        'UPDATE site_assets SET sort_order=$1, updated_at=CURRENT_TIMESTAMP WHERE id=$2 AND collection=$3',
        [idx, ids[idx], collection]
      );
    }
    await client.query('COMMIT');
    const { rows } = await client.query(
      'SELECT * FROM site_assets WHERE collection=$1 ORDER BY sort_order, id',
      [collection]
    );
    res.json(rows);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Asset reorder error:', err);
    res.status(500).json({ error: 'Failed to reorder assets' });
  } finally {
    client.release();
  }
});

// ---------------------------------------------------------------------------
// Admin — create a bare row (rarely needed; upload usually creates the row)
// ---------------------------------------------------------------------------
router.post('/', verifyToken, isAdmin, async (req, res) => {
  try {
    const { collection, slot, kind = 'image', title, subtitle, link, alt_text } = req.body;
    if (!collection) return res.status(400).json({ error: 'collection is required' });
    const mx = await pool.query(
      'SELECT COALESCE(MAX(sort_order),-1)+1 AS next FROM site_assets WHERE collection=$1',
      [collection]
    );
    const ins = await pool.query(
      `INSERT INTO site_assets (collection, slot, kind, title, subtitle, link, alt_text, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [collection, slot || null, kind, title || null, subtitle || null, link || null, alt_text || null, mx.rows[0].next]
    );
    res.status(201).json(ins.rows[0]);
  } catch (err) {
    console.error('Asset create error:', err);
    res.status(500).json({ error: 'Failed to create asset' });
  }
});

// ---------------------------------------------------------------------------
// Admin — update metadata only (never touches the stored file URLs)
// ---------------------------------------------------------------------------
router.put('/:id', verifyToken, isAdmin, async (req, res) => {
  try {
    const sets = [];
    const params = [];
    let i = 1;
    for (const f of ['title', 'subtitle', 'link', 'alt_text', 'sort_order', 'is_active', 'slot']) {
      if (f in req.body) {
        let v = req.body[f];
        if (f === 'sort_order') v = Number(v) || 0;
        else if (f === 'is_active') v = !!v;
        else if (v === '') v = null;
        sets.push(`${f} = $${i++}`);
        params.push(v);
      }
    }
    if (sets.length === 0) {
      const cur = await pool.query('SELECT * FROM site_assets WHERE id = $1', [req.params.id]);
      if (cur.rows.length === 0) return res.status(404).json({ error: 'Asset not found' });
      return res.json(cur.rows[0]);
    }
    params.push(req.params.id);
    const upd = await pool.query(
      `UPDATE site_assets SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $${i} RETURNING *`,
      params
    );
    if (upd.rows.length === 0) return res.status(404).json({ error: 'Asset not found' });
    res.json(upd.rows[0]);
  } catch (err) {
    console.error('Asset update error:', err);
    res.status(500).json({ error: 'Failed to update asset' });
  }
});

// ---------------------------------------------------------------------------
// Admin — delete a row and its S3 objects
// ---------------------------------------------------------------------------
router.delete('/:id', verifyToken, isAdmin, async (req, res) => {
  try {
    const cur = await pool.query('SELECT * FROM site_assets WHERE id = $1', [req.params.id]);
    if (cur.rows.length === 0) return res.status(404).json({ error: 'Asset not found' });
    const r = cur.rows[0];
    await deleteByUrls([r.url, r.webp_url, r.thumbnail_url, r.hover_url, r.hover_webp_url]);
    await pool.query('DELETE FROM site_assets WHERE id = $1', [req.params.id]);
    res.json({ message: 'Asset deleted' });
  } catch (err) {
    console.error('Asset delete error:', err);
    res.status(500).json({ error: 'Failed to delete asset' });
  }
});

module.exports = router;
