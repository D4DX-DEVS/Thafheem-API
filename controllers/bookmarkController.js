const mysqlPool = require('../config/database');

// ─── Language code normalizer ─────────────────────────────────────────────────
// Frontend may send 'E', 'en', 'mal', 'bn', 'hi', 'ta', 'ur' — normalise to
// consistent short codes so the bookmarks list can badge/render them correctly.
const LANG_NORMALIZE = {
  'E': 'en',
  'english': 'en',
  'malayalam': 'mal',
  'ml': 'mal',
  'bangla': 'bn',
  'bengali': 'bn',
  'hindi': 'hi',
  'tamil': 'ta',
  'urdu': 'ur',
};
const normalizeLang = (lang) => {
  if (!lang) return null;
  const trimmed = lang.trim().toLowerCase();
  // Check exact match first, then lowercased normalise map
  return LANG_NORMALIZE[lang.trim()] || LANG_NORMALIZE[trimmed] || lang.trim();
};

// ─── Type mapping ────────────────────────────────────────────────────────────
// Frontend sends these types ↔ DB stores these enum values
const FRONTEND_TO_DB_TYPE = {
  'translation': 'verse_translation',
  'block': 'block_translation',
  'interpretation': 'interpretation',
  'block-interpretation': 'interpretation',   // stored under same enum
  'word-by-word': 'verse_translation',        // closest match
  'quran_page': 'quran_page',
  'audio_player': 'audio_player',
};
const DB_TO_FRONTEND_TYPE = {
  'verse_translation': 'translation',
  'block_translation': 'block',
  'interpretation': 'interpretation',
  'quran_page': 'quran_page',
  'audio_player': 'audio_player',
};

/** Convert a DB row into the shape the frontend expects */
const mapRowToFrontend = (row) => ({
  id: row.id,
  userId: String(row.uid),
  surahId: row.surahnumber,
  verseId: row.ayanumber,
  bookmarkType: DB_TO_FRONTEND_TYPE[row.bk_type] || row.bk_type,
  surahName: row.surah_name || '',
  verseText: row.bk_text || '',
  blockFrom: null,
  blockTo: null,
  range: row.refno || null,
  language: normalizeLang(row.language),
  createdAt: null,
});

/** Convert ISO datetime string → MySQL DATETIME format */
const toMysqlDatetime = (isoOrNull) => {
  if (!isoOrNull) return new Date().toISOString().slice(0, 19).replace('T', ' ');
  const d = new Date(isoOrNull);
  if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 19).replace('T', ' ');
  return d.toISOString().slice(0, 19).replace('T', ' ');
};

// ─── Bookmarks ───────────────────────────────────────────────────────────────

/**
 * GET /api/bookmarks?userId=X&bkType=Y
 * Fetch bookmarks for a user, optionally filtered by type.
 */
const getBookmarks = async (req, res) => {
  const { userId, bkType, language } = req.query;

  if (!userId) {
    return res.status(400).json({ error: 'userId query parameter is required' });
  }

  try {
    let sql = 'SELECT * FROM bookmarks WHERE uid = ?';
    const params = [userId];

    if (bkType) {
      const dbType = FRONTEND_TO_DB_TYPE[bkType] || bkType;
      sql += ' AND bk_type = ?';
      params.push(dbType);
    }

    if (language) {
      sql += ' AND language = ?';
      params.push(normalizeLang(language));
    }

    sql += ' ORDER BY id DESC';

    const [rows] = await mysqlPool.query(sql, params);
    return res.json(rows.map(mapRowToFrontend));
  } catch (error) {
    console.error('Error fetching bookmarks:', error.message);
    return res.status(500).json({ error: 'Failed to fetch bookmarks' });
  }
};

/**
 * POST /api/bookmarks
 * Create a new bookmark.
 */
