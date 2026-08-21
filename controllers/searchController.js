/**
 * Search Controller
 * Implements the 5 legacy search APIs from SEARCH_API_DOCUMENTATION.md
 * All endpoints support pagination via ?page=1&limit=10
 */

const mysqlPool = require('../config/database');

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

const parsePage  = (val) => Math.max(1, parseInt(val, 10) || 1);
const parseLimit = (val) => Math.min(MAX_LIMIT, Math.max(1, parseInt(val, 10) || DEFAULT_LIMIT));

// ─────────────────────────────────────────────
// 1. Arabic Phrase Search  (API 4 equivalent)
//    GET /api/search/arabic-phrase?q=<arabic>&page=1&limit=10
//    Searches quranayas.AyaNText (no diacritics → better matching)
// ─────────────────────────────────────────────
exports.searchArabicPhrase = async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q) return res.status(400).json({ error: 'Query required', message: 'Use ?q=<arabic text>' });

    const page  = parsePage(req.query.page);
    const limit = parseLimit(req.query.limit);
    const offset = (page - 1) * limit;
    const like = `%${q}%`;

    const [[{ total }]] = await mysqlPool.query(
      'SELECT COUNT(*) AS total FROM quranayas WHERE AyaNText LIKE ?',
      [like]
    );

    const [rows] = await mysqlPool.query(
      `SELECT qa.contiayano, qa.suraid, qa.ayaid, qa.AyaHText, qa.pageid,
              qa.QAudioUrl, qa.TransUrl, qa.InterPtnUrl, st.ASuraName,
              qa.AudioText, qa.AudioIntrerptn
       FROM quranayas qa
       JOIN suratable st ON st.SuraId = qa.suraid
       WHERE qa.AyaNText LIKE ?
       ORDER BY qa.contiayano
       LIMIT ? OFFSET ?`,
      [like, limit, offset]
    );

    res.json({
      query: q,
      total: Number(total),
      page,
      limit,
      hasMore: offset + rows.length < Number(total),
      results: rows.map(r => ({
        surah: r.suraid,
        ayah:  r.ayaid,
        contiayano: r.contiayano,
        arabicText: r.AyaHText || '',
        translationText: r.AudioText || '',
        suraName: r.ASuraName ? r.ASuraName.trim() : '',
        audioUrl: r.QAudioUrl || ''
      }))
    });
  } catch (err) {
    console.error('❌ searchArabicPhrase:', err.message);
    res.status(500).json({ error: 'Database error', message: 'Something went wrong' });
  }
};

