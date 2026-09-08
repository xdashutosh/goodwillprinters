const { Pool } = require('pg');
const dns = require('dns');
require('dotenv').config();

// Ensure reliable DNS resolution for Neon host even if local system/ISP DNS times out
try {
  dns.setServers(['8.8.8.8', '1.1.1.1', '8.8.4.4']);
  const origLookup = dns.lookup;
  dns.lookup = function (hostname, options, callback) {
    if (typeof options === 'function') {
      callback = options;
      options = {};
    }
    dns.resolve4(hostname, (err, addrs) => {
      if (!err && addrs && addrs.length > 0) {
        if (options && options.all) {
          return callback(null, addrs.map((a) => ({ address: a, family: 4 })));
        }
        return callback(null, addrs[0], 4);
      }
      return origLookup.call(dns, hostname, options, callback);
    });
  };
} catch (dnsErr) {
  console.warn('DNS fallback setup warning:', dnsErr.message);
}

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  // Recycle idle connections before Neon's pooler drops them (avoids ETIMEDOUT churn)
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  keepAlive: true,
});

// Pooled/serverless Postgres (Neon) drops idle connections routinely. That surfaces
// here as an idle-client error — log it and let the pool recover on the next query
// instead of crashing the whole server.
pool.on('error', (err) => {
  console.error('Postgres idle client error (recovering):', err.message);
});

module.exports = pool;

