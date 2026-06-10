const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const s3Client = require('../config/s3');
const { publicUrl, keyFromUrl } = require('../config/s3');
const { PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { verifyToken, isAdmin } = require('../middleware/auth');
const upload = require('../middleware/upload');
const sharp = require('sharp');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// Upload image for a product
router.post('/upload', verifyToken, isAdmin, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { product_id, is_primary = false, sort_order = 0, alt_text = '', color = null, color_hex = null } = req.body;

    if (!product_id) {
      return res.status(400).json({ error: 'Product ID is required' });
    }

    // Get product info for folder structure
    const productRes = await pool.query(`
      SELECT p.slug as product_slug, c.slug as category_slug, s.slug as section_slug
      FROM products p
      JOIN categories c ON p.category_id = c.id
      JOIN sections s ON c.section_id = s.id
      WHERE p.id = $1
    `, [product_id]);

    if (productRes.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const { product_slug, category_slug, section_slug } = productRes.rows[0];
    const basePath = `products/${section_slug}/${category_slug}/${product_slug}-${uuidv4()}`;
    const bucket = process.env.AWS_BUCKET_NAME;

    // 1. Process and upload Main JPEG (Max 1600px)
    const jpegBuffer = await sharp(req.file.buffer, { unlimited: true, failOn: 'none' })
      .resize(1600, null, { withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();
    
    const jpegKey = `${basePath}.jpg`;
    await s3Client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: jpegKey,
      Body: jpegBuffer,
      ContentType: 'image/jpeg',
      ACL: 'public-read'
    }));

    // 2. Process and upload WebP (Max 1600px)
    const webpBuffer = await sharp(req.file.buffer, { unlimited: true, failOn: 'none' })
      .resize(1600, null, { withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();
    
    const webpKey = `${basePath}.webp`;
    await s3Client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: webpKey,
      Body: webpBuffer,
      ContentType: 'image/webp',
      ACL: 'public-read'
    }));

    // 3. Process and upload Thumbnail (400px)
    const thumbBuffer = await sharp(req.file.buffer, { unlimited: true, failOn: 'none' })
      .resize(400, null, { withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();
    
    const thumbKey = `products/${section_slug}/${category_slug}/thumbs/${product_slug}-${uuidv4()}.jpg`;
    await s3Client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: thumbKey,
      Body: thumbBuffer,
      ContentType: 'image/jpeg',
      ACL: 'public-read'
    }));

    // Build public URLs
    const imageUrl = publicUrl(jpegKey);
    const webpUrl = publicUrl(webpKey);
    const thumbUrl = publicUrl(thumbKey);

    // Auto-mark as primary when it is the product's first image, plus append
    // it at the end of the sort order unless an explicit order was given.
    const existing = await pool.query(
      'SELECT COUNT(*)::int AS count, COALESCE(MAX(sort_order), -1) AS max_sort FROM product_images WHERE product_id = $1',
      [product_id]
    );
    const isFirst = existing.rows[0].count === 0;
    const requestedPrimary = is_primary === 'true' || is_primary === true;
    const primaryFlag = requestedPrimary || isFirst;
    const finalSortOrder = sort_order ? parseInt(sort_order, 10) : existing.rows[0].max_sort + 1;

    // Insert into DB
    const insertRes = await pool.query(`
      INSERT INTO product_images (product_id, image_url, webp_url, thumbnail_url, alt_text, color, color_hex, is_primary, sort_order)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `, [product_id, imageUrl, webpUrl, thumbUrl, alt_text, color || null, color_hex || null, primaryFlag, finalSortOrder]);

    // If this image is primary, unset primary on the others
    if (primaryFlag) {
      await pool.query(`
        UPDATE product_images
        SET is_primary = false
        WHERE product_id = $1 AND id != $2
      `, [product_id, insertRes.rows[0].id]);
    }

    res.status(201).json(insertRes.rows[0]);

  } catch (err) {
    console.error('Upload Error:', err);
    res.status(500).json({ error: 'Failed to upload image' });
  }
});

