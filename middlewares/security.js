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

// Per-word endpoints (word-by-word tooltips, tajweed glyphs) fire once per
// rendered verse — a single reader scrolling a long surah legitimately makes
// 100-200 of these per minute. They get their own high-cap limiter below so
// they can't starve the core content endpoints out of the shared read budget.
const isPerWordRequest = (req) =>
  req.path.includes('/word-by-word/') || req.path.includes('/tajweed/');

// ponytail: IP-keyed in-process counters. Fine for one node. Move to
// rate-limit-redis (redis client already in config/redis.js) when we run >1 instance.
const readLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.RATE_LIMIT_READ || 120),
  message: { error: 'Too Many Requests', message: 'Slow down. Contact us if you need bulk access.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => isTrusted(req) || isPerWordRequest(req),
});

const perWordLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.RATE_LIMIT_PER_WORD || 600),
  message: { error: 'Too Many Requests', message: 'Slow down. Contact us if you need bulk access.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => isTrusted(req) || !isPerWordRequest(req),
});

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

module.exports = { readLimiter, perWordLimiter, searchLimiter, writeLimiter, isTrusted };
