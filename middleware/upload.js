const multer = require('multer');
const path = require('path');

// Use memory storage so we can process with Sharp
const storage = multer.memoryStorage();

// Accept only images (by mime type, or by extension when the browser sends a
// generic octet-stream — common for .tif files).
const ALLOWED_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.tif', '.tiff', '.bmp', '.avif']);

const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname || '').toLowerCase();
  const isImageMime = (file.mimetype || '').startsWith('image/');
  if (isImageMime || ALLOWED_EXT.has(ext)) {
    return cb(null, true);
  }
  const err = new Error('Only image files are allowed');
  err.code = 'INVALID_FILE_TYPE';
  err.status = 400;
  cb(err);
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 150 * 1024 * 1024, // 150MB limit to allow large TIF files
  },
});

module.exports = upload;
