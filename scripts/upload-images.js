require('dotenv').config();
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { PutObjectCommand } = require('@aws-sdk/client-s3');
const { v4: uuidv4 } = require('uuid');
const s3Client = require('../config/s3');
const { publicUrl } = require('../config/s3');
const pool = require('../config/db');
const generateSlug = require('../utils/slugify');

// Paths to the image directories
const TRANSFER_NOW_DIR = path.join(__dirname, '../../TransferNow-20260602DRfZyirF');
const NOTEBOOKS_DIR = path.join(__dirname, '../../TransferNow-WebSite File/Note Books');

// Folder mapping to slug
const folderCategoryMap = {
  // Diaries
  'A4 Daily': { section: 'diaries', category: 'a4-daily' },
  'A4 Weekly': { section: 'diaries', category: 'a4-weekly' },
  'A5 Daily': { section: 'diaries', category: 'a5-daily' },
  'A6 Weekly': { section: 'diaries', category: 'a6-weekly' },
  'B5 Daily': { section: 'diaries', category: 'b5-daily' },
  // Corporate Gifts
  'Corporate Gifts': { section: 'corporate-gifts', category: null }, // Need to map based on filename
  // Organizers
  'Organizers': { section: 'organizers', category: 'gp-43' },
  // Notebooks
  'A5 Size': { section: 'notebooks', category: 'a5-notebooks' },
  'B5 Size': { section: 'notebooks', category: 'b5-notebooks' },
  'Siwss': { section: 'notebooks', category: 'swiss' }, // folder is spelled "Siwss" on disk
  'Swiss': { section: 'notebooks', category: 'swiss' }, // also accept the correct spelling
  'Trump Folder': { section: 'notebooks', category: 'trump-folder' },
  'Wiro': { section: 'notebooks', category: 'wiro' },
  'York': { section: 'notebooks', category: 'york' },
};

const extractProductName = (filename) => {
  // Remove extension
  let name = filename.replace(/\.(tif|TIF)$/, '');
  // Remove variants like -01, -02, -1, -2, etc.
  name = name.replace(/-\d+$/, '');
  name = name.replace(/_01$/, '');
  return name.trim();
};

const getCategoryId = async (sectionSlug, categorySlug, filename) => {
  if (sectionSlug === 'corporate-gifts') {
    // Determine category based on filename
    let targetCatSlug = 'folders'; // Default
    if (filename.toLowerCase().includes('kit')) targetCatSlug = 'travelling-kit';
    else if (filename.toLowerCase().includes('passport')) targetCatSlug = 'passports';
    else if (filename.toLowerCase().includes('pen') || filename.toLowerCase().includes('vogue')) targetCatSlug = 'pen-holder-vogue';
    else if (filename.toLowerCase().includes('atm') || filename.toLowerCase().includes('card')) targetCatSlug = 'atm-card-holders';
    else if (filename.toLowerCase().includes('guest')) targetCatSlug = 'guest-book';
    
    categorySlug = targetCatSlug;
  } else if (sectionSlug === 'notebooks' && !categorySlug) {
    // Root notebooks
    if (filename.toLowerCase().includes('usb')) categorySlug = 'usb-folder';
    else categorySlug = 'a5-notebooks'; // Default fallback
  }

  const res = await pool.query(`
    SELECT c.id FROM categories c 
    JOIN sections s ON c.section_id = s.id 
    WHERE s.slug = $1 AND c.slug = $2
  `, [sectionSlug, categorySlug]);

  return res.rows.length > 0 ? res.rows[0].id : null;
};

