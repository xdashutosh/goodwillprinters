const { S3Client } = require('@aws-sdk/client-s3');
require('dotenv').config();

const region = process.env.AWS_REGION;
const bucket = process.env.AWS_BUCKET_NAME;

// Resolve the S3 endpoint. Falls back to the Linode Object Storage host for the
// configured region if S3_ENDPOINT is not explicitly set.
const endpoint =
  process.env.S3_ENDPOINT ||
  (region ? `https://${region}.linodeobjects.com` : undefined);

const s3Client = new S3Client({
  region,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
  endpoint,
  forcePathStyle: true, // Needed for Linode Object Storage
});

// Virtual-hosted public URL base, e.g. https://demo1.in-maa-1.linodeobjects.com
const publicBase = endpoint ? endpoint.replace('https://', `https://${bucket}.`) : '';

// Build the public URL for a stored object key
const publicUrl = (key) => `${publicBase}/${key}`;

// Extract the object key back out of a stored public URL
const keyFromUrl = (url) => {
  if (!url) return null;
  return url.replace(`${publicBase}/`, '');
};

module.exports = s3Client;
module.exports.s3Client = s3Client;
module.exports.endpoint = endpoint;
module.exports.publicBase = publicBase;
module.exports.publicUrl = publicUrl;
module.exports.keyFromUrl = keyFromUrl;
