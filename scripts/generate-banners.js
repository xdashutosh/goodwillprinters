require('dotenv').config();
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { PutObjectCommand } = require('@aws-sdk/client-s3');
const { v4: uuidv4 } = require('uuid');
const s3Client = require('../config/s3');
const { publicUrl } = require('../config/s3');
const pool = require('../config/db');

const W = 1600;
const H = 560;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Pull one representative primary image per section so banners feature real products
async function getSectionImages() {
  const { rows } = await pool.query(`
    SELECT DISTINCT ON (s.slug) s.slug AS section, pi.image_url
    FROM product_images pi
    JOIN products p ON pi.product_id = p.id
    JOIN categories c ON p.category_id = c.id
    JOIN sections s ON c.section_id = s.id
    WHERE pi.is_primary = true
    ORDER BY s.slug, pi.id
  `);
  const map = {};
  for (const r of rows) map[r.section] = r.image_url;
  return map;
}

async function fetchAsDataUri(url) {
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    // Re-encode to a modest JPEG to keep the SVG payload small
    const jpeg = await sharp(buf).resize(820, 740, { fit: 'cover', position: 'centre' }).jpeg({ quality: 82 }).toBuffer();
    return `data:image/jpeg;base64,${jpeg.toString('base64')}`;
  } catch {
    return null;
  }
}

function buildSvg({ lines, subhead, cta, productUri, accent }) {
  const headline = lines
    .map((ln, i) => `<text x='92' y='${215 + i * 78}' font-family='Georgia, "Times New Roman", serif' font-size='64' font-weight='700' fill='#16235c'>${esc(ln)}</text>`)
    .join('');

  const product = productUri
    ? `
      <rect x='1018' y='56' width='498' height='448' rx='30' fill='#16235c'/>
      <rect x='1042' y='40' width='498' height='448' rx='30' fill='${accent}' opacity='0.18'/>
      <clipPath id='pclip'><rect x='1052' y='92' width='430' height='376' rx='20'/></clipPath>
      <image xlink:href='${productUri}' x='1052' y='92' width='430' height='376' preserveAspectRatio='xMidYMid slice' clip-path='url(#pclip)'/>`
    : '';

  return `<svg xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink' width='${W}' height='${H}' viewBox='0 0 ${W} ${H}'>
    <defs>
      <linearGradient id='bg' x1='0' y1='0' x2='1' y2='1'>
        <stop offset='0' stop-color='#ffffff'/>
        <stop offset='1' stop-color='#e7eefb'/>
      </linearGradient>
    </defs>
    <rect width='${W}' height='${H}' fill='url(#bg)'/>
    <circle cx='250' cy='560' r='240' fill='${accent}' opacity='0.06'/>
    <circle cx='980' cy='-40' r='200' fill='${accent}' opacity='0.07'/>
    ${product}
    ${headline}
    <text x='95' y='${215 + lines.length * 78 + 28}' font-family='Helvetica, Arial, sans-serif' font-size='27' fill='#475569'>${esc(subhead)}</text>
    <rect x='92' y='${215 + lines.length * 78 + 58}' width='${44 + cta.length * 13}' height='62' rx='31' fill='#2b4cdb'/>
    <text x='${92 + (44 + cta.length * 13) / 2}' y='${215 + lines.length * 78 + 98}' text-anchor='middle' font-family='Helvetica, Arial, sans-serif' font-size='23' font-weight='700' fill='#ffffff'>${esc(cta)}</text>
  </svg>`;
}

async function uploadBanner(svg, name, logoBuf) {
  const base = `banners/${name}-${uuidv4()}`;
  const bucket = process.env.AWS_BUCKET_NAME;
  // Render the SVG, then composite the brand logo on top (reliable PNG compositing)
  const baseImg = sharp(Buffer.from(svg)).composite([{ input: logoBuf, top: 56, left: 92 }]);
  const jpeg = await baseImg.clone().jpeg({ quality: 88 }).toBuffer();
  await s3Client.send(new PutObjectCommand({ Bucket: bucket, Key: `${base}.jpg`, Body: jpeg, ContentType: 'image/jpeg', ACL: 'public-read' }));
  const webp = await baseImg.clone().webp({ quality: 85 }).toBuffer();
  await s3Client.send(new PutObjectCommand({ Bucket: bucket, Key: `${base}.webp`, Body: webp, ContentType: 'image/webp', ACL: 'public-read' }));
  // also save a local copy for review
  fs.writeFileSync(path.join('/tmp', `${name}.jpg`), jpeg);
  return publicUrl(`${base}.jpg`);
}

async function run() {
  console.log('Generating brand banners…');
  const logoBuf = await sharp(path.join(__dirname, '../../frontend/public/brand/plan-a-day.png'))
    .resize({ height: 50 })
    .png()
    .toBuffer();
  const imgs = await getSectionImages();
  const anyImg = Object.values(imgs)[0] || null;

  const [diaryUri, giftUri, nbUri] = await Promise.all([
    fetchAsDataUri(imgs['diaries'] || anyImg),
    fetchAsDataUri(imgs['corporate-gifts'] || anyImg),
    fetchAsDataUri(imgs['notebooks'] || anyImg),
  ]);

  const specs = [
    {
      name: 'excellence',
      title: 'Crafting Corporate Excellence Since 1978',
      link: '/products',
      lines: ['Crafting Corporate', 'Excellence'],
      subhead: 'Premium corporate stationery & gifting — since 1978.',
      cta: 'Explore Collection',
      productUri: diaryUri,
      accent: '#2b4cdb',
    },
    {
      name: 'diaries-2026',
      title: 'Premium New Year Diaries',
      link: '/diaries',
      lines: ['Premium New Year', 'Diaries'],
      subhead: 'A4, A5, B5 & weekly formats with custom premium covers.',
      cta: 'Browse Diaries',
      productUri: nbUri || diaryUri,
      accent: '#203090',
    },
    {
      name: 'corporate-gifts',
      title: 'Custom Corporate Gifts',
      link: '/corporate-gifts',
      lines: ['Custom Corporate', 'Gifts'],
      subhead: 'Branded folders, organizers & executive gifting, tailored to you.',
      cta: 'Get a Quote',
      productUri: giftUri,
      accent: '#2b4cdb',
    },
  ];

  const banners = [];
  for (const spec of specs) {
    const svg = buildSvg(spec);
    const url = await uploadBanner(svg, spec.name, logoBuf);
    banners.push({ image_url: url, title: spec.title, link: spec.link });
    console.log(`  ✓ ${spec.name} -> ${url}`);
  }

  await pool.query(
    `INSERT INTO site_settings (key, value, updated_at) VALUES ('banners', $1, CURRENT_TIMESTAMP)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
    [JSON.stringify(banners)]
  );
  console.log('Saved banners to site_settings. Done.');
  await pool.end();
  process.exit(0);
}

run().catch((e) => { console.error(e); process.exit(1); });
