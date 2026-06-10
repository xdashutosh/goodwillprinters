const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { verifyToken, isAdmin } = require('../middleware/auth');

// Helper to get image data for products
const attachImagesToProducts = async (products) => {
  if (products.length === 0) return products;
  
  const productIds = products.map(p => p.id);
  const imagesResult = await pool.query(`
    SELECT * FROM product_images 
    WHERE product_id = ANY($1) 
    ORDER BY is_primary DESC, sort_order ASC
  `, [productIds]);
  
  return products.map(product => {
    product.images = imagesResult.rows.filter(img => img.product_id === product.id);
    return product;
  });
};

// Get products with advanced filtering and pagination
router.get('/', async (req, res) => {
  try {
    const { 
      section, 
      category, 
      size, 
      type, 
      coverStyle,
      search,
      featured,
      sort = 'newest',
    } = req.query;

    // Coerce + clamp pagination to guard against malformed query values
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(60, Math.max(1, parseInt(req.query.limit, 10) || 12));
    const offset = (page - 1) * limit;
    const params = [];
    let paramIndex = 1;

    let baseQuery = `
      FROM products p
      JOIN categories c ON p.category_id = c.id
      JOIN sections s ON c.section_id = s.id
      WHERE p.is_active = true AND c.is_active = true AND s.is_active = true
    `;

    // Filters
    if (section) {
      baseQuery += ` AND s.slug = $${paramIndex++}`;
      params.push(section);
    }
    if (category) {
      baseQuery += ` AND c.slug = $${paramIndex++}`;
      params.push(category);
    }
    if (size) {
      baseQuery += ` AND c.size_label = $${paramIndex++}`;
      params.push(size);
    }
    if (type) {
      baseQuery += ` AND c.type_label = $${paramIndex++}`;
      params.push(type);
    }
    if (coverStyle) {
      baseQuery += ` AND p.cover_style = $${paramIndex++}`;
      params.push(coverStyle);
    }
    if (featured === 'true') {
      baseQuery += ` AND p.is_featured = true`;
    }
    if (search) {
      baseQuery += ` AND (p.name ILIKE $${paramIndex} OR p.description ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    // Get Total Count
    const countQuery = `SELECT COUNT(*) ${baseQuery}`;
    const countResult = await pool.query(countQuery, params);
    const totalCount = parseInt(countResult.rows[0].count, 10);

    // Sorting
    let orderBy = 'ORDER BY p.created_at DESC'; // default newest
    if (sort === 'oldest') orderBy = 'ORDER BY p.created_at ASC';
    else if (sort === 'name_asc') orderBy = 'ORDER BY p.name ASC';
    else if (sort === 'name_desc') orderBy = 'ORDER BY p.name DESC';
    else if (sort === 'sort_order') orderBy = 'ORDER BY p.sort_order ASC';

    // Get Data
    const dataQuery = `
      SELECT p.*, c.name as category_name, c.slug as category_slug, s.name as section_name, s.slug as section_slug
      ${baseQuery}
      ${orderBy}
      LIMIT $${paramIndex++} OFFSET $${paramIndex++}
    `;
    params.push(limit, offset);
    
    const result = await pool.query(dataQuery, params);
    const products = await attachImagesToProducts(result.rows);

    // Filter Aggregations (for sidebar)
    // Only get aggregations if it's the first page to save DB load
    let filters = null;
    if (page == 1) {
      const filterParams = section ? [section] : [];
      const sectionFilter = section ? 'AND s.slug = $1' : '';
      
      const sizesResult = await pool.query(`SELECT DISTINCT c.size_label FROM categories c JOIN sections s ON c.section_id = s.id WHERE c.is_active = true AND c.size_label IS NOT NULL ${sectionFilter}`, filterParams);
      const typesResult = await pool.query(`SELECT DISTINCT c.type_label FROM categories c JOIN sections s ON c.section_id = s.id WHERE c.is_active = true AND c.type_label IS NOT NULL ${sectionFilter}`, filterParams);
      const coversResult = await pool.query(`SELECT DISTINCT p.cover_style FROM products p JOIN categories c ON p.category_id = c.id JOIN sections s ON c.section_id = s.id WHERE p.is_active = true AND p.cover_style IS NOT NULL ${sectionFilter}`, filterParams);
      // Categories that actually have active products (so the sidebar only lists reachable ones)
      const categoriesResult = await pool.query(`
        SELECT c.name, c.slug, COUNT(p.id)::int AS product_count
        FROM categories c
        JOIN sections s ON c.section_id = s.id
        JOIN products p ON p.category_id = c.id AND p.is_active = true
        WHERE c.is_active = true AND s.is_active = true ${sectionFilter}
        GROUP BY c.id, c.name, c.slug
        ORDER BY c.name ASC
      `, filterParams);

      filters = {
        sizes: sizesResult.rows.map(r => r.size_label),
        types: typesResult.rows.map(r => r.type_label),
        coverStyles: coversResult.rows.map(r => r.cover_style),
        categories: categoriesResult.rows.map(r => ({ name: r.name, slug: r.slug, count: r.product_count }))
      };
    }

    res.json({
      products,
      pagination: {
        total: totalCount,
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        totalPages: Math.ceil(totalCount / limit)
      },
      filters
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get single product by slug
router.get('/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    const result = await pool.query(`
      SELECT p.*, c.name as category_name, c.slug as category_slug,
             c.size_label as category_size_label, c.type_label as category_type_label,
             s.name as section_name, s.slug as section_slug
      FROM products p
      JOIN categories c ON p.category_id = c.id
      JOIN sections s ON c.section_id = s.id
      WHERE p.slug = $1 AND p.is_active = true
    `, [slug]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }
    
    const product = (await attachImagesToProducts(result.rows))[0];
    
    // Also fetch related products (same category or same cover style)
    const relatedResult = await pool.query(`
      SELECT p.*, c.name as category_name, c.slug as category_slug 
      FROM products p
      JOIN categories c ON p.category_id = c.id
      WHERE p.id != $1 AND p.is_active = true AND (p.category_id = $2 OR (p.cover_style = $3 AND p.cover_style IS NOT NULL))
      ORDER BY p.created_at DESC
      LIMIT 4
    `, [product.id, product.category_id, product.cover_style]);
    
    product.related = await attachImagesToProducts(relatedResult.rows);
    
    res.json(product);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// --- ADMIN ROUTES ---

// Get all products
router.get('/admin/all', verifyToken, isAdmin, async (req, res) => {
  try {
    const { search, category_id } = req.query;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const offset = (page - 1) * limit;

    let baseQuery = `
      FROM products p
      JOIN categories c ON p.category_id = c.id
    `;
    const params = [];
    let paramIndex = 1;
    let whereClauses = [];

    if (search) {
      whereClauses.push(`p.name ILIKE $${paramIndex++}`);
      params.push(`%${search}%`);
    }
    if (category_id) {
      whereClauses.push(`p.category_id = $${paramIndex++}`);
      params.push(category_id);
    }
    
    if (whereClauses.length > 0) {
      baseQuery += ` WHERE ` + whereClauses.join(' AND ');
    }

    const countQuery = `SELECT COUNT(*) ${baseQuery}`;
    const countResult = await pool.query(countQuery, params);
    
    const dataQuery = `
      SELECT p.*, c.name as category_name
      ${baseQuery}
      ORDER BY p.created_at DESC
      LIMIT $${paramIndex++} OFFSET $${paramIndex++}
    `;
    params.push(limit, offset);
    
    const result = await pool.query(dataQuery, params);
    const products = await attachImagesToProducts(result.rows);

    res.json({
      products,
      total: parseInt(countResult.rows[0].count, 10),
      page: parseInt(page, 10),
      totalPages: Math.ceil(parseInt(countResult.rows[0].count, 10) / limit)
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get single product by id (admin — includes inactive + images)
router.get('/admin/:id', verifyToken, isAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(`
      SELECT p.*, c.name as category_name, c.slug as category_slug, s.name as section_name, s.slug as section_slug
      FROM products p
      JOIN categories c ON p.category_id = c.id
      JOIN sections s ON c.section_id = s.id
      WHERE p.id = $1
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const product = (await attachImagesToProducts(result.rows))[0];
    res.json(product);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Create product
router.post('/', verifyToken, isAdmin, async (req, res) => {
  try {
    const { category_id, name, slug, short_description, description, cover_style, available_sizes, is_featured, is_active, sort_order, meta_title, meta_description, meta_keywords } = req.body;
    
    const result = await pool.query(`
      INSERT INTO products (category_id, name, slug, short_description, description, cover_style, available_sizes, is_featured, is_active, sort_order, meta_title, meta_description, meta_keywords)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *
    `, [category_id, name, slug, short_description, description, cover_style, JSON.stringify(available_sizes || []), is_featured || false, is_active !== false, sort_order || 0, meta_title, meta_description, meta_keywords]);
    
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    if (err.constraint === 'products_slug_key') {
      return res.status(400).json({ error: 'Slug already exists' });
    }
    res.status(500).json({ error: 'Server error' });
  }
});

// Update product
router.put('/:id', verifyToken, isAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { category_id, name, slug, short_description, description, cover_style, available_sizes, is_featured, is_active, sort_order, meta_title, meta_description, meta_keywords } = req.body;
    
    const result = await pool.query(`
      UPDATE products
      SET category_id = $1, name = $2, slug = $3, short_description = $4, description = $5, cover_style = $6, available_sizes = $7, is_featured = $8, is_active = $9, sort_order = $10, meta_title = $11, meta_description = $12, meta_keywords = $13, updated_at = CURRENT_TIMESTAMP
      WHERE id = $14
      RETURNING *
    `, [category_id, name, slug, short_description, description, cover_style, JSON.stringify(available_sizes || []), is_featured, is_active, sort_order, meta_title, meta_description, meta_keywords, id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }
    
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    if (err.constraint === 'products_slug_key') {
      return res.status(400).json({ error: 'Slug already exists' });
    }
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete product
router.delete('/:id', verifyToken, isAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM products WHERE id = $1 RETURNING id', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }
    
    res.json({ message: 'Product deleted successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
