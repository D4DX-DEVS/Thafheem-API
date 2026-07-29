const mysqlPool = require('../config/database');
const { getTableConfig } = require('../utils/tableConfig');
const { extractAyahFromRange } = require('../utils/helpers');
const { parseEnglishTranslationFootnotes } = require('../utils/footnoteParser');
const { fetchEnglishInterpretations, attachEnglishInterpretationsToVerses } = require('./interpretationService');

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

// Get translation for a specific ayah
const getTranslation = async (language, surah, ayah) => {
  const lang = language.toLowerCase();
  const tableConfig = getTableConfig(lang, 'translation');

  if (!tableConfig) {
    throw new Error(`Language '${language}' is not supported`);
  }

  const { table, chapter, verse, verseFrom, verseTo, text, isRange } = tableConfig;
  const surahNum = parseInt(surah);
  const ayahNum = parseInt(ayah);

  let result;
  let englishInterpretations = [];

  if (lang === 'english' || lang === 'e') {
    englishInterpretations = await fetchEnglishInterpretations(surahNum);
  }

  if (isRange) {
    // Range-based query (English, Malayalam)
    const query = `SELECT ${text}, ${verseFrom}, ${verseTo} FROM ${table} WHERE ${chapter} = ? AND ${verseFrom} <= ? AND ${verseTo} >= ? LIMIT 1`;
    const [rows] = await mysqlPool.query(query, [surahNum, ayahNum, ayahNum]);
    if (rows.length === 0) {
      throw new Error(`No translation found for Surah ${surah}, Ayah ${ayah}`);
    }
    const row = rows[0];
    const extracted = extractAyahFromRange(row[text], ayahNum, row[verseFrom], row[verseTo]);
    result = {
      language: lang,
      surah: surahNum,
      ayah: ayahNum,
      translation_text: extracted || row[text],
    };
  } else {
    // Direct query (Bangla, Hindi, Tamil, Urdu)
    const query = `SELECT ${text} FROM ${table} WHERE ${chapter} = ? AND ${verse} = ? LIMIT 1`;
    const [rows] = await mysqlPool.query(query, [surahNum, ayahNum]);
    if (rows.length === 0) {
      throw new Error(`No translation found for Surah ${surah}, Ayah ${ayah}`);
    }
    result = {
      language: lang,
      surah: surahNum,
      ayah: ayahNum,
      translation_text: rows[0][text] || '',
    };
  }

  // For English translations, parse HTML and extract footnote metadata
  if ((lang === 'english' || lang === 'e') && result.translation_text) {
    const parsed = parseEnglishTranslationFootnotes(result.translation_text, surahNum, ayahNum);
    result.translation_text = parsed.processedHtml || parsed.rawHtml;
    result.raw_translation_text = parsed.rawHtml;
    result.footnote_metadata = {
      structured: parsed.footnotes,
      loose: parsed.looseNumbers,
      total: parsed.footnotes.length + parsed.looseNumbers.length
    };
  }

  if (result && englishInterpretations.length > 0) {
    const verseInterpretations = englishInterpretations
      .filter((interp) => ayahNum >= interp.fromAyah && ayahNum <= interp.toAyah)
      .map((interp) => ({
        id: interp.id,
        number: interp.interpretationNo,
      }));

    result.interpretations = verseInterpretations;
    result.interpretationCount = verseInterpretations.length;
  }

  return result;
};

module.exports = {
  getTranslation,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE
};