const processAndUploadFile = async (filePath, folderName) => {
  try {
    const filename = path.basename(filePath);
    const productName = extractProductName(filename);
    const slug = generateSlug(`${productName}-${folderName || 'general'}`);
    
    let sectionSlug, categorySlug;

    if (filePath.includes('Note Books') && !folderName) {
      sectionSlug = 'notebooks';
      categorySlug = null;
    } else {
      const mapping = folderCategoryMap[folderName];
      if (!mapping) {
        console.warn(`No mapping found for folder: ${folderName}, skipping ${filename}`);
        return;
      }
      sectionSlug = mapping.section;
      categorySlug = mapping.category;
    }

    const categoryId = await getCategoryId(sectionSlug, categorySlug, filename);
    if (!categoryId) {
      console.warn(`Could not find category for ${filename}`);
      return;
    }

    // 1. Check if product exists, if not create it
    let productRes = await pool.query('SELECT id FROM products WHERE slug = $1', [slug]);
    let productId;
    
    if (productRes.rows.length === 0) {
      // Create product
      const insertRes = await pool.query(`
        INSERT INTO products (category_id, name, slug, cover_style)
        VALUES ($1, $2, $3, $4)
        RETURNING id
      `, [categoryId, productName, slug, productName]);
      productId = insertRes.rows[0].id;
      console.log(`Created product: ${productName} (${slug})`);
    } else {
      productId = productRes.rows[0].id;
    }

    // 2. Process image with Sharp
    console.log(`Processing ${filename}...`);
    const fileBuffer = fs.readFileSync(filePath);
    const baseS3Path = `products/${sectionSlug}/${categorySlug || 'general'}/${slug}-${uuidv4()}`;
    const bucket = process.env.AWS_BUCKET_NAME;
    // { unlimited: true } lets libvips decode large TIFFs without hitting its
    // default cumulative-memory limit.
    const sharpOpts = { unlimited: true, failOn: 'none' };

    // JPEG
    const jpegBuffer = await sharp(fileBuffer, sharpOpts).resize(1600, null, { withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
    const jpegKey = `${baseS3Path}.jpg`;
    await s3Client.send(new PutObjectCommand({ Bucket: bucket, Key: jpegKey, Body: jpegBuffer, ContentType: 'image/jpeg', ACL: 'public-read' }));

    // WebP
    const webpBuffer = await sharp(fileBuffer, sharpOpts).resize(1600, null, { withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
    const webpKey = `${baseS3Path}.webp`;
    await s3Client.send(new PutObjectCommand({ Bucket: bucket, Key: webpKey, Body: webpBuffer, ContentType: 'image/webp', ACL: 'public-read' }));

    // Thumb
    const thumbBuffer = await sharp(fileBuffer, sharpOpts).resize(400, null, { withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
    const thumbKey = `products/${sectionSlug}/${categorySlug || 'general'}/thumbs/${slug}-${uuidv4()}.jpg`;
    await s3Client.send(new PutObjectCommand({ Bucket: bucket, Key: thumbKey, Body: thumbBuffer, ContentType: 'image/jpeg', ACL: 'public-read' }));

    // 3. Build URLs and insert into DB
    // Check if it's the first image for this product to set as primary
    const existingImages = await pool.query('SELECT COUNT(*) FROM product_images WHERE product_id = $1', [productId]);
    const isPrimary = existingImages.rows[0].count === '0';

    await pool.query(`
      INSERT INTO product_images (product_id, image_url, webp_url, thumbnail_url, alt_text, is_primary)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [productId, publicUrl(jpegKey), publicUrl(webpKey), publicUrl(thumbKey), productName, isPrimary]);

    console.log(`Successfully uploaded ${filename}`);

  } catch (err) {
    console.error(`Error processing file ${filePath}:`, err);
  }
};

const readFilesRecursively = (dir, folderName = null) => {
  let results = [];
  const list = fs.readdirSync(dir);
  
  list.forEach((file) => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    
    if (stat && stat.isDirectory()) {
      results = results.concat(readFilesRecursively(filePath, file));
    } else {
      if (file.toLowerCase().endsWith('.tif')) {
        results.push({ filePath, folderName });
      }
    }
  });
  
  return results;
};

const startMigration = async () => {
  console.log('Starting image migration to S3...');

  // Optional: re-process specific files passed as CLI args, e.g.
  //   node scripts/upload-images.js "/abs/path/Burberry.tif" "/abs/path/Guest Book-01.tif"
  const cliFiles = process.argv.slice(2).filter((a) => a.toLowerCase().endsWith('.tif'));

  let allFiles;
  if (cliFiles.length > 0) {
    allFiles = cliFiles.map((filePath) => {
      // Files sitting directly in the "Note Books" root use folderName = null
      // (matches readFilesRecursively, so the notebooks root-folder logic applies).
      const parent = path.basename(path.dirname(filePath));
      return { filePath, folderName: parent === 'Note Books' ? null : parent };
    });
    console.log(`Processing ${allFiles.length} file(s) passed on the command line.`);
  } else {
    allFiles = [
      ...readFilesRecursively(TRANSFER_NOW_DIR),
      ...readFilesRecursively(NOTEBOOKS_DIR),
    ];

    // Optional cap for validation runs: UPLOAD_LIMIT=4 npm run upload-images
    const limit = process.env.UPLOAD_LIMIT ? parseInt(process.env.UPLOAD_LIMIT, 10) : null;
    if (limit && limit > 0) {
      console.log(`UPLOAD_LIMIT set — processing only the first ${limit} files.`);
      allFiles = allFiles.slice(0, limit);
    }
  }

  console.log(`Found ${allFiles.length} TIF files to process.`);

  // Process sequentially to avoid overwhelming memory
  for (const [index, { filePath, folderName }] of allFiles.entries()) {
    console.log(`[${index + 1}/${allFiles.length}] Processing...`);
    await processAndUploadFile(filePath, folderName);
  }

  console.log('Migration Complete!');
  process.exit(0);
};

// Handle unhandled rejections
process.on('unhandledRejection', (err) => {
  console.error('Unhandled Rejection:', err);
});

startMigration();
