/**
 * Apply the real per-category diary details from productdata/*.xlsx
 * (parsed by the Python step into .productdata.json) to every product in the
 * matching category, so each product page shows the accurate specs & features.
 *
 *   Preview:  node scripts/apply-productdata.js
 *   Apply:    EXECUTE=1 node scripts/apply-productdata.js
 *
 * Mapping: A4/A5/B5 SIZE DIARY DETAILS -> a4-daily / a5-daily / b5-daily.
 * Per product it sets: description (intro), short_description (tagline),
 * content.goodPoints (features), content.quality (craftsmanship line),
 * content.specifications (full spec table) — and PRESERVES the existing
 * per-product content.unique (the cover-specific line). Idempotent.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const DRY_RUN = process.env.EXECUTE !== '1';
const DATA_FILE = path.join(__dirname, '.productdata.json');

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
      if (i === tries || !/timeout|terminat|connection|socket|ECONN|ETIMEDOUT|EADDR|ENETUNREACH|EHOSTUNREACH|EPIPE|EAI_AGAIN/i.test(`${e.code} ${e.message}`)) throw e;
      await sleep(Math.min(3000 * i, 12000));
    }
  }
  throw last;
}

(async () => {
  console.log(`\n${DRY_RUN ? '🔎 DRY RUN — no DB writes' : '🚀 EXECUTE — writing product data to live DB'}\n`);
  const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  if (!DRY_RUN) await q('ALTER TABLE products ADD COLUMN IF NOT EXISTS content JSONB');

  let total = 0, preserved = 0;
  for (const [cat, d] of Object.entries(data)) {
    const prods = await q(
      `SELECT p.id, p.name, p.content
       FROM products p JOIN categories c ON p.category_id = c.id
       WHERE c.slug = $1 ORDER BY p.name`,
      [cat]
    );
    console.log(`${cat.padEnd(10)} → ${String(prods.rows.length).padStart(3)} products   (${d.title})`);
    console.log(`   specs: ${d.specifications.length} rows · features: ${d.goodPoints.length}`);

    for (const p of prods.rows) {
      const existing = p.content && typeof p.content === 'object' ? p.content : {};
      const keepUnique = typeof existing.unique === 'string' && existing.unique.trim();
      if (keepUnique) preserved++;
      const content = {
        goodPoints: d.goodPoints,
        unique: keepUnique ? existing.unique.trim() : d.tagline,
        quality: d.quality,
        specifications: d.specifications,
      };
      if (!DRY_RUN) {
        await q(
          `UPDATE products SET description=$1, short_description=$2, content=$3, updated_at=CURRENT_TIMESTAMP WHERE id=$4`,
          [d.description, d.tagline, JSON.stringify(content), p.id]
        );
      }
      total++;
    }
  }

  console.log('\n────────────────────────────────────────');
  console.log(`${DRY_RUN ? 'Would update' : 'Updated'} products : ${total}`);
  console.log(`Per-product "unique" preserved : ${preserved}`);
  console.log(DRY_RUN ? '\nDry run only. Re-run with EXECUTE=1 to apply.' : '\n✅ Done.');
  await pool.end();
  process.exit(0);
})().catch(async (e) => { console.error('FATAL:', e); try { await pool.end(); } catch {} process.exit(1); });
