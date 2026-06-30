/**
 * Ingest the "A5 & B5 Size Inside Layout & New Diary Design" folder.
 *
 *   Dry run (default — no writes, no uploads):
 *     node scripts/upload-inside-layout.js
 *   Execute (uploads to S3 + writes to the live DB):
 *     EXECUTE=1 node scripts/upload-inside-layout.js
 *
 * What it does (confirmed with the owner):
 *   1. Creates 3 new cover designs — Benin, Serbia, Mobilize — in diaries/a5-daily
 *      (1 cover image each).
 *   2. Uploads the 15 inside-layout photos to S3 ONCE (8 A5 + 7 B5) and records
 *      their URLs in a manifest so re-runs reuse them.
 *   3. Attaches the size-matched inside-look set to every Diaries + Notebooks
 *      product as extra (non-primary) gallery images:
 *         - B5-size products      -> B5 set (7 photos)
 *         - everything else       -> A5 set (8 photos)  [A5 as fallback]
 *      Idempotent & self-healing: products are matched by slug, images by
 *      image_url, so a crash mid-run is fully recoverable by re-running.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { PutObjectCommand } = require('@aws-sdk/client-s3');
const { v4: uuidv4 } = require('uuid');
const { Pool } = require('pg');
const s3Client = require('../config/s3');
const { publicUrl } = require('../config/s3');
const generateSlug = require('../utils/slugify');

// Dedicated pool with a generous connect timeout so Neon cold-starts don't fail the run.
const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  connectionTimeoutMillis: 30000,
  keepAlive: true,
});
pool.on('error', (e) => console.log('  (pool idle error, recovering):', e.message));

const DRY_RUN = process.env.EXECUTE !== '1';
const FOLDER = path.join(
  __dirname,
  '../../TransferNow-A5 & B5 Size Inside Layout & New Diary Design'
);
const MANIFEST = path.join(__dirname, '.inside-layout-manifest.json');
const INSIDE_SORT_BASE = 100; // push inside-look images after cover/colour images

const COVERS = [
  { name: 'Benin', file: 'Benin-02.tif' },
  { name: 'Serbia', file: 'Serbia-01.tif' },
  { name: 'Mobilize', file: 'Mobilize-01.tif' },
];

// Neon's pooler drops idle connections; retry transient failures so a long run
// survives mid-loop drops instead of crashing.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function q(text, params, tries = 8) {
  let lastErr;
  for (let i = 1; i <= tries; i++) {
    try {
      return await pool.query(text, params);
    } catch (e) {
      lastErr = e;
      const NET_CODES = ['ECONNRESET', 'ETIMEDOUT', 'EADDRNOTAVAIL', 'ENETUNREACH', 'EHOSTUNREACH', 'ECONNREFUSED', 'EPIPE', 'EAI_AGAIN'];
      const transient = NET_CODES.includes(e.code) || /timeout|terminat|connection|socket|read econn/i.test(e.message || '');
      if (!transient || i === tries) throw e;
      const wait = Math.min(3000 * i, 12000); // back off so Neon has time to wake
      console.log(`  …db hiccup (${e.code || e.message}); waiting ${wait}ms then retry ${i}/${tries - 1}`);
      await sleep(wait);
    }
  }
  throw lastErr;
}

function insideFiles(prefix) {
  return fs
    .readdirSync(FOLDER)
    .filter((f) => f.toLowerCase().startsWith(prefix) && f.toLowerCase().endsWith('.tif'))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

const sharpOpts = { unlimited: true, failOn: 'none' };

async function uploadDerivatives(fileBuffer, keyBase, thumbBase) {
  const bucket = process.env.AWS_BUCKET_NAME;
  const jpeg = await sharp(fileBuffer, sharpOpts).resize(1600, null, { withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
  const webp = await sharp(fileBuffer, sharpOpts).resize(1600, null, { withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
  const thumb = await sharp(fileBuffer, sharpOpts).resize(400, null, { withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
  const jpegKey = `${keyBase}.jpg`;
  const webpKey = `${keyBase}.webp`;
  const thumbKey = `${thumbBase}.jpg`;
  await s3Client.send(new PutObjectCommand({ Bucket: bucket, Key: jpegKey, Body: jpeg, ContentType: 'image/jpeg', ACL: 'public-read' }));
  await s3Client.send(new PutObjectCommand({ Bucket: bucket, Key: webpKey, Body: webp, ContentType: 'image/webp', ACL: 'public-read' }));
  await s3Client.send(new PutObjectCommand({ Bucket: bucket, Key: thumbKey, Body: thumb, ContentType: 'image/jpeg', ACL: 'public-read' }));
  return { jpeg: publicUrl(jpegKey), webp: publicUrl(webpKey), thumb: publicUrl(thumbKey) };
}

// Upload the 15 inside photos once; reuse via manifest on subsequent runs.
async function ensureInsideUploaded() {
  if (fs.existsSync(MANIFEST)) {
    const m = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
    if (m.a5?.length && m.b5?.length) {
      console.log(`  reusing manifest (${m.a5.length} A5 + ${m.b5.length} B5 already on S3)`);
      return m;
    }
  }
  const manifest = { a5: [], b5: [] };
  for (const [size, prefix] of [['a5', 'a5 size inside layout'], ['b5', 'b5 size inside layout']]) {
    const files = insideFiles(prefix);
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      console.log(`  uploading inside ${size.toUpperCase()} ${i + 1}/${files.length}: ${file}`);
      const buf = fs.readFileSync(path.join(FOLDER, file));
      const id = uuidv4();
      const urls = await uploadDerivatives(
        buf,
        `products/inside-layout/${size}/${size}-inside-${i + 1}-${id}`,
        `products/inside-layout/${size}/thumbs/${size}-inside-${i + 1}-${id}`
      );
      manifest[size].push({ ...urls, file });
    }
  }
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
  console.log('  manifest written.');
  return manifest;
}

async function getCategoryId(sectionSlug, categorySlug) {
  const r = await q(
    `SELECT c.id FROM categories c JOIN sections s ON c.section_id = s.id WHERE s.slug=$1 AND c.slug=$2`,
    [sectionSlug, categorySlug]
  );
  return r.rows.length ? r.rows[0].id : null;
}

(async () => {
  console.log(`\n${DRY_RUN ? '🔎 DRY RUN — no S3 uploads, no DB writes' : '🚀 EXECUTE — uploading to S3 + writing to live DB'}`);
  console.log(`Folder: ${FOLDER}\n`);

  await q('SELECT 1'); // warm up Neon (retries until awake)

  const a5 = insideFiles('a5 size inside layout');
  const b5 = insideFiles('b5 size inside layout');
  console.log(`Inside sets found on disk: A5=${a5.length} photos, B5=${b5.length} photos`);
  console.log(`New covers: ${COVERS.map((c) => c.name).join(', ')}\n`);

  const targets = await q(`
    SELECT p.id, p.name, c.slug AS cat, c.size_label,
           (SELECT COUNT(*) FROM product_images pi WHERE pi.product_id = p.id) AS imgs
    FROM products p
    JOIN categories c ON p.category_id = c.id
    JOIN sections s ON c.section_id = s.id
    WHERE s.slug IN ('diaries','notebooks')
    ORDER BY c.slug, p.name
  `);

  const setFor = (sizeLabel) => (String(sizeLabel).toUpperCase() === 'B5' ? 'b5' : 'a5');
  let b5Count = 0, a5Count = 0;
  for (const t of targets.rows) (setFor(t.size_label) === 'b5' ? (b5Count++) : (a5Count++));
  const a5ProductsAfter = a5Count + COVERS.length;
  const insideRows = a5ProductsAfter * a5.length + b5Count * b5.length;

  console.log('=== PLAN ===');
  console.log(`Diaries+Notebooks products in scope: ${targets.rows.length}  (+${COVERS.length} new covers = ${targets.rows.length + COVERS.length})`);
  console.log(`  → B5-set products: ${b5Count}  × ${b5.length} photos`);
  console.log(`  → A5-set products: ${a5ProductsAfter}  × ${a5.length} photos  (incl. fallback for A4/A6/no-size + 3 new covers)`);
  console.log(`Inside-look image rows to insert (fresh): ~${insideRows}`);
  console.log(`Cover product images: ${COVERS.length}`);
  console.log(`Distinct S3 objects to upload: ${(a5.length + b5.length + COVERS.length)} images × 3 = ${(a5.length + b5.length + COVERS.length) * 3}`);
  console.log('');

  if (DRY_RUN) {
    console.log('Dry run only. Re-run with EXECUTE=1 to apply.');
    await pool.end();
    process.exit(0);
  }

  // ===== EXECUTE =====
  // 1) Covers — create product if missing, then ensure it has its cover image (self-healing).
  const a5DailyId = await getCategoryId('diaries', 'a5-daily');
  console.log('\n[1/3] Creating cover products…');
  for (const cover of COVERS) {
    const slug = generateSlug(`${cover.name}-A5 Daily`);
    let prod = await q('SELECT id FROM products WHERE slug=$1', [slug]);
    let pid;
    if (prod.rows.length) {
      pid = prod.rows[0].id;
      console.log(`  • ${cover.name}: product exists (id=${pid})`);
    } else {
      const ins = await q(
        `INSERT INTO products (category_id, name, slug, cover_style) VALUES ($1,$2,$3,$4) RETURNING id`,
        [a5DailyId, cover.name, slug, cover.name]
      );
      pid = ins.rows[0].id;
      console.log(`  ✓ ${cover.name} created (id=${pid})`);
    }
    const hasImg = await q('SELECT COUNT(*) c FROM product_images WHERE product_id=$1', [pid]);
    if (parseInt(hasImg.rows[0].c, 10) === 0) {
      const buf = fs.readFileSync(path.join(FOLDER, cover.file));
      const id = uuidv4();
      const urls = await uploadDerivatives(
        buf,
        `products/diaries/a5-daily/${slug}-${id}`,
        `products/diaries/a5-daily/thumbs/${slug}-${id}`
      );
      await q(
        `INSERT INTO product_images (product_id, image_url, webp_url, thumbnail_url, alt_text, is_primary, sort_order)
         VALUES ($1,$2,$3,$4,$5,true,0)`,
        [pid, urls.jpeg, urls.webp, urls.thumb, cover.name]
      );
      console.log(`    + cover image uploaded`);
    }
  }

  // 2) Inside photos to S3 (once)
  console.log('\n[2/3] Ensuring inside-layout photos are on S3…');
  const manifest = await ensureInsideUploaded();

  // 3) Attach inside look to all Diaries + Notebooks (re-query to include new covers)
  console.log('\n[3/3] Attaching inside-look images to products…');
  const finalTargets = await q(`
    SELECT p.id, p.name, c.size_label,
           (SELECT COUNT(*) FROM product_images pi WHERE pi.product_id = p.id) AS imgs
    FROM products p
    JOIN categories c ON p.category_id = c.id
    JOIN sections s ON c.section_id = s.id
    WHERE s.slug IN ('diaries','notebooks')
    ORDER BY c.slug, p.name
  `);

  let inserted = 0, skipped = 0, productsTouched = 0, done = 0;
  for (const t of finalTargets.rows) {
    done++;
    const set = manifest[setFor(t.size_label)];
    const have = new Set(
      (await q('SELECT image_url FROM product_images WHERE product_id=$1', [t.id])).rows.map((r) => r.image_url)
    );
    const missing = set.filter((img) => !have.has(img.jpeg));
    if (!missing.length) { skipped++; continue; }

    const values = [];
    const params = [];
    let pi = 1;
    const hadNoImages = parseInt(t.imgs, 10) === 0;
    missing.forEach((img, idx) => {
      const altText = `${setFor(t.size_label).toUpperCase()} Inside Look`;
      const isPrimary = hadNoImages && idx === 0;
      values.push(`($${pi++},$${pi++},$${pi++},$${pi++},$${pi++},$${pi++},$${pi++})`);
      params.push(t.id, img.jpeg, img.webp, img.thumb, altText, isPrimary, INSIDE_SORT_BASE + idx);
    });
    await q(
      `INSERT INTO product_images (product_id, image_url, webp_url, thumbnail_url, alt_text, is_primary, sort_order) VALUES ${values.join(',')}`,
      params
    );
    inserted += missing.length;
    productsTouched++;
    if (done % 25 === 0) console.log(`    …${done}/${finalTargets.rows.length} products processed (${inserted} images so far)`);
  }

  console.log('\n────────────────────────────────────────');
  console.log(`Products given an inside look : ${productsTouched}`);
  console.log(`Inside-look images inserted   : ${inserted}`);
  console.log(`Products already up to date   : ${skipped}`);
  console.log('\n✅ Done.');
  await pool.end();
  process.exit(0);
})().catch(async (e) => {
  console.error('FATAL:', e);
  try { await pool.end(); } catch {}
  process.exit(1);
});
