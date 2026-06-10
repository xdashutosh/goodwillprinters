const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { verifyToken, isAdmin } = require('../middleware/auth');

// Get all active categories (optional section filter)
router.get('/', async (req, res) => {
  try {
    const { section } = req.query;
    
    let query = `
      SELECT c.*, s.name as section_name, s.slug as section_slug
      FROM categories c
      JOIN sections s ON c.section_id = s.id
      WHERE c.is_active = true AND s.is_active = true
    `;
    const params = [];
    
    if (section) {
      query += ` AND s.slug = $1`;
      params.push(section);
    }
    
    query += ` ORDER BY c.sort_order ASC`;
    
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get single category by slug
router.get('/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    const result = await pool.query(`
      SELECT c.*, s.name as section_name, s.slug as section_slug
      FROM categories c
      JOIN sections s ON c.section_id = s.id
      WHERE c.slug = $1 AND c.is_active = true
    `, [slug]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Category not found' });
    }
    
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// --- ADMIN ROUTES ---

// Get all categories (including inactive)
router.get('/admin/all', verifyToken, isAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT c.*, s.name as section_name 
      FROM categories c
      JOIN sections s ON c.section_id = s.id
      ORDER BY s.sort_order ASC, c.sort_order ASC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Create category
router.post('/', verifyToken, isAdmin, async (req, res) => {
  try {
    const { section_id, name, slug, description, size_label, type_label, image_url, meta_title, meta_description, meta_keywords, sort_order, is_active } = req.body;
    
    const result = await pool.query(`
      INSERT INTO categories (section_id, name, slug, description, size_label, type_label, image_url, meta_title, meta_description, meta_keywords, sort_order, is_active)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *
    `, [section_id, name, slug, description, size_label, type_label, image_url, meta_title, meta_description, meta_keywords, sort_order || 0, is_active !== false]);
    
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    if (err.constraint === 'categories_slug_key') {
      return res.status(400).json({ error: 'Slug already exists' });
    }
    res.status(500).json({ error: 'Server error' });
  }
});

// Update category
router.put('/:id', verifyToken, isAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { section_id, name, slug, description, size_label, type_label, image_url, meta_title, meta_description, meta_keywords, sort_order, is_active } = req.body;
    
    const result = await pool.query(`
      UPDATE categories
      SET section_id = $1, name = $2, slug = $3, description = $4, size_label = $5, type_label = $6, image_url = $7, meta_title = $8, meta_description = $9, meta_keywords = $10, sort_order = $11, is_active = $12, updated_at = CURRENT_TIMESTAMP
      WHERE id = $13
      RETURNING *
    `, [section_id, name, slug, description, size_label, type_label, image_url, meta_title, meta_description, meta_keywords, sort_order, is_active, id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Category not found' });
    }
    
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    if (err.constraint === 'categories_slug_key') {
      return res.status(400).json({ error: 'Slug already exists' });
    }
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete category
router.delete('/:id', verifyToken, isAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM categories WHERE id = $1 RETURNING id', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Category not found' });
    }
    
    res.json({ message: 'Category deleted successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