// ─────────────────────────────────────────────
// 2. Malayalam / English Text Search  (API 5 equivalent)
//    GET /api/search/text?q=...&lang=mal|eng&type=translation|interpretation&page=1&limit=10
// ─────────────────────────────────────────────
exports.searchText = async (req, res) => {
  try {
    const q    = (req.query.q || '').trim();
    const lang = (req.query.lang || 'mal').toLowerCase();
    const type = (req.query.type || 'translation').toLowerCase();

    if (!q) return res.status(400).json({ error: 'Query required', message: 'Use ?q=<search term>' });

    const isMal = lang === 'mal' || lang === 'malayalam';
    const isEng = lang === 'eng' || lang === 'e' || lang === 'english';

    if (!isMal && !isEng) {
      return res.status(400).json({ error: 'Invalid lang', message: 'Use lang=mal or lang=eng' });
    }

    const page   = parsePage(req.query.page);
    const limit  = parseLimit(req.query.limit);
    const offset = (page - 1) * limit;
    const like   = `%${q}%`;

    let total = 0;
    let rows  = [];

    // ── Malayalam ──────────────────────────────
    if (isMal) {
      if (type === 'interpretation') {
        // malinterpretation.Interpretation
        [[{ total }]] = await mysqlPool.query(
          'SELECT COUNT(*) AS total FROM malinterpretation WHERE Interpretation LIKE ?',
          [like]
        );
        [rows] = await mysqlPool.query(
          `SELECT ID, SuraID AS surah, AyaFrom AS ayah, InterpretationNo, Interpretation AS matchedText
           FROM malinterpretation
           WHERE Interpretation LIKE ?
           ORDER BY ID
           LIMIT ? OFFSET ?`,
          [like, limit, offset]
        );
      } else {
        // qurmaltranslation.TranslationText (paragraph-level translation)
        [[{ total }]] = await mysqlPool.query(
          'SELECT COUNT(*) AS total FROM qurmaltranslation WHERE TranslationText LIKE ?',
          [like]
        );
        [rows] = await mysqlPool.query(
          `SELECT ID, SuraID AS surah, ayafrom AS ayah, TranslationText AS matchedText
           FROM qurmaltranslation
           WHERE TranslationText LIKE ?
           ORDER BY ID
           LIMIT ? OFFSET ?`,
          [like, limit, offset]
        );
      }
    }

    // ── English ────────────────────────────────
    if (isEng) {
      if (type === 'interpretation') {
        // enginterpretation.Interpretation
        [[{ total }]] = await mysqlPool.query(
          'SELECT COUNT(*) AS total FROM enginterpretation WHERE Interpretation LIKE ?',
          [like]
        );
        [rows] = await mysqlPool.query(
          `SELECT ID, SuraId AS surah, ayafrom AS ayah, InterpretationNo, Interpretation AS matchedText
           FROM enginterpretation
           WHERE Interpretation LIKE ?
           ORDER BY ID
           LIMIT ? OFFSET ?`,
          [like, limit, offset]
        );
      } else {
        // eng_translations.translation_text (verse-level)
        [[{ total }]] = await mysqlPool.query(
          'SELECT COUNT(*) AS total FROM eng_translations WHERE translation_text LIKE ?',
          [like]
        );
        [rows] = await mysqlPool.query(
          `SELECT chapter_number AS surah, verse_number AS ayah, translation_text AS matchedText
           FROM eng_translations
           WHERE translation_text LIKE ?
           ORDER BY chapter_number, verse_number
           LIMIT ? OFFSET ?`,
          [like, limit, offset]
        );
      }
    }

    res.json({
      query: q,
      lang,
      type,
      total: Number(total),
      page,
      limit,
      hasMore: offset + rows.length < Number(total),
      results: rows.map(r => ({
        surah: parseInt(r.surah, 10),
        ayah:  parseInt(r.ayah,  10),
        matchedText: r.matchedText || '',
        interpretationNo: r.InterpretationNo || null
      }))
    });
  } catch (err) {
    console.error('❌ searchText:', err.message);
    res.status(500).json({ error: 'Database error', message: 'Something went wrong' });
  }
};

// ─────────────────────────────────────────────
// 3a. List / search Quran subjects  (API 1 setup)
//     GET /api/search/quran-subjects?q=...&lang=mal|eng&page=1&limit=20
// ─────────────────────────────────────────────
exports.searchQuranSubjects = async (req, res) => {
  try {
    const q    = (req.query.q || '').trim();
    const lang = (req.query.lang || 'mal').toLowerCase();
    const all  = req.query.all === 'true'; // bypass pagination for full subject list
    const isMal = lang === 'mal' || lang === 'malayalam';

    const table     = isMal ? 'qursubjects'     : 'qur_eng_subjects';
    const idCol     = 'QurSubjId';
    const subjectCol= 'QurSubject';

    const page   = parsePage(req.query.page);
    const limit  = all ? 9999 : parseLimit(req.query.limit);
    const offset = all ? 0   : (page - 1) * limit;

    let total, dataQuery, params;

    if (q) {
      const like = `%${q}%`;
      [[{ total }]] = await mysqlPool.query(
        `SELECT COUNT(*) AS total FROM ${table} WHERE ${subjectCol} LIKE ?`, [like]
      );
      dataQuery = `SELECT ${idCol} AS id, ${subjectCol} AS subject FROM ${table} WHERE ${subjectCol} LIKE ? ORDER BY ${idCol} LIMIT ? OFFSET ?`;
      params    = [like, limit, offset];
    } else {
      [[{ total }]] = await mysqlPool.query(`SELECT COUNT(*) AS total FROM ${table}`);
      dataQuery = `SELECT ${idCol} AS id, ${subjectCol} AS subject FROM ${table} ORDER BY ${idCol} LIMIT ? OFFSET ?`;
      params    = [limit, offset];
    }

    const [rows] = await mysqlPool.query(dataQuery, params);

    res.json({
      lang,
      q: q || null,
      total: Number(total),
      page: all ? 1 : page,
      limit: all ? Number(total) : limit,
      hasMore: all ? false : offset + rows.length < Number(total),
      subjects: rows
    });
  } catch (err) {
    console.error('❌ searchQuranSubjects:', err.message);
    res.status(500).json({ error: 'Database error', message: 'Something went wrong' });
  }
};

