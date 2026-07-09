/**
 * Per-product website content.
 *
 *   1) Export product context for the generation workflow:
 *        node scripts/enrich-products.js export
 *      -> writes /tmp/gp-products.json  (id, slug, name, section, category, size, type, coverStyle)
 *
 *   2) After the workflow writes batch files to /tmp/gp-product-content/*.json,
 *      preview / apply them to the DB:
 *        node scripts/enrich-products.js            # dry-run preview
 *        EXECUTE=1 node scripts/enrich-products.js  # apply to live DB
 *
 * The LLM provides: description, short_description, goodPoints[], unique, quality.
 * This script adds deterministic, factual specifications + SEO meta, then upserts.
 * Idempotent: re-running re-applies by product id.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const MODE = process.argv[2] === 'export' ? 'export' : 'apply';
const DRY_RUN = process.env.EXECUTE !== '1';
const PRODUCTS_FILE = '/tmp/gp-products.json';
const CONTENT_DIR = '/tmp/gp-product-content';

const pool = new Pool({
  host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER,
  password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  connectionTimeoutMillis: 30000, keepAlive: true,
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function q(text, params, tries = 8) {
  let last;
  for (let i = 1; i <= tries; i++) {
    try { return await pool.query(text, params); }
    catch (e) {
      last = e;
      const net = ['ECONNRESET','ETIMEDOUT','EADDRNOTAVAIL','ENETUNREACH','EHOSTUNREACH','ECONNREFUSED','EPIPE','EAI_AGAIN'].includes(e.code);
      if (!(net || /timeout|terminat|connection|socket/i.test(e.message || '')) || i === tries) throw e;
      await sleep(Math.min(3000 * i, 12000));
    }
  }
  throw last;
}

const DIM = { A4: '210 × 297 mm', A5: '148 × 210 mm', A6: '105 × 148 mm', B5: '176 × 250 mm' };

function buildSpecs(p) {
  const kind = p.section === 'diaries' ? 'Diary' : p.section === 'notebooks' ? 'Notebook' : p.section === 'organizers' ? 'Organiser' : 'Product';
  const fmt = [p.size, p.type].filter(Boolean).join(' ');
  const specs = [{ label: 'Format', value: `${fmt ? fmt + ' ' : ''}${kind}` }];
  if (DIM[p.size]) specs.push({ label: 'Dimensions', value: `${DIM[p.size]} (${p.size})` });
  if (p.type === 'Daily') specs.push({ label: 'Layout', value: 'One day per page' });
  else if (p.type === 'Weekly') specs.push({ label: 'Layout', value: 'Week to view' });
  specs.push({ label: 'Design', value: p.coverStyle || p.name });
  specs.push({ label: 'Personalisation', value: 'Logo foiling, embossing & printing' });
  return specs;
}

async function loadProducts() {
  const res = await q(`
    SELECT p.id, p.slug, p.name, p.cover_style AS "coverStyle",
           c.name AS "categoryName", c.slug AS category, c.size_label AS size, c.type_label AS type,
           s.name AS "sectionName", s.slug AS section
    FROM products p
    JOIN categories c ON p.category_id = c.id
    JOIN sections s ON c.section_id = s.id
    ORDER BY p.id
  `);
  return res.rows;
}

async function doExport() {
  const rows = await loadProducts();
  fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(rows, null, 2));
  console.log(`Exported ${rows.length} products -> ${PRODUCTS_FILE}`);
  await pool.end();
}

function readBatches() {
  if (!fs.existsSync(CONTENT_DIR)) return [];
  const out = [];
  for (const f of fs.readdirSync(CONTENT_DIR)) {
    if (!f.endsWith('.json')) continue;
    try {
      const arr = JSON.parse(fs.readFileSync(path.join(CONTENT_DIR, f), 'utf8'));
      if (Array.isArray(arr)) out.push(...arr);
      else console.warn(`  [!] ${f}: not an array, skipped`);
    } catch (e) {
      console.warn(`  [!] ${f}: invalid JSON (${e.message}), skipped`);
    }
  }
  return out;
}

async function doApply() {
  console.log(`\n${DRY_RUN ? '🔎 DRY RUN — no DB writes' : '🚀 EXECUTE — writing product content to live DB'}\n`);
  if (!DRY_RUN) await q('ALTER TABLE products ADD COLUMN IF NOT EXISTS content JSONB');
  const products = await loadProducts();
  const byId = new Map(products.map((p) => [p.id, p]));
  const items = readBatches();
  console.log(`Loaded ${items.length} generated entries across batch files; ${products.length} products in DB.\n`);

  const seen = new Set();
  let ok = 0, bad = 0, missing = 0;
  const samples = [];

  for (const it of items) {
    const p = byId.get(it.id);
    if (!p) { console.warn(`  [!] entry id=${it.id} (${it.slug || '?'}) not found in DB`); missing++; continue; }
    if (seen.has(it.id)) continue;
    const desc = (it.description || '').trim();
    const short = (it.short_description || '').trim();
    const goodPoints = Array.isArray(it.goodPoints) ? it.goodPoints.map((s) => String(s).trim()).filter(Boolean) : [];
    const unique = (it.unique || '').trim();
    const quality = (it.quality || '').trim();
    if (!desc || !goodPoints.length) { console.warn(`  [!] id=${it.id} (${p.slug}) incomplete (desc/goodPoints), skipped`); bad++; continue; }
    seen.add(it.id);

    const content = { goodPoints, unique, quality, specifications: buildSpecs(p) };
    const metaTitle = `${p.name} — ${p.categoryName} | Goodwill Printers`;
    const metaDesc = (short || desc).slice(0, 160);
    const metaKeywords = `${p.name}, ${p.categoryName}, ${p.sectionName}, corporate gifting, custom, Goodwill Printers`;

    if (samples.length < 3) samples.push({ slug: p.slug, desc, short, goodPoints, unique, quality });

    if (!DRY_RUN) {
      await q(
        `UPDATE products SET description=$1, short_description=$2, content=$3, meta_title=$4, meta_description=$5, meta_keywords=$6, updated_at=CURRENT_TIMESTAMP WHERE id=$7`,
        [desc, short, JSON.stringify(content), metaTitle, metaDesc, metaKeywords, p.id]
      );
    }
    ok++;
    if (ok % 50 === 0) console.log(`  …${ok} applied`);
  }

  console.log('\n=== SAMPLES ===');
  for (const s of samples) {
    console.log(`\n• ${s.slug}`);
    console.log(`  desc:    ${s.desc}`);
    console.log(`  short:   ${s.short}`);
    console.log(`  unique:  ${s.unique}`);
    console.log(`  quality: ${s.quality}`);
    console.log(`  points:  ${s.goodPoints.join(' | ')}`);
  }

  // Coverage = products that actually received content (passed match + dedup + completeness),
  // not every raw entry id — so incomplete/unmatched entries don't mask un-enriched products.
  const notCovered = products.filter((p) => !seen.has(p.id));
  console.log('\n────────────────────────────────────────');
  console.log(`${DRY_RUN ? 'Would update' : 'Updated'} : ${ok}`);
  console.log(`Incomplete entries skipped : ${bad}`);
  console.log(`Entries not matching a product : ${missing}`);
  console.log(`Products with NO generated entry : ${notCovered.length}${notCovered.length ? ' -> ' + notCovered.slice(0, 20).map((p) => p.slug).join(', ') + (notCovered.length > 20 ? '…' : '') : ''}`);
  console.log(DRY_RUN ? '\nDry run only. Re-run with EXECUTE=1 to apply.' : '\n✅ Done.');
  await pool.end();
}

(async () => {
  try {
    if (MODE === 'export') await doExport();
    else await doApply();
    process.exit(0);
  } catch (e) {
    console.error('FATAL:', e);
    try { await pool.end(); } catch {}
    process.exit(1);
  }
})();