// Upload a standalone site asset (e.g. home banner) to S3 — not tied to a product
router.post('/upload-asset', verifyToken, isAdmin, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const folder = (req.body.folder || 'banners').replace(/[^a-z0-9/_-]/gi, '') || 'banners';
    const maxWidth = parseInt(req.body.max_width, 10) || 1920;
    const base = `${folder}/${uuidv4()}`;
    const bucket = process.env.AWS_BUCKET_NAME;

    const jpegBuffer = await sharp(req.file.buffer, { unlimited: true, failOn: 'none' })
      .resize(maxWidth, null, { withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toBuffer();
    const jpegKey = `${base}.jpg`;
    await s3Client.send(new PutObjectCommand({ Bucket: bucket, Key: jpegKey, Body: jpegBuffer, ContentType: 'image/jpeg', ACL: 'public-read' }));

    const webpBuffer = await sharp(req.file.buffer, { unlimited: true, failOn: 'none' })
      .resize(maxWidth, null, { withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();
    const webpKey = `${base}.webp`;
    await s3Client.send(new PutObjectCommand({ Bucket: bucket, Key: webpKey, Body: webpBuffer, ContentType: 'image/webp', ACL: 'public-read' }));

    res.status(201).json({ image_url: publicUrl(jpegKey), webp_url: publicUrl(webpKey) });
  } catch (err) {
    console.error('Asset Upload Error:', err);
    res.status(500).json({ error: 'Failed to upload asset' });
  }
});

// Delete a standalone site asset from S3 by URL (best-effort; also removes the .webp sibling)
router.delete('/asset', verifyToken, isAdmin, async (req, res) => {
  try {
    const url = req.query.url || req.body?.url;
    if (!url) return res.status(400).json({ error: 'url is required' });
    const jpegKey = keyFromUrl(url);
    if (!jpegKey) return res.json({ message: 'Nothing to delete' });
    const bucket = process.env.AWS_BUCKET_NAME;
    const webpKey = jpegKey.replace(/\.(jpe?g|png|webp)$/i, '.webp');
    await Promise.allSettled([
      s3Client.send(new DeleteObjectCommand({ Bucket: bucket, Key: jpegKey })),
      webpKey !== jpegKey ? s3Client.send(new DeleteObjectCommand({ Bucket: bucket, Key: webpKey })) : Promise.resolve(),
    ]);
    res.json({ message: 'Asset deleted' });
  } catch (err) {
    console.error('Asset Delete Error:', err);
    res.status(500).json({ error: 'Failed to delete asset' });
  }
});

// Delete image
router.delete('/:id', verifyToken, isAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Get image details from DB
    const imgRes = await pool.query('SELECT * FROM product_images WHERE id = $1', [id]);
    if (imgRes.rows.length === 0) {
      return res.status(404).json({ error: 'Image not found' });
    }
    
    const image = imgRes.rows[0];
    
    // Extract Keys from stored URLs
    const jpegKey = keyFromUrl(image.image_url);
    const webpKey = keyFromUrl(image.webp_url);
    const thumbKey = keyFromUrl(image.thumbnail_url);

    // Delete from S3
    const bucket = process.env.AWS_BUCKET_NAME;
    const deletePromises = [];
    if (jpegKey) deletePromises.push(s3Client.send(new DeleteObjectCommand({ Bucket: bucket, Key: jpegKey })));
    if (webpKey) deletePromises.push(s3Client.send(new DeleteObjectCommand({ Bucket: bucket, Key: webpKey })));
    if (thumbKey) deletePromises.push(s3Client.send(new DeleteObjectCommand({ Bucket: bucket, Key: thumbKey })));
    
    await Promise.allSettled(deletePromises);

    // Delete from DB
    await pool.query('DELETE FROM product_images WHERE id = $1', [id]);

    res.json({ message: 'Image deleted successfully' });
  } catch (err) {
    console.error('Delete Error:', err);
    res.status(500).json({ error: 'Failed to delete image' });
  }
});

// Update image details (is_primary, sort_order, alt_text, color)
router.put('/:id', verifyToken, isAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { is_primary } = req.body;

    const imgRes = await pool.query('SELECT product_id FROM product_images WHERE id = $1', [id]);
    if (imgRes.rows.length === 0) {
      return res.status(404).json({ error: 'Image not found' });
    }
    const product_id = imgRes.rows[0].product_id;

    if (is_primary === true) {
      await pool.query('UPDATE product_images SET is_primary = false WHERE product_id = $1', [product_id]);
    }

    // Only update fields actually present in the request body, so e.g. a
    // "set primary" call ({ is_primary: true }) does not wipe colour variants.
    const sets = [];
    const params = [];
    let i = 1;
    for (const field of ['alt_text', 'is_primary', 'sort_order', 'color', 'color_hex']) {
      if (field in req.body) {
        sets.push(`${field} = $${i++}`);
        params.push(req.body[field] === '' ? null : req.body[field]);
      }
    }

    if (sets.length === 0) {
      const current = await pool.query('SELECT * FROM product_images WHERE id = $1', [id]);
      return res.json(current.rows[0]);
    }

    params.push(id);
    const result = await pool.query(
      `UPDATE product_images SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
      params
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Update Error:', err);
    res.status(500).json({ error: 'Failed to update image details' });
  }
});

module.exports = router;