const addBookmark = async (req, res) => {
  const {
    userId, surahId, verseId, bookmarkType,
    verseText, range, language, surahName, createdAt,
  } = req.body;

  if (!userId || !surahId || !bookmarkType) {
    return res.status(400).json({ error: 'userId, surahId, and bookmarkType are required' });
  }

  const dbType = FRONTEND_TO_DB_TYPE[bookmarkType] || 'verse_translation';
  const refno = range || '0';
  const normalizedLang = normalizeLang(language);

  try {
    const [result] = await mysqlPool.query(
      `INSERT INTO bookmarks (uid, surahnumber, ayanumber, refno, bk_type, bk_text, language, surah_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        parseInt(surahId, 10),
        verseId != null ? parseInt(verseId, 10) : 0,
        refno,
        dbType,
        verseText || null,
        normalizedLang,
        surahName || null,
      ],
    );

    return res.status(201).json({
      id: result.insertId,
      userId,
      surahId: parseInt(surahId, 10),
      verseId: verseId != null ? parseInt(verseId, 10) : null,
      bookmarkType,
      surahName: surahName || null,
      verseText: verseText || null,
      range: refno,
      language: normalizedLang,
    });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Bookmark already exists' });
    }
    console.error('Error adding bookmark:', error.message);
    return res.status(500).json({ error: 'Failed to add bookmark' });
  }
};

/**
 * DELETE /api/bookmarks/delete/:id
 * Remove a bookmark by its ID.
 */
const deleteBookmark = async (req, res) => {
  const { id } = req.params;
  // `id` is an AUTO_INCREMENT integer, so deleting by id alone let anyone walk
  // 1, 2, 3... and wipe every user's bookmarks. Scoping the delete to the owner
  // means the caller has to know the uid as well, which blocks blind
  // enumeration. This is not authentication — the uid is still client-supplied;
  // REQUIRE_USER_AUTH is what makes it trustworthy. See middlewares/requireUser.
  const userId = req.query.userId || (req.body && req.body.userId);

  if (!id) {
    return res.status(400).json({ error: 'Bookmark id is required' });
  }

  if (!userId) {
    return res.status(400).json({ error: 'userId is required' });
  }

  try {
    const [result] = await mysqlPool.query(
      'DELETE FROM bookmarks WHERE id = ? AND uid = ?',
      [id, userId],
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Bookmark not found' });
    }

    return res.json({ success: true });
  } catch (error) {
    console.error('Error deleting bookmark:', error.message);
    return res.status(500).json({ error: 'Failed to delete bookmark' });
  }
};

// ─── Favorites ───────────────────────────────────────────────────────────────

/**
 * GET /api/favorites?userId=X
 * Fetch favorite surahs for a user.
 */
const getFavorites = async (req, res) => {
  const { userId } = req.query;

  if (!userId) {
    return res.status(400).json({ error: 'userId query parameter is required' });
  }

  try {
    const [rows] = await mysqlPool.query(
      'SELECT * FROM favorites WHERE userId = ? ORDER BY createdAt DESC',
      [userId],
    );
    return res.json(rows);
  } catch (error) {
    console.error('Error fetching favorites:', error.message);
    return res.status(500).json({ error: 'Failed to fetch favorites' });
  }
};

/**
 * POST /api/favorites
 * Add a surah to favorites.
 */
const addFavorite = async (req, res) => {
  const { id, userId, surahId, surahName, createdAt } = req.body;

  if (!userId || !surahId) {
    return res.status(400).json({ error: 'userId and surahId are required' });
  }

  const favoriteId = id || `${userId}_surah_${surahId}_${Date.now()}`;
  const now = toMysqlDatetime(createdAt);

  try {
    await mysqlPool.query(
      `INSERT INTO favorites (id, userId, surahId, surahName, createdAt)
       VALUES (?, ?, ?, ?, ?)`,
      [favoriteId, userId, parseInt(surahId, 10), surahName || null, now],
    );

    return res.status(201).json({
      id: favoriteId,
      userId,
      surahId: parseInt(surahId, 10),
      surahName: surahName || null,
      createdAt: now,
    });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Surah already in favorites' });
    }
    console.error('Error adding favorite:', error.message);
    return res.status(500).json({ error: 'Failed to add favorite' });
  }
};

/**
 * DELETE /api/favorites/:userId/:surahId
 * Remove a surah from favorites.
 */
const deleteFavorite = async (req, res) => {
  const { userId, surahId } = req.params;

  if (!userId || !surahId) {
    return res.status(400).json({ error: 'userId and surahId are required' });
  }

  try {
    const [result] = await mysqlPool.query(
      'DELETE FROM favorites WHERE userId = ? AND surahId = ?',
      [userId, parseInt(surahId, 10)],
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Favorite not found' });
    }

    return res.json({ success: true });
  } catch (error) {
    console.error('Error deleting favorite:', error.message);
    return res.status(500).json({ error: 'Failed to delete favorite' });
  }
};

module.exports = {
  getBookmarks,
  addBookmark,
  deleteBookmark,
  getFavorites,
  addFavorite,
  deleteFavorite,
};
