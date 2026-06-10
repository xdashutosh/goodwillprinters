const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { verifyToken, isAdmin } = require('../middleware/auth');
const sendEmail = require('../utils/emailService');

// Submit enquiry (Public)
router.post('/', async (req, res) => {
  try {
    const { name, email, phone, company, message, product_id } = req.body;
    
    // Validate
    if (!name || !email || !message) {
      return res.status(400).json({ error: 'Name, email, and message are required' });
    }

    // Insert into DB
    const result = await pool.query(`
      INSERT INTO enquiries (name, email, phone, company, message, product_id, status)
      VALUES ($1, $2, $3, $4, $5, $6, 'new')
      RETURNING *
    `, [name, email, phone, company, message, product_id || null]);
    
    const enquiry = result.rows[0];

    // Get product details if provided for the email
    let productDetails = '';
    if (product_id) {
      const prodRes = await pool.query('SELECT name FROM products WHERE id = $1', [product_id]);
      if (prodRes.rows.length > 0) {
        productDetails = `Product of Interest: ${prodRes.rows[0].name}\n`;
      }
    }

    // Send email notification to Admin
    const emailText = `
New Enquiry from Plan.A.Day Website:

Name: ${name}
Email: ${email}
Phone: ${phone || 'N/A'}
Company: ${company || 'N/A'}
${productDetails}
Message:
${message}
    `;

    // Fire and forget email sending
    sendEmail(
      process.env.ADMIN_EMAIL, 
      `New Enquiry from ${name} (Plan.A.Day)`, 
      emailText
    ).catch(err => console.error('Failed to send email:', err));

    res.status(201).json({ message: 'Enquiry submitted successfully', id: enquiry.id });
  } catch (err) {
    console.error('Enquiry Submission Error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// --- ADMIN ROUTES ---

// Get all enquiries
router.get('/admin/all', verifyToken, isAdmin, async (req, res) => {
  try {
    const { status } = req.query;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const offset = (page - 1) * limit;

    let baseQuery = `
      FROM enquiries e
      LEFT JOIN products p ON e.product_id = p.id
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN sections s ON c.section_id = s.id
      LEFT JOIN LATERAL (
        SELECT thumbnail_url, image_url
        FROM product_images
        WHERE product_id = p.id
        ORDER BY is_primary DESC, sort_order ASC
        LIMIT 1
      ) pi ON true
    `;
    const params = [];

    if (status) {
      baseQuery += ` WHERE e.status = $1`;
      params.push(status);
    }

    const countQuery = `SELECT COUNT(*) ${baseQuery}`;
    const countResult = await pool.query(countQuery, params);

    let paramIndex = params.length + 1;
    const dataQuery = `
      SELECT e.*,
        p.name AS product_name,
        p.slug AS product_slug,
        p.cover_style AS product_cover_style,
        c.name AS product_category,
        s.name AS product_section,
        s.slug AS product_section_slug,
        pi.thumbnail_url AS product_image,
        pi.image_url AS product_image_full
      ${baseQuery}
      ORDER BY e.created_at DESC
      LIMIT $${paramIndex++} OFFSET $${paramIndex++}
    `;
    params.push(limit, offset);
    
    const result = await pool.query(dataQuery, params);
    
    res.json({
      enquiries: result.rows,
      total: parseInt(countResult.rows[0].count, 10),
      page: parseInt(page, 10),
      totalPages: Math.ceil(parseInt(countResult.rows[0].count, 10) / limit)
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Update enquiry status
router.put('/:id/status', verifyToken, isAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body; // 'new', 'contacted', 'resolved'
    
    if (!['new', 'contacted', 'resolved'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const result = await pool.query(`
      UPDATE enquiries 
      SET status = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
      RETURNING *
    `, [status, id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Enquiry not found' });
    }
    
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete enquiry
router.delete('/:id', verifyToken, isAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM enquiries WHERE id = $1 RETURNING id', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Enquiry not found' });
    }
    
    res.json({ message: 'Enquiry deleted successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