// ─────────────────────────────────────────────
// 3b. Get Quran ayas for a subject (API 1 results)
//     GET /api/search/quran-subject-results/:subjectId?lang=mal|eng&page=1&limit=20
// ─────────────────────────────────────────────
exports.getQuranSubjectResults = async (req, res) => {
  try {
    const subjectId = parseInt(req.params.subjectId, 10);
    if (isNaN(subjectId) || subjectId < 1) {
      return res.status(400).json({ error: 'Invalid subjectId' });
    }

    const lang  = (req.query.lang || 'mal').toLowerCase();
    const isMal = lang === 'mal' || lang === 'malayalam';

    const occurTable = isMal ? 'qursubjoccur'     : 'qur_eng_subjoccur';
    const fkCol      = isMal ? 'QurSubjId'        : 'QurSubjId';
    const suraCol    = isMal ? 'SuraId'            : 'SuraId';
    const ayaCol     = isMal ? 'AyaId'             : 'AyaId';
    const orderCol   = isMal ? 'QSocID'            : 'ID';

    const all    = req.query.all === 'true';
    const page   = parsePage(req.query.page);
    const limit  = all ? 500 : parseLimit(req.query.limit);
    const offset = all ? 0   : (page - 1) * limit;

    [[{ total: totalVal }]] = await mysqlPool.query(
      `SELECT COUNT(*) AS total FROM ${occurTable} WHERE ${fkCol} = ?`,
      [subjectId]
    );
    const total = Number(totalVal);

    let rows;

    if (isMal) {
      [rows] = await mysqlPool.query(
        `SELECT
           qa.contiayano, qso.${suraCol} AS suraid, qso.${ayaCol} AS ayaid,
           qa.AyaHText, qa.pageid, qa.QAudioUrl, qa.TransUrl, qa.InterPtnUrl,
           st.ASuraName, qa.AudioText AS translationText, qa.AudioIntrerptn AS interpretationText
         FROM ${occurTable} qso
         JOIN quranayas qa  ON qa.suraid = qso.${suraCol} AND qa.ayaid = qso.${ayaCol}
         JOIN suratable st  ON st.SuraId = qso.${suraCol}
         WHERE qso.${fkCol} = ?
         ORDER BY qso.${orderCol}
         LIMIT ? OFFSET ?`,
        [subjectId, limit, offset]
      );
    } else {
      [rows] = await mysqlPool.query(
        `SELECT
           qa.contiayano, qso.${suraCol} AS suraid, qso.${ayaCol} AS ayaid,
           qa.AyaHText, qa.pageid, qa.QAudioUrl, qa.TransUrl, qa.InterPtnUrl,
           st.ASuraName,
           et.translation_text AS translationText,
           NULL AS interpretationText
         FROM ${occurTable} qso
         JOIN quranayas qa  ON qa.suraid = qso.${suraCol} AND qa.ayaid = qso.${ayaCol}
         JOIN suratable st  ON st.SuraId = qso.${suraCol}
         LEFT JOIN eng_translations et
           ON et.chapter_number = qso.${suraCol} AND et.verse_number = qso.${ayaCol}
         WHERE qso.${fkCol} = ?
         ORDER BY qso.${orderCol}
         LIMIT ? OFFSET ?`,
        [subjectId, limit, offset]
      );
    }

    res.json({
      subjectId,
      lang,
      total,
      page,
      limit,
      hasMore: offset + rows.length < total,
      results: rows.map(r => ({
        surah: r.suraid,
        ayah:  r.ayaid,
        contiayano: r.contiayano,
        arabicText: r.AyaHText || '',
        translationText: r.translationText || '',
        interpretationText: r.interpretationText || '',
        suraName: r.ASuraName ? r.ASuraName.trim() : '',
        audioUrl: r.QAudioUrl || ''
      }))
    });
  } catch (err) {
    console.error('❌ getQuranSubjectResults:', err.message);
    res.status(500).json({ error: 'Database error', message: 'Something went wrong' });
  }
};

