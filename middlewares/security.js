const rateLimit = require('express-rate-limit');

// Requests carrying the internal key skip all limits — this is how our own
// scrapers / migration jobs keep working after limits go on.
const isTrusted = (req) =>
  !!process.env.INTERNAL_API_KEY &&
  req.get('x-internal-key') === process.env.INTERNAL_API_KEY;

const limiter = (windowMs, max, message) =>
  rateLimit({
    windowMs,
    max,
    message: { error: 'Too Many Requests', message },
    standardHeaders: true,
    legacyHeaders: false,
    skip: isTrusted,
  });

// ponytail: IP-keyed in-process counters. Fine for one node. Move to
// rate-limit-redis (redis client already in config/redis.js) when we run >1 instance.
const readLimiter = limiter(
  60 * 1000,
  Number(process.env.RATE_LIMIT_READ || 120),
  'Slow down. Contact us if you need bulk access.'
);

// Search is the expensive, scrape-attractive surface: LIKE '%q%' full scans.
const searchLimiter = limiter(
  60 * 1000,
  Number(process.env.RATE_LIMIT_SEARCH || 20),
  'Too many searches. Try again in a minute.'
);

const writeLimiter = limiter(
  15 * 60 * 1000,
  Number(process.env.RATE_LIMIT_WRITE || 30),
  'Too many writes. Try again later.'
);

module.exports = { readLimiter, searchLimiter, writeLimiter, isTrusted };
