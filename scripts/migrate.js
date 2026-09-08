const pool = require('../config/db');

const createTables = async () => {
  const client = await pool.connect();
  try {
    console.log('Starting database migration...');
    await client.query('BEGIN');

    // Sections
    await client.query(`
      CREATE TABLE IF NOT EXISTS sections (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        slug VARCHAR(255) UNIQUE NOT NULL,
        description TEXT,
        image_url VARCHAR(255),
        meta_title VARCHAR(255),
        meta_description VARCHAR(500),
        meta_keywords VARCHAR(255),
        sort_order INT DEFAULT 0,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('Created sections table');

    // Categories
    await client.query(`
      CREATE TABLE IF NOT EXISTS categories (
        id SERIAL PRIMARY KEY,
        section_id INT REFERENCES sections(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        slug VARCHAR(255) UNIQUE NOT NULL,
        description TEXT,
        size_label VARCHAR(50),
        type_label VARCHAR(50),
        image_url VARCHAR(255),
        meta_title VARCHAR(255),
        meta_description VARCHAR(500),
        meta_keywords VARCHAR(255),
        sort_order INT DEFAULT 0,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('Created categories table');

    // Products
    await client.query(`
      CREATE TABLE IF NOT EXISTS products (
        id SERIAL PRIMARY KEY,
        category_id INT REFERENCES categories(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        slug VARCHAR(255) UNIQUE NOT NULL,
        short_description TEXT,
        description TEXT,
        cover_style VARCHAR(255),
        available_sizes JSONB,
        is_featured BOOLEAN DEFAULT false,
        is_active BOOLEAN DEFAULT true,
        sort_order INT DEFAULT 0,
        meta_title VARCHAR(255),
        meta_description VARCHAR(500),
        meta_keywords VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('Created products table');

    // Product Images
    await client.query(`
      CREATE TABLE IF NOT EXISTS product_images (
        id SERIAL PRIMARY KEY,
        product_id INT REFERENCES products(id) ON DELETE CASCADE,
        image_url VARCHAR(255) NOT NULL,
        webp_url VARCHAR(255),
        thumbnail_url VARCHAR(255),
        alt_text VARCHAR(255),
        color VARCHAR(50),
        color_hex VARCHAR(20),
        is_primary BOOLEAN DEFAULT false,
        sort_order INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    // Ensure colour-variant columns exist on tables created before this change
    await client.query(`ALTER TABLE product_images ADD COLUMN IF NOT EXISTS color VARCHAR(50)`);
    await client.query(`ALTER TABLE product_images ADD COLUMN IF NOT EXISTS color_hex VARCHAR(20)`);
    console.log('Created product_images table');

    // Rich "content" JSONB (product good-points/unique/quality/specs, category
    // intro/highlights/specs/faqs) — read by the site and written by the admin editors.
    await client.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS content JSONB`);
    await client.query(`ALTER TABLE categories ADD COLUMN IF NOT EXISTS content JSONB`);
    console.log('Ensured content columns');

    // Enquiries
    await client.query(`
      CREATE TABLE IF NOT EXISTS enquiries (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL,
        phone VARCHAR(50),
        company VARCHAR(255),
        subject VARCHAR(255),
        message TEXT,
        product_id INT REFERENCES products(id) ON DELETE SET NULL,
        status VARCHAR(50) DEFAULT 'new',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    // Ensure the subject column exists on databases created before it was added
    await client.query(`ALTER TABLE enquiries ADD COLUMN IF NOT EXISTS subject VARCHAR(255)`);
    console.log('Created enquiries table');

    // Admin Users
    await client.query(`
      CREATE TABLE IF NOT EXISTS admin_users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        name VARCHAR(255),
        role VARCHAR(50) DEFAULT 'admin',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_login TIMESTAMP
      );
    `);
    console.log('Created admin_users table');

    // Site Settings
    await client.query(`
      CREATE TABLE IF NOT EXISTS site_settings (
        id SERIAL PRIMARY KEY,
        key VARCHAR(255) UNIQUE NOT NULL,
        value TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('Created site_settings table');

    // Site Assets — every managed banner / video / image on the marketing site.
    //  collection : logical group (hero_banners, showcase_videos, section_headers,
    //               collection_cards, gifting, backgrounds, brand)
    //  slot       : stable key for singletons (e.g. 'diaries', 'poster_2027');
    //               NULL for free list items that are only ordered by sort_order
    //  kind       : 'image' | 'video'
    await client.query(`
      CREATE TABLE IF NOT EXISTS site_assets (
        id SERIAL PRIMARY KEY,
        collection VARCHAR(64) NOT NULL,
        slot VARCHAR(120),
        kind VARCHAR(16) NOT NULL DEFAULT 'image',
        title VARCHAR(200),
        subtitle VARCHAR(300),
        link VARCHAR(255),
        alt_text VARCHAR(255),
        url TEXT,
        webp_url TEXT,
        thumbnail_url TEXT,
        hover_url TEXT,
        hover_webp_url TEXT,
        sort_order INT DEFAULT 0,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS site_assets_collection_slot_uniq
      ON site_assets (collection, slot) WHERE slot IS NOT NULL
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS site_assets_collection_idx
      ON site_assets (collection, sort_order, id)
    `);
    console.log('Created site_assets table');

    await client.query('COMMIT');
    console.log('Migration completed successfully!');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', error);
    process.exitCode = 1; // fail loudly so CI/deploy doesn't treat a broken migration as success
  } finally {
    client.release();
    pool.end();
  }
};

createTables();
