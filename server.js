require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();

// CORS — allow requests from any origin (public API).
// `origin: true` reflects the request's Origin header, which permits any origin
// while staying compatible with credentialed requests.
app.use(
  cors({
    origin: true,
    credentials: true,
  })
);
app.use(express.json({ limit: '2mb' }));

// Health check
app.get('/', (req, res) => {
  res.send('Plan.A.Day Backend API is running');
});
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// Import routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/sections', require('./routes/sections'));
app.use('/api/categories', require('./routes/categories'));
app.use('/api/products', require('./routes/products'));
app.use('/api/images', require('./routes/images'));
app.use('/api/enquiries', require('./routes/enquiries'));
app.use('/api/settings', require('./routes/settings'));

// 404 handler for unknown routes
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Centralized error handler (catches Multer errors, etc.)
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'File too large' });
  }
  res.status(err.status || 500).json({ error: err.message || 'Server error' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