// ─────────────────────────────────────────────
// 4a. List / search Tafseer subjects  (API 2 setup)
//     GET /api/search/tafseer-subjects?q=...&page=1&limit=20
// ─────────────────────────────────────────────
exports.searchTafseerSubjects = async (req, res) => {
  try {
    const q      = (req.query.q || '').trim();
    const all    = req.query.all === 'true'; // bypass pagination for full subject list
    const page   = parsePage(req.query.page);
    const limit  = all ? 9999 : parseLimit(req.query.limit);
    const offset = all ? 0   : (page - 1) * limit;

    let total;
    let rows;

    if (q) {
      const like = `%${q}%`;
      [[{ total }]] = await mysqlPool.query(
        'SELECT COUNT(*) AS total FROM thafsubjects WHERE ThafhmSubject LIKE ?',
        [like]
      );
      [rows] = await mysqlPool.query(
        `SELECT ThafheemId AS id, ThafhmSubject AS subject
         FROM thafsubjects
         WHERE ThafhmSubject LIKE ?
         ORDER BY ThafheemId
         LIMIT ? OFFSET ?`,
        [like, limit, offset]
      );
    } else {
      [[{ total }]] = await mysqlPool.query('SELECT COUNT(*) AS total FROM thafsubjects');
      [rows] = await mysqlPool.query(
        `SELECT ThafheemId AS id, ThafhmSubject AS subject
         FROM thafsubjects
         ORDER BY ThafheemId
         LIMIT ? OFFSET ?`,
        [limit, offset]
      );
    }

    res.json({
      q: q || null,
      total: Number(total),
      page: all ? 1 : page,
      limit: all ? Number(total) : limit,
      hasMore: all ? false : offset + rows.length < Number(total),
      subjects: rows
    });
  } catch (err) {
    console.error('❌ searchTafseerSubjects:', err.message);
    res.status(500).json({ error: 'Database error', message: 'Something went wrong' });
  }
};

// ─────────────────────────────────────────────
// 4b. Get Tafseer subject results (API 2 results)
//     GET /api/search/tafseer-subject-results/:subjectId?page=1&limit=20
// ─────────────────────────────────────────────
exports.getTafseerSubjectResults = async (req, res) => {
  try {
    const subjectId = parseInt(req.params.subjectId, 10);
    if (isNaN(subjectId) || subjectId < 1) {
      return res.status(400).json({ error: 'Invalid subjectId' });
    }

    const all    = req.query.all === 'true';
    const page   = parsePage(req.query.page);
    const limit  = all ? 500 : parseLimit(req.query.limit);
    const offset = all ? 0   : (page - 1) * limit;

    [[{ total: totalVal }]] = await mysqlPool.query(
      'SELECT COUNT(*) AS total FROM thafsubjectoccur WHERE thafheemId = ?',
      [subjectId]
    );
    const total = Number(totalVal);

    const [rows] = await mysqlPool.query(
      `SELECT TSOcId AS id, SuraId AS surah, InterptnNo AS interpretationNo,
              InterpretnContent AS interpretationText
       FROM thafsubjectoccur
       WHERE thafheemId = ?
       ORDER BY TSOcId
       LIMIT ? OFFSET ?`,
      [subjectId, limit, offset]
    );

    res.json({
      subjectId,
      total,
      page,
      limit,
      hasMore: offset + rows.length < total,
      results: rows.map(r => ({
        id:               r.id,
        surah:            r.surah,
        interpretationNo: r.interpretationNo,
        interpretationText: r.interpretationText || ''
      }))
    });
  } catch (err) {
    console.error('❌ getTafseerSubjectResults:', err.message);
    res.status(500).json({ error: 'Database error', message: 'Something went wrong' });
  }
};

