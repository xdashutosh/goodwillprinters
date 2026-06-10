const slugify = require('slugify');

const generateSlug = (text) => {
  return slugify(text, {
    lower: true,
    strict: true,
    trim: true
  });
};

module.exports = generateSlug;
