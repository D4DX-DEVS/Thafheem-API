'use strict';

const mysqlPool = require('../config/database');

const DEFAULT_SURAH_PAGE_SIZE = 5;
const DEFAULT_TAFHEEM_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

// Normalizes a raw MySQL quiz row into the clean frontend-ready format.
// Backend normalization means the frontend's transformQuizData passes through
// with no field-guessing needed.
function normalizeRow(row) {
  const answerIndex = parseInt(row.Answer) || 1;
  const letters = ['A', 'B', 'C'];
  return {
    id: row.ID,
    question: row.Question,
    options: [
      { id: 'A', text: row.Option1 },
      { id: 'B', text: row.Option2 },
      { id: 'C', text: row.Option3 },
    ],
    correctAnswer: letters[answerIndex - 1] || 'A',
    surahId: row.SuraId,
    ayahFrom: row.Saya,
    ayahTo: row.Eaya,
  };
}

// GET /api/quiz/surah/:surahId?page=1&pageSize=5
// Paginated surah quiz â€” pure MySQL, instant COUNT + LIMIT/OFFSET.
exports.getSurahQuizPaginated = async (req, res) => {
  try {
    const surahId = parseInt(req.params.surahId);
    if (!surahId || surahId < 1 || surahId > 114) {
      return res.status(400).json({ error: 'Invalid surahId. Must be 1â€“114.' });
    }
    const page     = Math.max(1, parseInt(req.query.page) || 1);
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(req.query.pageSize) || DEFAULT_SURAH_PAGE_SIZE));
    const offset   = (page - 1) * pageSize;

    const [[{ total }]] = await mysqlPool.query(
      'SELECT COUNT(*) as total FROM quiz WHERE SuraId = ?',
      [surahId]
    );
    const [rows] = await mysqlPool.query(
      'SELECT * FROM quiz WHERE SuraId = ? ORDER BY ID ASC LIMIT ? OFFSET ?',
      [surahId, pageSize, offset]
    );

    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    res.json({
      surahId,
      page,
      pageSize,
      totalQuestions: total,
      totalPages,
      allBlocksFetched: true,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
      questions: rows.map(normalizeRow),
    });
  } catch (err) {
    console.error('getSurahQuizPaginated error:', err.message);
    res.status(500).json({ error: 'Failed to load quiz questions', message: err.message });
  }
};

// GET /api/quiz/tafheem?page=1&pageSize=20&seed=12345
// Entire-Tafheem pagination using ORDER BY RAND(seed) so the same seed
// gives a stable ordering â€” meaning going back to page 1 with the same
// seed returns the same questions (no duplicates across pages).
exports.getTafheemQuizPaginated = async (req, res) => {
  try {
    const page     = Math.max(1, parseInt(req.query.page) || 1);
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(req.query.pageSize) || DEFAULT_TAFHEEM_PAGE_SIZE));
    const seed     = parseInt(req.query.seed) || 1;
    const offset   = (page - 1) * pageSize;

    const [[{ total }]] = await mysqlPool.query('SELECT COUNT(*) as total FROM quiz');
    const [rows] = await mysqlPool.query(
      'SELECT * FROM quiz ORDER BY RAND(?) LIMIT ? OFFSET ?',
      [seed, pageSize, offset]
    );

    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    res.json({
      page,
      pageSize,
      seed,
      totalQuestions: total,
      totalPages,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
      questions: rows.map(normalizeRow),
    });
  } catch (err) {
    console.error('getTafheemQuizPaginated error:', err.message);
    res.status(500).json({ error: 'Failed to load Tafheem quiz', message: err.message });
  }
};

// GET /api/quiz/block/:surahId/:from/:to
// Block-wise quiz â€” returns all questions for a specific ayah range.
exports.getBlockQuiz = async (req, res) => {
  try {
    const surahId = parseInt(req.params.surahId);
    const { from, to } = req.params;

    const [rows] = await mysqlPool.query(
      'SELECT * FROM quiz WHERE SuraId = ? AND Saya = ? AND Eaya = ? ORDER BY ID ASC',
      [surahId, String(from), String(to)]
    );

    // Fallback: if no exact range match, return random questions from the surah
    if (rows.length === 0) {
      const [fallback] = await mysqlPool.query(
        'SELECT * FROM quiz WHERE SuraId = ? ORDER BY RAND() LIMIT 6',
        [surahId]
      );
      return res.json({ surahId, from, to, questions: fallback.map(normalizeRow) });
    }

    res.json({ surahId, from, to, questions: rows.map(normalizeRow) });
  } catch (err) {
    console.error('getBlockQuiz error:', err.message);
    res.status(500).json({ error: 'Failed to load block quiz', message: err.message });
  }
};

// DELETE /api/quiz/cache â€” kept for API compatibility (no-op, MySQL needs no cache)
exports.clearQuizCache = (req, res) => {
  res.json({ message: 'Quiz now uses MySQL directly â€” no in-memory cache to clear.' });
};