// ─────────────────────────────────────────────
// 5a. Word meaning search — Malayalam (qwmmalayalam)
//     GET /api/search/word-meaning?q=...&lang=mal|eng&page=1&limit=10
//     Tables: qwmmalayalam (MalMeaning), qwmenglish (EngMeaning)
//     Both have: WordId, SuraId, AyaId, WordPhrase
// ─────────────────────────────────────────────
exports.searchWordMeaning = async (req, res) => {
  try {
    const q    = (req.query.q || '').trim();
    const lang = (req.query.lang || 'mal').toLowerCase();

    if (!q) return res.status(400).json({ error: 'Query required', message: 'Use ?q=<search term>' });

    const isMal = lang === 'mal' || lang === 'malayalam';
    const isEng = lang === 'eng' || lang === 'e' || lang === 'english';

    if (!isMal && !isEng) {
      return res.status(400).json({ error: 'Invalid lang', message: 'Use lang=mal or lang=eng' });
    }

    const table      = isMal ? 'qwmmalayalam' : 'qwmenglish';
    const meaningCol = isMal ? 'MalMeaning'   : 'EngMeaning';

    const page   = parsePage(req.query.page);
    const limit  = parseLimit(req.query.limit);
    const offset = (page - 1) * limit;
    const like   = `%${q}%`;

    const [[{ total }]] = await mysqlPool.query(
      `SELECT COUNT(*) AS total FROM ${table} WHERE ${meaningCol} LIKE ?`,
      [like]
    );

    const [rows] = await mysqlPool.query(
      `SELECT w.WordId, w.SuraId AS surah, w.AyaId AS ayah,
              w.WordPhrase, w.${meaningCol} AS matchedMeaning,
              qa.AyaHText, qa.AudioText AS translationText, st.ASuraName
       FROM ${table} w
       JOIN quranayas qa ON qa.suraid = w.SuraId AND qa.ayaid = w.AyaId
       JOIN suratable st ON st.SuraId = w.SuraId
       WHERE w.${meaningCol} LIKE ?
       ORDER BY w.SuraId, w.AyaId
       LIMIT ? OFFSET ?`,
      [like, limit, offset]
    );

    res.json({
      query: q,
      lang,
      total: Number(total),
      page,
      limit,
      hasMore: offset + rows.length < Number(total),
      results: rows.map(r => ({
        surah:          parseInt(r.surah, 10),
        ayah:           parseInt(r.ayah,  10),
        wordPhrase:     r.WordPhrase     || '',
        matchedMeaning: r.matchedMeaning || '',
        arabicText:     r.AyaHText       || '',
        translationText: r.translationText || '',
        suraName:       r.ASuraName ? r.ASuraName.trim() : ''
      }))
    });
  } catch (err) {
    console.error('❌ searchWordMeaning:', err.message);
    res.status(500).json({ error: 'Database error', message: 'Something went wrong' });
  }
};

// ─────────────────────────────────────────────
// 4c. Search Arabic roots by text
//     GET /api/search/roots?q=كتب&page=1&limit=10
//     Returns matching root entries from t_words_with_caya
// ─────────────────────────────────────────────
exports.searchRoots = async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q) return res.status(400).json({ error: 'Query required', message: 'Use ?q=<arabic root>' });

    const page   = parsePage(req.query.page);
    const limit  = parseLimit(req.query.limit);
    const offset = (page - 1) * limit;
    // Strip harakat/quranic marks/tatweel and unify alef variants so a
    // voweled query (e.g. كَتَبَ) still matches the plain `root` column.
    // Arabic chars go through bound params — inlined literals get mangled
    // by the connection charset.
    const normalizedQ = q
      .replace(/[ً-ٰٟۖ-ۭـ]/g, '')
      .replace(/[آأإٱ]/g, 'ا')
      .trim() || q;
    const like = `%${normalizedQ}%`;
    const normRoot = "REPLACE(REPLACE(REPLACE(REPLACE(root, ?, ?), ?, ?), ?, ?), ?, ?)";
    const repParams = ['آ', 'ا', 'أ', 'ا', 'إ', 'ا', 'ٱ', 'ا'];

    const [[{ total }]] = await mysqlPool.query(
      `SELECT COUNT(DISTINCT root_id) AS total FROM t_words_with_caya WHERE ${normRoot} LIKE ?`,
      [...repParams, like]
    );

    const [rows] = await mysqlPool.query(
      `SELECT root_id AS rootGroupId, root,
              COUNT(DISTINCT caya) AS verseCount
       FROM t_words_with_caya
       WHERE ${normRoot} LIKE ?
       GROUP BY root_id, root
       ORDER BY root_id
       LIMIT ? OFFSET ?`,
      [...repParams, like, limit, offset]
    );

    res.json({
      query: q,
      total: Number(total),
      page,
      limit,
      hasMore: offset + rows.length < Number(total),
      roots: rows.map(r => ({
        rootGroupId: r.rootGroupId,
        root:        r.root || '',
        verseCount:  Number(r.verseCount)
      }))
    });
  } catch (err) {
    console.error('❌ searchRoots:', err.message);
    res.status(500).json({ error: 'Database error', message: 'Something went wrong' });
  }
};

