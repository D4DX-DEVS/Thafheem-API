const mysqlPool = require('../config/database');

const getSurahVerseCount = async (surahNum) => {
  const [rows] = await mysqlPool.query('SELECT COUNT(*) as total FROM quranayas WHERE suraid = ?', [surahNum]);
  return rows?.[0]?.total || 0;
};

const buildPaginationMeta = (page, limit, totalItems, fromAyah, toAyah) => {
  const totalPages = Math.max(1, Math.ceil(totalItems / limit));
  return {
    page,
    limit,
    totalItems,
    totalPages,
    from: fromAyah,
    to: toAyah,
    hasNext: page < totalPages,
    hasPrev: page > 1
  };
};

module.exports = {
  getSurahVerseCount,
  buildPaginationMeta
};

