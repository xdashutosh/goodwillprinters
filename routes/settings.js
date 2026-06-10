const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { verifyToken, isAdmin } = require('../middleware/auth');

// Keys whose values are stored as JSON and should be parsed on the way out
const JSON_KEYS = new Set(['banners']);

const rowsToObject = (rows) => {
  const out = {};
  for (const { key, value } of rows) {
    if (JSON_KEYS.has(key)) {
      try {
        out[key] = value ? JSON.parse(value) : [];
      } catch {
        out[key] = [];
      }
    } else {
      out[key] = value;
    }
  }
  return out;
};

// Get all site settings (public) — returns a flat key/value object
router.get('/', async (req, res) => {
  try {
    const result = await pool.query('SELECT key, value FROM site_settings');
    res.json(rowsToObject(result.rows));
  } catch (err) {
    console.error('Settings fetch error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Upsert one or many settings (admin). Body: { key: value, ... }
router.put('/', verifyToken, isAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    const updates = req.body || {};
    if (typeof updates !== 'object' || Array.isArray(updates)) {
      return res.status(400).json({ error: 'Expected an object of key/value pairs' });
    }

    await client.query('BEGIN');
    for (const [key, rawValue] of Object.entries(updates)) {
      const value = JSON_KEYS.has(key) || typeof rawValue === 'object'
        ? JSON.stringify(rawValue)
        : String(rawValue ?? '');
      await client.query(
        `INSERT INTO site_settings (key, value, updated_at)
         VALUES ($1, $2, CURRENT_TIMESTAMP)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
        [key, value]
      );
    }
    await client.query('COMMIT');

    const result = await client.query('SELECT key, value FROM site_settings');
    res.json(rowsToObject(result.rows));
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Settings update error:', err);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

module.exports = router;
