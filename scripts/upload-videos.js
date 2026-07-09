/**
 * Upload the frontend's showcase videos to S3 (public-read) so they're served
 * from object storage instead of bundled in the Next.js /public folder.
 *
 *   node scripts/upload-videos.js
 *
 * Deterministic keys (videos/<file>) → stable URLs, safe to re-run (overwrites).
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { PutObjectCommand } = require('@aws-sdk/client-s3');
const s3Client = require('../config/s3');
const { publicUrl } = require('../config/s3');

const VIDEO_DIR = path.join(__dirname, '../../frontend/public/videos');
const bucket = process.env.AWS_BUCKET_NAME;

(async () => {
  const files = fs.readdirSync(VIDEO_DIR).filter((f) => f.toLowerCase().endsWith('.mp4')).sort();
  if (!files.length) { console.log('No mp4 files found in', VIDEO_DIR); return; }

  const map = {};
  for (const f of files) {
    const key = `videos/${f}`;
    const body = fs.readFileSync(path.join(VIDEO_DIR, f));
    process.stdout.write(`Uploading ${f} (${(body.length / 1048576).toFixed(1)} MB)… `);
    await s3Client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: 'video/mp4',
      ACL: 'public-read',
      CacheControl: 'public, max-age=31536000, immutable',
    }));
    map[f] = publicUrl(key);
    console.log('✓');
  }

  console.log('\nURLS:');
  console.log(JSON.stringify(map, null, 2));
})().catch((e) => { console.error('FATAL:', e); process.exit(1); });
