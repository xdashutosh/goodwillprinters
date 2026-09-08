/**
 * One-time import of every bundled marketing asset (banners, showcase videos,
 * section headers, collection-card art, home gifting images, backgrounds and
 * brand logos) into S3 + the site_assets table.
 *
 *   Preview (no uploads, no writes):   node scripts/seed-assets.js
 *   Execute (uploads to S3 + DB):      EXECUTE=1 node scripts/seed-assets.js
 *
 * Idempotent: rows are keyed by (collection, slot). A row that already has a
 * url is left untouched, so re-running only fills in what is missing. The
 * original files in frontend/ are never modified or removed — this only copies.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { processImage, processVideo } = require('../utils/assetProcessor');

const FE = path.join(__dirname, '../../frontend');
const DRY = process.env.EXECUTE !== '1';

// REPROCESS="collection_cards/diaries,gifting/trump"  (or "*")
// Forces a fresh upload + row update even when the row already has a file.
// Metadata already on the row is preserved (COALESCE), so admin edits survive.
const FORCE = new Set((process.env.REPROCESS || '').split(',').map((s) => s.trim()).filter(Boolean));
const forced = (collection, slot) => FORCE.has('*') || FORCE.has(`${collection}/${slot}`);

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function q(text, params, tries = 6) {
  let last;
  for (let i = 1; i <= tries; i++) {
    try {
      return await pool.query(text, params);
    } catch (e) {
      last = e;
      if (i === tries) throw e;
      console.log(`  …db not ready (${e.code || e.message}); retry ${i}/${tries - 1}`);
      await sleep(Math.min(3000 * i, 12000));
    }
  }
  throw last;
}

// Upload a fresh, independent copy per asset slot. (No cross-slot de-dup: two
// rows must never share the same S3 object, or deleting one would break the
// other — e.g. a video poster and a collection card built from the same file.)
async function procImage(relPath, opts) {
  const buf = fs.readFileSync(path.join(FE, relPath));
  return processImage(buf, opts);
}

// slot-keyed asset manifest ------------------------------------------------
const IMAGES = [
  // --- Section header banners ---
  { collection: 'section_headers', slot: 'diaries', file: 'src/assets/header/diary.png', title: 'Diaries', alt_text: 'Premium diaries by Goodwill Printers' },
  { collection: 'section_headers', slot: 'notebooks', file: 'src/assets/header/notebook.png', title: 'Notebooks', alt_text: 'Premium notebooks by Goodwill Printers' },
  { collection: 'section_headers', slot: 'organizers', file: 'src/assets/header/organizer.png', title: 'Organizers', alt_text: 'Professional organizers by Goodwill Printers' },
  { collection: 'section_headers', slot: 'corporate-gifts', file: 'src/assets/header/corporate.png', title: 'Corporate Gifts', alt_text: 'Corporate gifting by Goodwill Printers' },

  // --- "Our Collections" card art ---
  { collection: 'collection_cards', slot: 'diaries', file: 'public/collections/diaries.png', title: 'Diaries', alt_text: 'Diaries collection' },
  { collection: 'collection_cards', slot: 'notebooks', file: 'public/collections/notebooks.png', title: 'Notebooks', alt_text: 'Notebooks collection' },
  { collection: 'collection_cards', slot: 'organizers', file: 'public/collections/organizers.png', title: 'Organizers', alt_text: 'Organizers collection' },
  { collection: 'collection_cards', slot: 'corporate-gifts', file: 'public/collections/corporate-gifts.png', title: 'Corporate Gifts', alt_text: 'Corporate gifts collection' },
  { collection: 'collection_cards', slot: 'default', file: 'public/collections/our-collections.jpg', title: 'Our Collections', alt_text: 'Goodwill Printers collections' },
  { collection: 'collection_cards', slot: 'travel-kit', file: 'public/collections/travel-kit.png', title: 'Travel Kit', alt_text: 'Travel document kit' },

  // --- Home gifting range (main + hover) ---
  { collection: 'gifting', slot: 'doc-kit', sort: 0, file: 'src/assets/Doc.kit.png', hover: 'src/assets/on hover/Doc kit.png', title: 'Doc Kit', subtitle: 'A secure travel document organiser that keeps passports, cards and boarding passes together.', link: '/product/doc-kit-corporate-gifts', alt_text: 'Doc Kit — secure travel document organiser' },
  { collection: 'gifting', slot: 'trump', sort: 1, file: 'src/assets/trump.png', hover: 'src/assets/on hover/trump.png', title: 'Trump Folder', subtitle: 'A structured executive folder notebook with a firm cover and organised slots for documents and cards.', link: '/notebooks/trump-folder', alt_text: 'Trump Folder — corporate gift' },
  { collection: 'gifting', slot: 'astra', sort: 2, file: 'src/assets/astra.png', hover: 'src/assets/on hover/astra.png', title: 'Astra', subtitle: 'A slimline leatherette card and document holder with smart slots for cards, cash and travel papers.', link: '/product/astra-corporate-gifts', alt_text: 'Astra — corporate gift' },
  { collection: 'gifting', slot: 'fashion', sort: 3, file: 'src/assets/fashion.png', hover: 'src/assets/on hover/fashion.png', title: 'Fashion Book', subtitle: 'A zip-around organiser pairing a phone pocket, card slots and a notepad — a sleek, premium gift.', link: '/product/fashion-corporate-gifts', alt_text: 'Fashion Book — corporate gift' },
  { collection: 'gifting', slot: 'guest', sort: 4, file: 'src/assets/guest.png', hover: 'src/assets/on hover/guest.png', title: 'Guest Book', subtitle: 'A debossed faux-leather guest book that adds a premium touch to weddings, launches and corporate events.', link: '/product/guest-book-corporate-gifts', alt_text: 'Guest Book — corporate gift' },

  // --- Backgrounds / posters ---
  { collection: 'backgrounds', slot: 'poster_2027', file: 'src/assets/2027collection.png', title: 'The 2027 Collection', alt_text: 'Goodwill Printers — 2027 Collection' },
  { collection: 'backgrounds', slot: 'cta_bg', file: 'src/assets/elevate.png', title: 'Closing CTA background', alt_text: '' },
  { collection: 'backgrounds', slot: 'contact_bg', file: 'src/assets/contactus backgroung.png', title: 'Contact page background', alt_text: '' },

  // --- Brand logos ---
  { collection: 'brand', slot: 'logo_primary', file: 'public/brand/goodwill-printers.png', title: 'Goodwill Printers logo', alt_text: 'Goodwill Printers' },
  { collection: 'brand', slot: 'logo_footer', file: 'public/brand/plan-a-day.png', title: 'Plan.A.Day logo', alt_text: 'Plan.A.Day by Goodwill Printers' },
];

// Showcase video reel — order preserved from the original component.
const VIDEOS = [
  { slot: 'video-1', sort: 0, file: 'public/videos/video1.mp4', poster: 'public/collections/diaries.png', title: 'Diaries', subtitle: 'Premium New Year diaries', link: '/diaries' },
  { slot: 'video-2', sort: 1, file: 'public/videos/video2.mp4', poster: 'public/collections/notebooks.png', title: 'Notebooks', subtitle: 'Notebooks & folders', link: '/notebooks' },
  { slot: 'video-6', sort: 2, file: 'public/videos/video6.mp4', poster: 'public/collections/travel-kit.png', title: 'Travel Kit', subtitle: 'Smart travel document organiser', link: '/corporate-gifts' },
  { slot: 'video-5', sort: 3, file: 'public/videos/video5.mp4', poster: 'public/collections/notebooks.png', title: 'Notebooks', subtitle: 'Notebooks & folders', link: '/notebooks' },
  { slot: 'video-3', sort: 4, file: 'public/videos/video3.mp4', poster: 'public/collections/organizers.png', title: 'Organizers', subtitle: 'Professional organizers', link: '/organizers' },
  { slot: 'video-4', sort: 5, file: 'public/videos/video4.mp4', poster: 'public/collections/corporate-gifts.png', title: 'Corporate Gifts', subtitle: 'Premium corporate gifting', link: '/corporate-gifts' },
];

async function getRow(collection, slot) {
  const r = await q('SELECT * FROM site_assets WHERE collection=$1 AND slot=$2', [collection, slot]);
  return r.rows[0] || null;
}

async function upsertImage(item, idx) {
  const { collection, slot } = item;
  const existing = await getRow(collection, slot);
  if (existing && existing.url && !forced(collection, slot)) {
    console.log(`  = ${collection}/${slot} — already imported, skipped`);
    return;
  }
  const abs = path.join(FE, item.file);
  if (!fs.existsSync(abs)) {
    console.warn(`  ! source missing: ${item.file} — skipped`);
    return;
  }
  if (DRY) {
    console.log(`  + ${collection}/${slot}  <- ${item.file}${item.hover ? '  (+hover)' : ''}`);
    return;
  }
  const main = await procImage(item.file, { collection, slot });
  let hover = { url: null, webp_url: null };
  if (item.hover && fs.existsSync(path.join(FE, item.hover))) {
    hover = await procImage(item.hover, { collection, slot: `${slot}-hover` });
  }
  const sort = item.sort != null ? item.sort : idx;
  if (existing) {
    await q(
      `UPDATE site_assets SET kind='image', url=$1, webp_url=$2, thumbnail_url=$3, hover_url=$4, hover_webp_url=$5,
         title=COALESCE(title,$6), subtitle=COALESCE(subtitle,$7), link=COALESCE(link,$8), alt_text=COALESCE(alt_text,$9),
         updated_at=CURRENT_TIMESTAMP WHERE id=$10`,
      [main.url, main.webp_url, main.thumbnail_url, hover.url, hover.webp_url,
        item.title || null, item.subtitle || null, item.link || null, item.alt_text || null, existing.id]
    );
  } else {
    await q(
      `INSERT INTO site_assets (collection, slot, kind, url, webp_url, thumbnail_url, hover_url, hover_webp_url, title, subtitle, link, alt_text, sort_order)
       VALUES ($1,$2,'image',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [collection, slot, main.url, main.webp_url, main.thumbnail_url, hover.url, hover.webp_url,
        item.title || null, item.subtitle || null, item.link || null, item.alt_text || null, sort]
    );
  }
  console.log(`  ✓ ${collection}/${slot}`);
}

async function upsertVideo(item) {
  const existing = await getRow('showcase_videos', item.slot);
  if (existing && existing.url && !forced('showcase_videos', item.slot)) {
    console.log(`  = showcase_videos/${item.slot} — already imported, skipped`);
    return;
  }
  const abs = path.join(FE, item.file);
  if (!fs.existsSync(abs)) {
    console.warn(`  ! source missing: ${item.file} — skipped`);
    return;
  }
  if (DRY) {
    console.log(`  + showcase_videos/${item.slot}  <- ${item.file}  (poster: ${item.poster})`);
    return;
  }
  const vid = await processVideo(fs.readFileSync(abs), { collection: 'showcase_videos', slot: item.slot, mimetype: 'video/mp4' });
  const poster = await procImage(item.poster, { collection: 'showcase_videos', slot: `${item.slot}-poster` });
  if (existing) {
    await q(
      `UPDATE site_assets SET kind='video', url=$1, thumbnail_url=$2,
         title=COALESCE(title,$3), subtitle=COALESCE(subtitle,$4), link=COALESCE(link,$5),
         updated_at=CURRENT_TIMESTAMP WHERE id=$6`,
      [vid.url, poster.url, item.title || null, item.subtitle || null, item.link || null, existing.id]
    );
  } else {
    await q(
      `INSERT INTO site_assets (collection, slot, kind, url, thumbnail_url, title, subtitle, link, sort_order)
       VALUES ('showcase_videos',$1,'video',$2,$3,$4,$5,$6,$7)`,
      [item.slot, vid.url, poster.url, item.title || null, item.subtitle || null, item.link || null, item.sort]
    );
  }
  console.log(`  ✓ showcase_videos/${item.slot}`);
}

async function migrateLegacyBanners() {
  const s = await q(`SELECT value FROM site_settings WHERE key = 'banners'`);
  let legacy = [];
  try { legacy = JSON.parse(s.rows[0]?.value || '[]'); } catch { legacy = []; }
  legacy = Array.isArray(legacy) ? legacy.filter((b) => b && b.image_url) : [];
  if (!legacy.length) {
    console.log('  (no legacy site_settings.banners to migrate)');
    return;
  }
  for (let i = 0; i < legacy.length; i++) {
    const slot = `banner-${i + 1}`;
    const existing = await getRow('hero_banners', slot);
    if (existing) { console.log(`  = hero_banners/${slot} — already present`); continue; }
    if (DRY) { console.log(`  + hero_banners/${slot}  <- ${legacy[i].image_url}`); continue; }
    await q(
      `INSERT INTO site_assets (collection, slot, kind, url, title, link, sort_order)
       VALUES ('hero_banners',$1,'image',$2,$3,$4,$5)`,
      [slot, legacy[i].image_url, legacy[i].title || null, legacy[i].link || null, i]
    );
    console.log(`  ✓ hero_banners/${slot}`);
  }
}

(async () => {
  console.log(`\n${DRY ? '🔎 DRY RUN — no S3 uploads, no DB writes' : '🚀 EXECUTE — uploading assets to S3 + writing site_assets'}`);
  console.log(`Frontend source dir: ${FE}\n`);
  await q('SELECT 1');

  console.log('[1/4] Hero banners (migrate from site_settings.banners)…');
  await migrateLegacyBanners();

  console.log('\n[2/4] Showcase videos…');
  for (const v of VIDEOS) await upsertVideo(v);

  console.log('\n[3/4] Images (section headers, collection cards, gifting, backgrounds, logos)…');
  for (let i = 0; i < IMAGES.length; i++) await upsertImage(IMAGES[i], i);

  console.log('\n[4/4] Summary');
  const { rows } = await q(
    `SELECT collection, COUNT(*)::int n, COUNT(url)::int with_file FROM site_assets GROUP BY collection ORDER BY collection`
  );
  for (const r of rows) console.log(`  ${r.collection.padEnd(18)} ${r.with_file}/${r.n} with a stored file`);

  console.log(DRY ? '\nDry run only. Re-run with EXECUTE=1 to apply.\n' : '\n✅ Done. Original files in frontend/ are untouched.\n');
  await pool.end();
  process.exit(0);
})().catch(async (e) => {
  console.error('FATAL:', e);
  try { await pool.end(); } catch {}
  process.exit(1);
});
