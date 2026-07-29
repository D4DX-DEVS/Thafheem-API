const mysqlPool = require('../config/database');
const { normalizeAyahNumber } = require('../utils/helpers');

// Fetch English interpretations for a surah
const fetchEnglishInterpretations = async (surahNum) => {
  const query = `SELECT ID, SuraId, ayafrom, ayato, InterpretationNo FROM enginterpretation WHERE SuraId = ? ORDER BY CAST(ayafrom AS DECIMAL(10,2)) ASC, CAST(InterpretationNo AS UNSIGNED) ASC`;
  const [rows] = await mysqlPool.query(query, [surahNum]);

  return rows.map((row) => ({
    id: row.ID,
    surahId: row.SuraId,
    fromAyah: normalizeAyahNumber(row.ayafrom, 1),
    toAyah: normalizeAyahNumber(row.ayato, normalizeAyahNumber(row.ayafrom, 1)),
    interpretationNo: String(row.InterpretationNo).trim(),
  }));
};

// Attach English interpretations to verses
const attachEnglishInterpretationsToVerses = (translations = [], interpretations = []) => {
  if (!Array.isArray(translations) || translations.length === 0 || interpretations.length === 0) {
    return translations;
  }

  return translations.map((item) => {
    const verseNumber = normalizeAyahNumber(
      item.number ??
      item.verse_number ??
      item.VerseNo ??
      item.Verse_Number ??
      item.AyaId ??
      item.AyahId, null
    );

    if (!verseNumber) {
      return item;
    }

    const verseInterpretations = interpretations
      .filter((interp) => verseNumber >= interp.fromAyah && verseNumber <= interp.toAyah)
      .map((interp) => ({
        id: interp.id,
        number: interp.interpretationNo,
      }));

    return {
      ...item,
      interpretations: verseInterpretations,
      interpretationCount: verseInterpretations.length,
    };
  });
};

module.exports = {
  fetchEnglishInterpretations,
  attachEnglishInterpretationsToVerses
};



