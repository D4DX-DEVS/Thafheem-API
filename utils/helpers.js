// Helper to extract single ayah from range-based text
const extractAyahFromRange = (text, targetAyah, fromAyah, toAyah) => {
  if (!text) return '';
  // Pattern: (1:1) text (1:2) text or (1) text (2) text
  const patterns = [
    new RegExp(`\\(${targetAyah}\\)\\s*([^()]+)`, 'i'),
    new RegExp(`\\(\\d+:${targetAyah}\\)\\s*([^()]+)`, 'i'),
    new RegExp(`\\(${targetAyah}:\\d+\\)\\s*([^()]+)`, 'i')
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1].trim();
  }
  // Fallback: return full text if only one ayah in range
  return fromAyah === toAyah ? text : '';
};

const normalizeAyahNumber = (value, fallback = null) => {
  if (value === null || value === undefined) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (Number.isFinite(parsed)) {
    return parsed;
  }

  const floatParsed = Number.parseFloat(value);
  if (Number.isFinite(floatParsed)) {
    return Math.floor(floatParsed);
  }

  return fallback;
};

const parsePositiveInt = (value, fallback) => {
  const parsed = parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const isPaginationRequested = (query = {}) => {
  const paginationKeys = ['page', 'pageSize', 'limit', 'per_page', 'offset', 'from', 'to'];
  return paginationKeys.some(key => query[key] !== undefined);
};

module.exports = {
  extractAyahFromRange,
  normalizeAyahNumber,
  parsePositiveInt,
  isPaginationRequested
};



