const jwt = require('jsonwebtoken');

const verifyToken = (req, res, next) => {
  const token = req.headers['authorization'];
  if (!token) return res.status(403).json({ error: 'No token provided' });

  const tokenString = token.split(' ')[1];
  if (!tokenString) return res.status(403).json({ error: 'Invalid token format' });

  jwt.verify(tokenString, process.env.JWT_SECRET, (err, decoded) => {
    if (err) return res.status(401).json({ error: 'Unauthorized' });
    req.userId = decoded.id;
    req.userRole = decoded.role;
    next();
  });
};

const isAdmin = (req, res, next) => {
  if (req.userRole !== 'admin') {
    return res.status(403).json({ error: 'Require Admin Role' });
  }
  next();
};

module.exports = { verifyToken, isAdmin };
