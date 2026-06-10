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

    // Enquiries
    await client.query(`
      CREATE TABLE IF NOT EXISTS enquiries (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL,
        phone VARCHAR(50),
        company VARCHAR(255),
        message TEXT,
        product_id INT REFERENCES products(id) ON DELETE SET NULL,
        status VARCHAR(50) DEFAULT 'new',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
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

    await client.query('COMMIT');
    console.log('Migration completed successfully!');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', error);
  } finally {
    client.release();
    pool.end();
  }
};

createTables();
