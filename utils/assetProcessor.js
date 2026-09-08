/**
 * Shared image/video processing + S3 upload for managed site assets.
 * Used by routes/assets.js (admin uploads) and scripts/seed-assets.js (initial import).
 *
 * Images  -> optimised main (JPEG or PNG, format preserved when the source has
 *            transparency) + a WebP twin + a small thumbnail. All public-read.
 * Videos  -> stored as-is (no transcoding available), public-read.
 * URLs returned are permanent public URLs (same scheme as product_images).
 */
const sharp = require('sharp');
const { v4: uuidv4 } = require('uuid');
const { PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const s3Client = require('../config/s3');
const { publicUrl, keyFromUrl } = require('../config/s3');

const BUCKET = process.env.AWS_BUCKET_NAME;
const IMMUTABLE = 'public, max-age=31536000, immutable';

// Max width per collection — generous, quality-first (these are paid photoshoots).
const MAX_WIDTH = {
  hero_banners: 2000,
  section_headers: 2000,
  backgrounds: 2000,
  showcase_videos: 2000, // poster images
  gifting: 1200,
  collection_cards: 1000,
  brand: 800,
  _default: 1800,
};

const sharpOpts = { unlimited: true, failOn: 'none' };

const put = (Key, Body, ContentType) =>
  s3Client.send(
    new PutObjectCommand({ Bucket: BUCKET, Key, Body, ContentType, ACL: 'public-read', CacheControl: IMMUTABLE })
  );

// Build a unique, human-readable base key: site-assets/<collection>/<slot?>-<uuid>
function baseKeyFor(collection, slot) {
  const safeSlot = (slot || '').toString().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const prefix = safeSlot ? `${safeSlot}-` : '';
  return `site-assets/${collection}/${prefix}${uuidv4()}`;
}

/**
 * Process one image buffer into {url, webp_url, thumbnail_url}.
 * Transparency is preserved (PNG stays PNG); opaque images become JPEG.
 */
async function processImage(buffer, { collection = '_default', slot } = {}) {
  const meta = await sharp(buffer, sharpOpts).metadata().catch(() => ({}));
  const hasAlpha = !!meta.hasAlpha || meta.format === 'png';
  const maxW = MAX_WIDTH[collection] || MAX_WIDTH._default;
  const base = baseKeyFor(collection, slot);

  const resized = () => sharp(buffer, sharpOpts).rotate().resize(maxW, null, { withoutEnlargement: true });
  const thumbBase = () => sharp(buffer, sharpOpts).rotate().resize(640, null, { withoutEnlargement: true });

  let mainBuf, mainKey, mainType, thumbBuf, thumbKey, thumbType;
  if (hasAlpha) {
    mainBuf = await resized().png({ compressionLevel: 9 }).toBuffer();
    mainKey = `${base}.png`;
    mainType = 'image/png';
    thumbBuf = await thumbBase().png({ compressionLevel: 9 }).toBuffer();
    thumbKey = `${base}-thumb.png`;
    thumbType = 'image/png';
  } else {
    mainBuf = await resized().jpeg({ quality: 88, mozjpeg: true }).toBuffer();
    mainKey = `${base}.jpg`;
    mainType = 'image/jpeg';
    thumbBuf = await thumbBase().jpeg({ quality: 78 }).toBuffer();
    thumbKey = `${base}-thumb.jpg`;
    thumbType = 'image/jpeg';
  }
  const webpBuf = await resized().webp({ quality: 84 }).toBuffer();
  const webpKey = `${base}.webp`;

  await Promise.all([
    put(mainKey, mainBuf, mainType),
    put(webpKey, webpBuf, 'image/webp'),
    put(thumbKey, thumbBuf, thumbType),
  ]);

  return { url: publicUrl(mainKey), webp_url: publicUrl(webpKey), thumbnail_url: publicUrl(thumbKey) };
}

/** Store a video buffer as-is. Returns {url}. */
async function processVideo(buffer, { collection = 'showcase_videos', slot, mimetype } = {}) {
  const sub = (mimetype || 'video/mp4').split('/')[1] || 'mp4';
  const ext = sub === 'quicktime' ? 'mov' : sub === 'x-matroska' ? 'mkv' : sub;
  const key = `${baseKeyFor(collection, slot)}.${ext}`;
  await put(key, buffer, mimetype || 'video/mp4');
  return { url: publicUrl(key) };
}

/** Best-effort delete of every S3 object behind the given public URLs. */
async function deleteByUrls(urls = []) {
  await Promise.allSettled(
    urls.filter(Boolean).map((u) => {
      const Key = keyFromUrl(u);
      if (!Key) return Promise.resolve();
      return s3Client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key }));
    })
  );
}

module.exports = { processImage, processVideo, deleteByUrls };
