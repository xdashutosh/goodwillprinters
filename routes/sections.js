const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { verifyToken, isAdmin } = require('../middleware/auth');

// Get all active sections
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT s.*, COUNT(c.id) as category_count 
      FROM sections s
      LEFT JOIN categories c ON s.id = c.section_id AND c.is_active = true
      WHERE s.is_active = true
      GROUP BY s.id
      ORDER BY s.sort_order ASC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get single section by slug
router.get('/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    const result = await pool.query('SELECT * FROM sections WHERE slug = $1 AND is_active = true', [slug]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Section not found' });
    }
    
    const section = result.rows[0];
    
    // Get categories for this section
    const catResult = await pool.query('SELECT * FROM categories WHERE section_id = $1 AND is_active = true ORDER BY sort_order ASC', [section.id]);
    section.categories = catResult.rows;
    
    res.json(section);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// --- ADMIN ROUTES ---

// Get all sections (including inactive)
router.get('/admin/all', verifyToken, isAdmin, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM sections ORDER BY sort_order ASC');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Create section
router.post('/', verifyToken, isAdmin, async (req, res) => {
  try {
    const { name, slug, description, image_url, meta_title, meta_description, meta_keywords, sort_order, is_active } = req.body;
    
    const result = await pool.query(`
      INSERT INTO sections (name, slug, description, image_url, meta_title, meta_description, meta_keywords, sort_order, is_active)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `, [name, slug, description, image_url, meta_title, meta_description, meta_keywords, sort_order || 0, is_active !== false]);
    
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    if (err.constraint === 'sections_slug_key') {
      return res.status(400).json({ error: 'Slug already exists' });
    }
    res.status(500).json({ error: 'Server error' });
  }
});

// Update section
router.put('/:id', verifyToken, isAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, slug, description, image_url, meta_title, meta_description, meta_keywords, sort_order, is_active } = req.body;
    
    const result = await pool.query(`
      UPDATE sections
      SET name = $1, slug = $2, description = $3, image_url = $4, meta_title = $5, meta_description = $6, meta_keywords = $7, sort_order = $8, is_active = $9, updated_at = CURRENT_TIMESTAMP
      WHERE id = $10
      RETURNING *
    `, [name, slug, description, image_url, meta_title, meta_description, meta_keywords, sort_order, is_active, id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Section not found' });
    }
    
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    if (err.constraint === 'sections_slug_key') {
      return res.status(400).json({ error: 'Slug already exists' });
    }
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete section
router.delete('/:id', verifyToken, isAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM sections WHERE id = $1 RETURNING id', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Section not found' });
    }
    
    res.json({ message: 'Section deleted successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