// ─────────────────────────────────────────────
// 4d. Preloaded Arabic root seed list
//     GET /api/search/roots-seed?page=1&limit=20
// ─────────────────────────────────────────────
exports.getRootSeeds = async (req, res) => {
  try {
    const page = parsePage(req.query.page);
    const rawLimit = parseInt(req.query.limit, 10);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100) : 20;
    const offset = (page - 1) * limit;

    const [[{ total: totalVal }]] = await mysqlPool.query(
      'SELECT COUNT(DISTINCT root_id) AS total FROM t_words_with_caya'
    );
    const total = Number(totalVal);

    const [rows] = await mysqlPool.query(
      `SELECT root_id AS rootGroupId, root,
              COUNT(DISTINCT caya) AS verseCount
       FROM t_words_with_caya
       GROUP BY root_id, root
       ORDER BY root_id
       LIMIT ? OFFSET ?`,
      [limit, offset]
    );

    res.json({
      total,
      page,
      limit,
      hasMore: offset + rows.length < total,
      roots: rows.map((r) => ({
        rootGroupId: r.rootGroupId,
        root: r.root || '',
        verseCount: Number(r.verseCount),
      })),
    });
  } catch (err) {
    console.error('❌ getRootSeeds:', err.message);
    res.status(500).json({ error: 'Database error', message: 'Something went wrong' });
  }
};

// ─────────────────────────────────────────────
// 5. Root word forms  (API 3 equivalent)
//    GET /api/search/root-word-forms/:rootGroupId
// ─────────────────────────────────────────────
exports.getRootWordForms = async (req, res) => {
  try {
    const rootGroupId = parseInt(req.params.rootGroupId, 10);
    if (isNaN(rootGroupId) || rootGroupId < 1) {
      return res.status(400).json({ error: 'Invalid rootGroupId' });
    }

    const [rows] = await mysqlPool.query(
      `SELECT DISTINCT word AS wordForm
       FROM t_words_with_caya
       WHERE root_id = ?
       ORDER BY (SELECT MIN(id) FROM t_words_with_caya t2
                 WHERE t2.root_id = t_words_with_caya.root_id
                   AND t2.word    = t_words_with_caya.word)`,
      [rootGroupId]
    );

    const [rootRows] = await mysqlPool.query(
      'SELECT DISTINCT root FROM t_words_with_caya WHERE root_id = ? LIMIT 1',
      [rootGroupId]
    );

    res.json({
      rootGroupId,
      root: rootRows[0]?.root || '',
      count: rows.length,
      wordForms: rows.map(r => r.wordForm)
    });
  } catch (err) {
    console.error('❌ getRootWordForms:', err.message);
    res.status(500).json({ error: 'Database error', message: 'Something went wrong' });
  }
};

// ─────────────────────────────────────────────
// 6. Verses containing a root word form
//    GET /api/search/root-word-verses/:rootGroupId?page=1&limit=10
// ─────────────────────────────────────────────
exports.getRootWordVerses = async (req, res) => {
  try {
    const rootGroupId = parseInt(req.params.rootGroupId, 10);
    if (isNaN(rootGroupId) || rootGroupId < 1) {
      return res.status(400).json({ error: 'Invalid rootGroupId' });
    }

    const page   = parsePage(req.query.page);
    const limit  = parseLimit(req.query.limit);
    const offset = (page - 1) * limit;

    [[{ total: totalVal }]] = await mysqlPool.query(
      'SELECT COUNT(DISTINCT caya) AS total FROM t_words_with_caya WHERE root_id = ?',
      [rootGroupId]
    );
    const total = Number(totalVal);

    const [rows] = await mysqlPool.query(
      `SELECT DISTINCT
         tw.caya AS contiayano, tw.sura AS suraid, tw.aya AS ayaid, tw.word,
         qa.AyaHText, qa.AudioText, st.ASuraName
       FROM t_words_with_caya tw
       JOIN quranayas qa ON qa.contiayano = tw.caya
       JOIN suratable st ON st.SuraId     = tw.sura
       WHERE tw.root_id = ?
       ORDER BY tw.caya
       LIMIT ? OFFSET ?`,
      [rootGroupId, limit, offset]
    );

    res.json({
      rootGroupId,
      total,
      page,
      limit,
      hasMore: offset + rows.length < total,
      results: rows.map(r => ({
        surah: r.suraid,
        ayah:  r.ayaid,
        contiayano: r.contiayano,
        word: r.word || '',
        arabicText: r.AyaHText || '',
        translationText: r.AudioText || '',
        suraName: r.ASuraName ? r.ASuraName.trim() : ''
      }))
    });
  } catch (err) {
    console.error('❌ getRootWordVerses:', err.message);
    res.status(500).json({ error: 'Database error', message: 'Something went wrong' });
  }
};

