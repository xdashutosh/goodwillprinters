const pool = require('../config/db');
const bcrypt = require('bcrypt');

const seedData = async () => {
  const client = await pool.connect();
  try {
    console.log('Starting database seeding...');
    await client.query('BEGIN');

    // 1. Clear existing data (optional, maybe we just do ON CONFLICT DO NOTHING)
    // await client.query('TRUNCATE TABLE sections, categories, products, product_images CASCADE');

    // 2. Admin User
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@plan-a-day.com';
    const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
    const hashedPassword = await bcrypt.hash(adminPassword, 10);
    
    await client.query(`
      INSERT INTO admin_users (email, password_hash, name, role)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (email) DO NOTHING
    `, [adminEmail, hashedPassword, 'Admin', 'admin']);
    console.log('Admin user seeded.');

    // 3. Sections
    const sections = [
      { name: 'Diaries', slug: 'diaries', description: 'Premium New Year diaries available in A6 Weekly, A5 Daily, B5 Daily, A4 Daily, and A4 Weekly formats with diverse cover styles.' },
      { name: 'Notebooks', slug: 'notebooks', description: 'High-quality notebooks in A5, A6, B5, Wiro binding, Swiss, USB Folder, and Trump Folder variants.' },
      { name: 'Organizers', slug: 'organizers', description: 'Professional organizers in GP-43 format with daily planning pages and elegant covers.' },
      { name: 'Corporate Gifts', slug: 'corporate-gifts', description: 'Premium corporate gifting solutions including travelling kits, folders, pen holders, passport holders, and guest books.' }
    ];

    for (const s of sections) {
      await client.query(`
        INSERT INTO sections (name, slug, description)
        VALUES ($1, $2, $3)
        ON CONFLICT (slug) DO NOTHING
      `, [s.name, s.slug, s.description]);
    }
    console.log('Sections seeded.');

    // 4. Categories
    const categories = [
      // Diaries
      { sectionSlug: 'diaries', name: 'A6 Weekly', slug: 'a6-weekly', size: 'A6', type: 'Weekly' },
      { sectionSlug: 'diaries', name: 'A5 Daily', slug: 'a5-daily', size: 'A5', type: 'Daily' },
      { sectionSlug: 'diaries', name: 'B5 Daily', slug: 'b5-daily', size: 'B5', type: 'Daily' },
      { sectionSlug: 'diaries', name: 'A4 Daily', slug: 'a4-daily', size: 'A4', type: 'Daily' },
      { sectionSlug: 'diaries', name: 'A4 Weekly', slug: 'a4-weekly', size: 'A4', type: 'Weekly' },
      // Notebooks
      { sectionSlug: 'notebooks', name: 'A5 Notebooks', slug: 'a5-notebooks', size: 'A5', type: null },
      { sectionSlug: 'notebooks', name: 'B5 Notebooks', slug: 'b5-notebooks', size: 'B5', type: null },
      { sectionSlug: 'notebooks', name: 'Swiss', slug: 'swiss', size: null, type: null },
      { sectionSlug: 'notebooks', name: 'USB Folder', slug: 'usb-folder', size: null, type: null },
      { sectionSlug: 'notebooks', name: 'Trump Folder', slug: 'trump-folder', size: null, type: null },
      { sectionSlug: 'notebooks', name: 'Wiro', slug: 'wiro', size: null, type: null },
      { sectionSlug: 'notebooks', name: 'York', slug: 'york', size: null, type: null },
      // Organizers
      { sectionSlug: 'organizers', name: 'GP-43 Organizer', slug: 'gp-43', size: null, type: 'Daily' },
      { sectionSlug: 'organizers', name: 'One Day A Page', slug: 'one-day-a-page', size: null, type: null },
      // Corporate Gifts
      { sectionSlug: 'corporate-gifts', name: 'Travelling Kit', slug: 'travelling-kit', size: null, type: null },
      { sectionSlug: 'corporate-gifts', name: 'Folders', slug: 'folders', size: null, type: null },
      { sectionSlug: 'corporate-gifts', name: 'Pen Holder & Vogue', slug: 'pen-holder-vogue', size: null, type: null },
      { sectionSlug: 'corporate-gifts', name: 'ATM Card Holders', slug: 'atm-card-holders', size: null, type: null },
      { sectionSlug: 'corporate-gifts', name: 'Guest Book', slug: 'guest-book', size: null, type: null },
      { sectionSlug: 'corporate-gifts', name: 'Passports', slug: 'passports', size: null, type: null }
    ];

    for (const c of categories) {
      // Get section id
      const sectionRes = await client.query('SELECT id FROM sections WHERE slug = $1', [c.sectionSlug]);
      if (sectionRes.rows.length > 0) {
        const sectionId = sectionRes.rows[0].id;
        await client.query(`
          INSERT INTO categories (section_id, name, slug, size_label, type_label)
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (slug) DO NOTHING
        `, [sectionId, c.name, c.slug, c.size, c.type]);
      }
    }
    console.log('Categories seeded.');

    // 5. Site Settings (defaults — editable from the Admin Panel)
    const settings = [
      { key: 'company_name', value: 'Goodwill Printers' },
      { key: 'brand_name', value: 'Plan.A.Day' },
      { key: 'contact_email', value: process.env.ADMIN_EMAIL || 'tanujdhawangp@gmail.com' },
      { key: 'contact_phone', value: '+91 98100 00000' },
      { key: 'whatsapp_number', value: '919810000000' },
      { key: 'contact_address', value: 'Goodwill Printers\nNew Delhi, India' },
      { key: 'hero_title', value: 'Crafting Corporate Excellence Since 1978' },
      { key: 'hero_subtitle', value: 'Premium corporate stationery and gifting solutions that reflect professionalism, quality, and brand identity.' },
      { key: 'about_intro', value: 'At Goodwill Printers, we transform ideas into premium corporate stationery and gifting solutions that reflect professionalism, quality, and brand identity. Since 1978, we have been delivering expertly crafted products under our internationally recognized brand, Plan.A.Day.' },
      { key: 'banners', value: JSON.stringify([]) },
    ];
    for (const s of settings) {
      await client.query(
        `INSERT INTO site_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING`,
        [s.key, s.value]
      );
    }
    console.log('Site settings seeded.');

    await client.query('COMMIT');
    console.log('Seeding completed successfully!');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Seeding failed:', error);
  } finally {
    client.release();
    pool.end();
  }
};

seedData();