// ─────────────────────────────────────────────
// 7. Combined root-word payload (old rootwords style)
//    GET /api/search/rootwords/:rootGroupId?page=1&limit=10
//    Returns: root + wordForms + verse results in one response
// ─────────────────────────────────────────────
exports.getRootWordBundle = async (req, res) => {
  try {
    const rootGroupId = parseInt(req.params.rootGroupId, 10);
    if (isNaN(rootGroupId) || rootGroupId < 1) {
      return res.status(400).json({ error: 'Invalid rootGroupId' });
    }

    const page   = parsePage(req.query.page);
    const limit  = parseLimit(req.query.limit);
    const offset = (page - 1) * limit;

    const [rootRows] = await mysqlPool.query(
      'SELECT DISTINCT root FROM t_words_with_caya WHERE root_id = ? LIMIT 1',
      [rootGroupId]
    );

    const [formRows] = await mysqlPool.query(
      `SELECT DISTINCT word AS wordForm
       FROM t_words_with_caya
       WHERE root_id = ?
       ORDER BY (SELECT MIN(id) FROM t_words_with_caya t2
                 WHERE t2.root_id = t_words_with_caya.root_id
                   AND t2.word    = t_words_with_caya.word)`,
      [rootGroupId]
    );

    [[{ total: totalVal }]] = await mysqlPool.query(
      'SELECT COUNT(DISTINCT caya) AS total FROM t_words_with_caya WHERE root_id = ?',
      [rootGroupId]
    );
    const total = Number(totalVal);

    const [rows] = await mysqlPool.query(
      `SELECT DISTINCT
         tw.caya AS contiayano, tw.sura AS suraid, tw.aya AS ayaid, tw.word,
         qa.AyaHText, qa.AudioText, st.ASuraName
       FROM t_words_with_caya tw
       JOIN quranayas qa ON qa.contiayano = tw.caya
       JOIN suratable st ON st.SuraId     = tw.sura
       WHERE tw.root_id = ?
       ORDER BY tw.caya
       LIMIT ? OFFSET ?`,
      [rootGroupId, limit, offset]
    );

    res.json({
      rootGroupId,
      root: rootRows[0]?.root || '',
      wordForms: formRows.map(r => r.wordForm),
      wordFormsCount: formRows.length,
      total,
      page,
      limit,
      hasMore: offset + rows.length < total,
      results: rows.map(r => ({
        surah: r.suraid,
        ayah:  r.ayaid,
        contiayano: r.contiayano,
        word: r.word || '',
        arabicText: r.AyaHText || '',
        translationText: r.AudioText || '',
        suraName: r.ASuraName ? r.ASuraName.trim() : ''
      }))
    });
  } catch (err) {
    console.error('❌ getRootWordBundle:', err.message);
    res.status(500).json({ error: 'Database error', message: 'Something went wrong' });
  }
};

// ─────────────────────────────────────────────
// 7. Glossary entries
//    GET /api/search/glossary
//    Returns all rows from the glossary table with field names
//    matching the frontend: engtitleglossary, arrtitleglossary, glossarytext
// ─────────────────────────────────────────────
exports.getGlossaryEntries = async (req, res) => {
  try {
    const [rows] = await mysqlPool.query(
      'SELECT id, engtitleglossary, arrtitleglossary, glossarytext FROM glossary ORDER BY id'
    );
    res.json(rows);
  } catch (err) {
    console.error('❌ getGlossaryEntries:', err.message);
    res.status(500).json({ error: 'Database error', message: 'Something went wrong' });
  }
};
