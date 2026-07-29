const mysqlPool = require('../config/database');
const { getTableConfig } = require('../utils/tableConfig');
const { extractAyahFromRange, parsePositiveInt, isPaginationRequested } = require('../utils/helpers');
const { parseEnglishTranslationFootnotes } = require('../utils/footnoteParser');
const { fetchEnglishInterpretations, attachEnglishInterpretationsToVerses } = require('../services/interpretationService');
const { getSurahVerseCount, buildPaginationMeta } = require('../utils/pagination');
const translationService = require('../services/translationService');
const chapterService = require('../services/chapterService');
const { marked } = require('marked');

/**
 * Normalize markdown text from database before parsing
 * - Converts Windows newlines (\r\n) to Unix newlines (\n)
 * - Converts any remaining CR (\r) to LF (\n)
 * - Collapses 3+ consecutive newlines to exactly 2 newlines for proper paragraph spacing
 * 
 * @param {string} input - Raw text from database
 * @returns {string} - Normalized markdown text
 */
const normalizeMarkdown = (input) => {
  if (!input || typeof input !== 'string') {
    return input || '';
  }
  
  // Convert Windows newlines → Unix newlines
  let s = input.replaceAll('\r\n', '\n');
  
  // Also convert any remaining CR → LF
  s = s.replaceAll('\r', '\n');
  
  // Ensure paragraph breaks: collapse 3+ newlines → exactly 2
  s = s.replace(/\n{3,}/g, '\n\n');
  
  return s;
};

const APPENDIX_CONFIG = {
  english: { table: 'engappendix', langKey: 'english' },
  e: { table: 'engappendix', langKey: 'english' },
  malayalam: { table: 'mal_appendix', langKey: 'malayalam' },
  mal: { table: 'mal_appendix', langKey: 'malayalam' },
  urdu: { table: 'urdu_appendix', langKey: 'urdu' },
  u: { table: 'urdu_appendix', langKey: 'urdu' },
  hindi: { table: 'hindi_appendix', langKey: 'hindi' },
  hi: { table: 'hindi_appendix', langKey: 'hindi' },
  bangla: { table: 'bangla_appendix', langKey: 'bangla' },
  bn: { table: 'bangla_appendix', langKey: 'bangla' },
  tamil: { table: 'tamil_appendix', langKey: 'tamil' },
  ta: { table: 'tamil_appendix', langKey: 'tamil' }
};

const APPENDIX_TITLE_FIELDS = [
  'subtitle',
  'Subtitle',
  'PrefaceSubTitle',
  'title',
  'Title',
  'section_title',
  'SectionTitle',
  'heading',
  'Heading',
  'label',
  'Label',
  'name',
  'Name'
];

const APPENDIX_TEXT_FIELDS = [
  'text',
  'Text',
  'PrefaceText',
  'content',
  'Content',
  'appendixText',
  'AppendixText',
  'matter',
  'Matter',
  'description',
  'Description',
  'body',
  'Body',
  'notes',
  'Notes',
  'details',
  'Details'
];

const extractFieldValue = (row = {}, candidates = []) => {
  for (const key of candidates) {
    const variations = [key, key.toLowerCase(), key.toUpperCase()];
    for (const variant of variations) {
      if (Object.prototype.hasOwnProperty.call(row, variant)) {
        const value = row[variant];
        if (value === null || value === undefined) {
          continue;
        }
        if (typeof value === 'string') {
          const trimmed = value.trim();
          if (trimmed.length > 0) {
            return trimmed;
          }
        } else if (typeof value === 'number' || typeof value === 'boolean') {
          return value.toString();
        }
      }
    }
  }
  return '';
};

const TAJWEED_TABLE =
  process.env.TAJWEED_TABLE?.trim() || 'thajweed';

// Supported languages
const SUPPORTED_LANGUAGES = ['bangla', 'hindi', 'tamil', 'urdu', 'english', 'e', 'malayalam', 'mal', 'arabic'];
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;
const MALAYALAM_LANGUAGE_CODES = new Set(['malayalam', 'mal']);

// In-memory cache for quranaya queries (Quran data is static, safe to cache long)
const quranayaCache = new Map();
const QURANAYA_CACHE_TTL = 30 * 60 * 1000; // 30 minutes
const getQuranayaCached = (key) => {
  const entry = quranayaCache.get(key);
  if (entry && Date.now() - entry.ts < QURANAYA_CACHE_TTL) return entry.data;
  if (entry) quranayaCache.delete(key);
  return null;
};
const setQuranayaCache = (key, data) => {
  quranayaCache.set(key, { data, ts: Date.now() });
};

// Get translation for a specific ayah
exports.getTranslation = async (req, res) => {
  try {
    const { language, surah, ayah } = req.params;
    const result = await translationService.getTranslation(language, surah, ayah);
    res.json(result);
  } catch (error) {
    console.error(`❌ Error fetching translation:`, error.message);
    
    if (error.message.includes('not found')) {
      return res.status(404).json({ 
        error: 'Translation not found', 
        message: error.message 
      });
    }
    
    if (error.message.includes('not supported')) {
      return res.status(400).json({ 
        error: 'Invalid language', 
        message: error.message 
      });
    }
    
    res.status(500).json({ error: 'Database error', message: error.message });
  }
};

// Get Hindi surah intro from hindi_surah_intro table
exports.getHindiSurahIntro = async (req, res) => {
  try {
    const surahNum = parseInt(req.params.surah, 10);

    if (!Number.isFinite(surahNum) || surahNum < 1 || surahNum > 114) {
      return res.status(400).json({
        error: 'Invalid surah',
        message: 'Surah must be between 1 and 114'
      });
    }

    const query = `
      SELECT surahid, intro
      FROM hindi_surah_intro
      WHERE surahid = ?
      LIMIT 1
    `;

    const [rows] = await mysqlPool.query(query, [surahNum]);

    if (!rows || rows.length === 0) {
      return res.status(404).json({
        error: 'Not found',
        message: `No Hindi intro found for Surah ${surahNum}`
      });
    }

    const row = rows[0] || {};
    return res.json({
      surah: row.surahid,
      intro: row.intro || null
    });
  } catch (error) {
    console.error('❌ Error fetching Hindi surah intro:', error.message);
    res.status(500).json({
      error: 'Database error',
      message: error.message
    });
  }
};

// Get Urdu surah intro from urdu_intro table
exports.getUrduSurahIntro = async (req, res) => {
  try {
    const surahNum = parseInt(req.params.surah, 10);

    if (!Number.isFinite(surahNum) || surahNum < 1 || surahNum > 114) {
      return res.status(400).json({
        error: 'Invalid surah',
        message: 'Surah must be between 1 and 114'
      });
    }

    const query = `
      SELECT surah_id, preface_subtitle, preface_text
      FROM urdu_intro
      WHERE surah_id = ?
      ORDER BY id ASC
    `;

    const [rows] = await mysqlPool.query(query, [surahNum]);

    if (!rows || rows.length === 0) {
      return res.status(404).json({
        error: 'Not found',
        message: `No Urdu intro found for Surah ${surahNum}`
      });
    }

    const sections = rows.map(row => ({
      subtitle: row.preface_subtitle || null,
      text: row.preface_text || ''
    }));

    return res.json({
      surah: surahNum,
      sections
    });
  } catch (error) {
    console.error('❌ Error fetching Urdu surah intro:', error.message);
    res.status(500).json({
      error: 'Database error',
      message: error.message
    });
  }
};

// Get Urdu surah intro audio from urdu_intro_audio table
exports.getUrduSurahIntroAudio = async (req, res) => {
  try {
    const surahNum = parseInt(req.params.surah, 10);

    if (!Number.isFinite(surahNum) || surahNum < 1 || surahNum > 114) {
      return res.status(400).json({
        error: 'Invalid surah',
        message: 'Surah must be between 1 and 114'
      });
    }

    const query = `
      SELECT intro_audio_path
      FROM urdu_intro_audio
      WHERE surah_id = ?
      LIMIT 1
    `;

    const [rows] = await mysqlPool.query(query, [surahNum]);

    if (!rows || rows.length === 0) {
      return res.status(404).json({
        error: 'Not found',
        message: `No Urdu intro audio found for Surah ${surahNum}`
      });
    }

    const row = rows[0] || {};
    return res.json({
      surah: surahNum,
      audio_url: row.intro_audio_path || null
    });
  } catch (error) {
    console.error('❌ Error fetching Urdu surah intro audio:', error.message);
    res.status(500).json({
      error: 'Database error',
      message: error.message
    });
  }
};

// Get Bangla surah intro from bangla_intro table
exports.getBanglaSurahIntro = async (req, res) => {
  try {
    const surahNum = parseInt(req.params.surah, 10);

    if (!Number.isFinite(surahNum) || surahNum < 1 || surahNum > 114) {
      return res.status(400).json({
        error: 'Invalid surah',
        message: 'Surah must be between 1 and 114'
      });
    }

    const query = `
      SELECT surah_id, preface_subtitle, preface_text
      FROM bangla_intro
      WHERE surah_id = ?
      ORDER BY id ASC
    `;

    const [rows] = await mysqlPool.query(query, [surahNum]);

    if (!rows || rows.length === 0) {
      return res.status(404).json({
        error: 'Not found',
        message: `No Bangla intro found for Surah ${surahNum}`
      });
    }

    const sections = rows.map(row => ({
      subtitle: row.preface_subtitle || null,
      text: row.preface_text || ''
    }));

    return res.json({
      surah: surahNum,
      sections
    });
  } catch (error) {
    console.error('❌ Error fetching Bangla surah intro:', error.message);
    res.status(500).json({
      error: 'Database error',
      message: error.message
    });
  }
};

// Get Tamil surah intro from tamil_intro table
exports.getTamilSurahIntro = async (req, res) => {
  try {
    const surahNum = parseInt(req.params.surah, 10);

    if (!Number.isFinite(surahNum) || surahNum < 1 || surahNum > 114) {
      return res.status(400).json({
        error: 'Invalid surah',
        message: 'Surah must be between 1 and 114'
      });
    }

    const query = `
      SELECT surah_id, preface_subtitle, preface_text
      FROM tamil_intro
      WHERE surah_id = ?
      ORDER BY id ASC
    `;

    const [rows] = await mysqlPool.query(query, [surahNum]);

    if (!rows || rows.length === 0) {
      return res.status(404).json({
        error: 'Not found',
        message: `No Tamil intro found for Surah ${surahNum}`
      });
    }

    const sections = rows.map(row => ({
      subtitle: row.preface_subtitle || null,
      text: row.preface_text || ''
    }));

    return res.json({
      surah: surahNum,
      sections
    });
  } catch (error) {
    console.error('❌ Error fetching Tamil surah intro:', error.message);
    res.status(500).json({
      error: 'Database error',
      message: error.message
    });
  }
};

// Get appendix (Malayalam or English)
exports.getAppendix = async (req, res) => {
  try {
    const { language } = req.params;
    const lang = String(language || '').toLowerCase();
    const config = APPENDIX_CONFIG[lang];

    if (!config) {
      return res.status(404).json({
        error: 'Appendix not available',
        message: `No appendix data configured for language: ${language}`
      });
    }

    const query = `SELECT * FROM ${config.table} ORDER BY 1 ASC`;
    const [rows] = await mysqlPool.query(query);

    if (!rows || rows.length === 0) {
      return res.json({
        language: config.langKey,
        count: 0,
        sections: []
      });
    }

    const sections = rows.map((row = {}, index) => {
      const sectionTitle = extractFieldValue(row, APPENDIX_TITLE_FIELDS);
      const sectionText = extractFieldValue(row, APPENDIX_TEXT_FIELDS);
      const sectionId =
        row.ID ||
        row.id ||
        row.AID ||
        row.aid ||
        row.AppendixID ||
        row.appendixId ||
        row.appendix_id ||
        index + 1;

      // Render markdown for Malayalam, Urdu, Hindi, Bangla, and Tamil appendix (both title and text)
      const isMalayalam = lang === 'malayalam' || lang === 'mal';
      const isUrdu = lang === 'urdu' || lang === 'u';
      const isHindi = lang === 'hindi' || lang === 'hi';
      const isBangla = lang === 'bangla' || lang === 'bn';
      const isTamil = lang === 'tamil' || lang === 'ta';
      const shouldRenderMarkdown = isMalayalam || isUrdu || isHindi || isBangla || isTamil;
      
      let renderedTitle = sectionTitle || null;
      let renderedText = sectionText || '';
      
      if (shouldRenderMarkdown) {
        // Render markdown for title (inline, no paragraph wrapper)
        if (sectionTitle) {
          try {
            // Normalize markdown before parsing
            const normalizedTitle = normalizeMarkdown(sectionTitle);
            // Use inline renderer to avoid <p> wrapper for titles
            const html = marked.parse(normalizedTitle);
            // Remove <p> wrapper if present (titles shouldn't be in paragraphs)
            renderedTitle = html.replace(/^<p>|<\/p>$/g, '').trim();
          } catch (error) {
            console.error('Markdown rendering error for title:', error.message);
            renderedTitle = sectionTitle;
          }
        }
        
        // Render markdown for text
        if (sectionText) {
          try {
            // Normalize markdown before parsing
            const normalizedText = normalizeMarkdown(sectionText);
            renderedText = marked.parse(normalizedText);
          } catch (error) {
            console.error('Markdown rendering error for text:', error.message);
            renderedText = sectionText;
          }
        }
      }

      return {
        id: sectionId,
        title: renderedTitle,
        text: renderedText,
        raw_title: sectionTitle || null, // Keep original markdown title
        raw_text: sectionText || '', // Keep original markdown text
        raw: row
      };
    });

    res.json({
      language: config.langKey,
      count: sections.length,
      sections
    });
  } catch (error) {
    console.error('❌ Error fetching appendix:', error.message);
    res.status(500).json({ error: 'Database error', message: error.message });
  }
};

// Get Hindi Finality of Prophethood (hindi_parisamapthi)
exports.getHindiFinalityOfProphethood = async (req, res) => {
  try {
    const query = `SELECT * FROM hindi_parisamapthi ORDER BY 1 ASC`;
    const [rows] = await mysqlPool.query(query);

    if (!rows || rows.length === 0) {
      return res.json({
        language: 'hindi',
        count: 0,
        sections: []
      });
    }

    const sections = rows.map((row = {}, index) => {
      const sectionTitle = extractFieldValue(row, APPENDIX_TITLE_FIELDS);
      const sectionText = extractFieldValue(row, APPENDIX_TEXT_FIELDS);
      const sectionId =
        row.ID ||
        row.id ||
        row.AID ||
        row.aid ||
        row.AppendixID ||
        row.appendixId ||
        row.appendix_id ||
        index + 1;

      // Render markdown for Hindi (both title and text)
      let renderedTitle = sectionTitle || null;
      let renderedText = sectionText || '';
      
      // Render markdown for title (inline, no paragraph wrapper)
      // Handle markdown headers - support both # at start and # at end
      if (sectionTitle) {
        try {
          // Normalize markdown before processing
          const normalizedTitle = normalizeMarkdown(sectionTitle);
          let titleToRender = normalizedTitle.trim();
          // If title ends with #, convert to standard markdown header format
          if (titleToRender.endsWith('#') && !titleToRender.startsWith('#')) {
            titleToRender = '#' + titleToRender.slice(0, -1).trim();
          }
          // Markdown requires space after # for headers - add space if missing
          if (titleToRender.startsWith('#') && titleToRender.length > 1 && titleToRender[1] !== ' ') {
            titleToRender = '# ' + titleToRender.substring(1);
          }
          // Ensure proper markdown parsing
          const html = marked.parse(titleToRender);
          // Remove <p> wrapper if present, but keep headers (h1, h2, etc.)
          renderedTitle = html.replace(/^<p>|<\/p>$/g, '').trim();
        } catch (error) {
          console.error('Markdown rendering error for title:', error.message);
          renderedTitle = sectionTitle;
        }
      }
      
      // Render markdown for text
      if (sectionText) {
        try {
          // Normalize markdown before preprocessing
          const normalizedText = normalizeMarkdown(sectionText);
          // Preprocess: Convert {dir="rtl"} markers to HTML spans for Arabic text
          // Pattern: [Arabic text]{dir="rtl"} -> <span dir="rtl">Arabic text</span>
          let processedText = normalizedText.replace(
            /\[([^\]]+)\]\{dir="rtl"\}/g,
            '<span dir="rtl" style="direction: rtl; text-align: right; display: inline-block; font-family: \'Amiri Quran\', serif;">$1</span>'
          );
          
          renderedText = marked.parse(processedText);
        } catch (error) {
          console.error('Markdown rendering error for text:', error.message);
          renderedText = sectionText;
        }
      }

      return {
        id: sectionId,
        title: renderedTitle,
        text: renderedText,
        raw_title: sectionTitle || null,
        raw_text: sectionText || '',
        raw: row
      };
    });

    res.json({
      language: 'hindi',
      count: sections.length,
      sections
    });
  } catch (error) {
    console.error('❌ Error fetching Hindi Finality of Prophethood:', error.message);
    res.status(500).json({ error: 'Database error', message: error.message });
  }
};

// Get Urdu Finality of Prophethood (urdu_parisamapthi)
exports.getUrduFinalityOfProphethood = async (req, res) => {
  try {
    const query = `SELECT * FROM urdu_parisamapthi ORDER BY 1 ASC`;
    const [rows] = await mysqlPool.query(query);

    if (!rows || rows.length === 0) {
      return res.json({
        language: 'urdu',
        count: 0,
        sections: []
      });
    }

    // Helper function to process footnotes: Convert [\[1\]](footnote) patterns to clickable HTML links
    const processFootnotes = (text) => {
      if (!text || typeof text !== 'string') return text;
      
      // Pattern 1: [\[1\]](footnote) or [\[2\]](footnote)[] or [\[3\]](footnote)[]
      // This matches: [\[ followed by digits, followed by \]](footnote) optionally followed by []
      // Pattern 2: [[1]](footnote) or [[2]](footnote)[] (without escaped backslashes)
      const originalText = text;
      
      // First try escaped brackets pattern: [\[1\]](footnote)
      text = text.replace(
        /\[\\\[(\d+)\\\]\]\(footnote\)(\[\])?/g,
        (match, id) => {
          console.log(`[Urdu Finality] Processing footnote pattern (escaped): "${match}" -> ID: ${id}`);
          return `<sup class="footnote-link" data-footnote-id="${id}" style="color: #06b6d4; cursor: pointer; text-decoration: underline;">${id}</sup>`;
        }
      );
      
      // Then try unescaped brackets pattern: [[1]](footnote)
      text = text.replace(
        /\[\[(\d+)\]\]\(footnote\)(\[\])?/g,
        (match, id) => {
          console.log(`[Urdu Finality] Processing footnote pattern (unescaped): "${match}" -> ID: ${id}`);
          return `<sup class="footnote-link" data-footnote-id="${id}" style="color: #06b6d4; cursor: pointer; text-decoration: underline;">${id}</sup>`;
        }
      );
      
      // Debug: Log if any footnotes were found
      if (originalText !== text) {
        console.log('[Urdu Finality] Footnotes processed in text');
      }
      
      return text;
    };

    const sections = rows.map((row = {}, index) => {
      const sectionTitle = extractFieldValue(row, APPENDIX_TITLE_FIELDS);
      const sectionText = extractFieldValue(row, APPENDIX_TEXT_FIELDS);
      const sectionId =
        row.ID ||
        row.id ||
        row.AID ||
        row.aid ||
        row.AppendixID ||
        row.appendixId ||
        row.appendix_id ||
        index + 1;

      // Process footnotes BEFORE markdown rendering
      // This prevents markdown from converting (footnote) into links
      let processedTitle = sectionTitle || null;
      let processedText = sectionText || '';
      
      if (processedTitle) {
        processedTitle = processFootnotes(processedTitle);
      }
      if (processedText) {
        processedText = processFootnotes(processedText);
      }

      // Render markdown for Urdu (both title and text)
      let renderedTitle = processedTitle;
      let renderedText = processedText;
      
      // Render markdown for title (inline, no paragraph wrapper)
      // Handle markdown headers - support both # at start and # at end
      if (renderedTitle) {
        try {
          // Normalize markdown before processing
          const normalizedTitle = normalizeMarkdown(renderedTitle);
          let titleToRender = normalizedTitle.trim();
          // If title ends with #, convert to standard markdown header format
          if (titleToRender.endsWith('#') && !titleToRender.startsWith('#')) {
            titleToRender = '#' + titleToRender.slice(0, -1).trim();
          }
          // Markdown requires space after # for headers - add space if missing
          if (titleToRender.startsWith('#') && titleToRender.length > 1 && titleToRender[1] !== ' ') {
            titleToRender = '# ' + titleToRender.substring(1);
          }
          // Ensure proper markdown parsing
          const html = marked.parse(titleToRender);
          // Remove <p> wrapper if present, but keep headers (h1, h2, etc.)
          renderedTitle = html.replace(/^<p>|<\/p>$/g, '').trim();
          
          // Remove any links that markdown might have created from (footnote) patterns
          renderedTitle = renderedTitle.replace(
            /<a[^>]*href=["']footnote["'][^>]*>.*?<\/a>/gi,
            (match) => {
              const numberMatch = match.match(/(\d+)/);
              if (numberMatch) {
                return `<sup class="footnote-link" data-footnote-id="${numberMatch[1]}" style="color: #06b6d4; cursor: pointer; text-decoration: underline;">${numberMatch[1]}</sup>`;
              }
              return match;
            }
          );
        } catch (error) {
          console.error('Markdown rendering error for title:', error.message);
          renderedTitle = processedTitle;
        }
      }
      
      // Render markdown for text
      if (renderedText) {
        try {
          // Normalize markdown before parsing
          const normalizedText = normalizeMarkdown(renderedText);
          renderedText = marked.parse(normalizedText);
          
          // Remove any links that markdown might have created from (footnote) patterns
          // This handles cases where markdown parsed the pattern before our processing
          renderedText = renderedText.replace(
            /<a[^>]*href=["']footnote["'][^>]*>.*?<\/a>/gi,
            (match) => {
              // Extract number from link text if possible, otherwise return empty
              const numberMatch = match.match(/(\d+)/);
              if (numberMatch) {
                return `<sup class="footnote-link" data-footnote-id="${numberMatch[1]}" style="color: #06b6d4; cursor: pointer; text-decoration: underline;">${numberMatch[1]}</sup>`;
              }
              return match;
            }
          );
        } catch (error) {
          console.error('Markdown rendering error for text:', error.message);
          renderedText = processedText;
        }
      }

      return {
        id: sectionId,
        title: renderedTitle,
        text: renderedText,
        raw_title: sectionTitle || null,
        raw_text: sectionText || '',
        raw: row
      };
    });

    res.json({
      language: 'urdu',
      count: sections.length,
      sections
    });
  } catch (error) {
    console.error('❌ Error fetching Urdu Finality of Prophethood:', error.message);
    res.status(500).json({ error: 'Database error', message: error.message });
  }
};

// Get Urdu Jesus and Mohammed (urdu_jesus_muhammed)
exports.getUrduJesusMohammed = async (req, res) => {
  try {
    const query = `SELECT * FROM urdu_jesus_muhammed ORDER BY 1 ASC`;
    const [rows] = await mysqlPool.query(query);

    if (!rows || rows.length === 0) {
      return res.json({
        language: 'urdu',
        count: 0,
        sections: []
      });
    }

    const sections = rows.map((row = {}, index) => {
      const sectionTitle = extractFieldValue(row, APPENDIX_TITLE_FIELDS);
      const sectionText = extractFieldValue(row, APPENDIX_TEXT_FIELDS);
      const sectionId =
        row.ID ||
        row.id ||
        row.AID ||
        row.aid ||
        row.AppendixID ||
        row.appendixId ||
        row.appendix_id ||
        index + 1;

      // Render markdown for Urdu (both title and text)
      let renderedTitle = sectionTitle || null;
      let renderedText = sectionText || '';
      
      // Render markdown for title (inline, no paragraph wrapper)
      // Handle markdown headers - support both # at start and # at end
      if (sectionTitle) {
        try {
          // Normalize markdown before processing
          const normalizedTitle = normalizeMarkdown(sectionTitle);
          let titleToRender = normalizedTitle.trim();
          // If title ends with #, convert to standard markdown header format
          if (titleToRender.endsWith('#') && !titleToRender.startsWith('#')) {
            titleToRender = '#' + titleToRender.slice(0, -1).trim();
          }
          // Markdown requires space after # for headers - add space if missing
          if (titleToRender.startsWith('#') && titleToRender.length > 1 && titleToRender[1] !== ' ') {
            titleToRender = '# ' + titleToRender.substring(1);
          }
          // Ensure proper markdown parsing
          const html = marked.parse(titleToRender);
          // Remove <p> wrapper if present, but keep headers (h1, h2, etc.)
          renderedTitle = html.replace(/^<p>|<\/p>$/g, '').trim();
        } catch (error) {
          console.error('Markdown rendering error for title:', error.message);
          renderedTitle = sectionTitle;
        }
      }
      
      // Render markdown for text
      if (sectionText) {
        try {
          // Normalize markdown before parsing
          const normalizedText = normalizeMarkdown(sectionText);
          renderedText = marked.parse(normalizedText);
        } catch (error) {
          console.error('Markdown rendering error for text:', error.message);
          renderedText = sectionText;
        }
      }

      return {
        id: sectionId,
        title: renderedTitle,
        text: renderedText,
        raw_title: sectionTitle || null,
        raw_text: sectionText || '',
        raw: row
      };
    });

    res.json({
      language: 'urdu',
      count: sections.length,
      sections
    });
  } catch (error) {
    console.error('❌ Error fetching Urdu Jesus and Mohammed:', error.message);
    res.status(500).json({ error: 'Database error', message: error.message });
  }
};

// Get Malayalam Jesus and Mohammed (maljesusandmuhammed_library)
exports.getMalayalamJesusMohammed = async (req, res) => {
  try {
    const query = `SELECT * FROM maljesusandmuhammed_library ORDER BY 1 ASC`;
    const [rows] = await mysqlPool.query(query);

    if (!rows || rows.length === 0) {
      return res.json({
        language: 'malayalam',
        count: 0,
        sections: []
      });
    }

    const sections = rows.map((row = {}, index) => {
      const sectionTitle = extractFieldValue(row, APPENDIX_TITLE_FIELDS);
      const sectionText = extractFieldValue(row, APPENDIX_TEXT_FIELDS);
      const sectionId =
        row.ID ||
        row.id ||
        row.AID ||
        row.aid ||
        row.AppendixID ||
        row.appendixId ||
        row.appendix_id ||
        index + 1;

      // Render markdown for Malayalam (both title and text)
      let renderedTitle = sectionTitle || null;
      let renderedText = sectionText || '';
      
      // Render markdown for title (inline, no paragraph wrapper)
      // Handle markdown headers - support both # at start and # at end
      if (sectionTitle) {
        try {
          // Normalize markdown before processing
          const normalizedTitle = normalizeMarkdown(sectionTitle);
          let titleToRender = normalizedTitle.trim();
          // If title ends with #, convert to standard markdown header format
          if (titleToRender.endsWith('#') && !titleToRender.startsWith('#')) {
            titleToRender = '#' + titleToRender.slice(0, -1).trim();
          }
          // Markdown requires space after # for headers - add space if missing
          if (titleToRender.startsWith('#') && titleToRender.length > 1 && titleToRender[1] !== ' ') {
            titleToRender = '# ' + titleToRender.substring(1);
          }
          // Ensure proper markdown parsing
          const html = marked.parse(titleToRender);
          // Remove <p> wrapper if present, but keep headers (h1, h2, etc.)
          renderedTitle = html.replace(/^<p>|<\/p>$/g, '').trim();
        } catch (error) {
          console.error('Markdown rendering error for title:', error.message);
          renderedTitle = sectionTitle;
        }
      }
      
      // Render markdown for text
      if (sectionText) {
        try {
          // Normalize markdown before parsing
          const normalizedText = normalizeMarkdown(sectionText);
          renderedText = marked.parse(normalizedText);
        } catch (error) {
          console.error('Markdown rendering error for text:', error.message);
          renderedText = sectionText;
        }
      }

      return {
        id: sectionId,
        title: renderedTitle,
        text: renderedText,
        raw_title: sectionTitle || null,
        raw_text: sectionText || '',
        raw: row
      };
    });

    res.json({
      language: 'malayalam',
      count: sections.length,
      sections
    });
  } catch (error) {
    console.error('❌ Error fetching Malayalam Jesus and Mohammed:', error.message);
    res.status(500).json({ error: 'Database error', message: error.message });
  }
};

// Get Hindi Jesus and Mohammed (hindi_jesus_muhammed)
exports.getHindiJesusMohammed = async (req, res) => {
  try {
    const query = `SELECT * FROM hindi_jesus_muhammed ORDER BY 1 ASC`;
    const [rows] = await mysqlPool.query(query);

    if (!rows || rows.length === 0) {
      return res.json({
        language: 'hindi',
        count: 0,
        sections: []
      });
    }

    const sections = rows.map((row = {}, index) => {
      const sectionTitle = extractFieldValue(row, APPENDIX_TITLE_FIELDS);
      const sectionText = extractFieldValue(row, APPENDIX_TEXT_FIELDS);
      const sectionId =
        row.ID ||
        row.id ||
        row.AID ||
        row.aid ||
        row.AppendixID ||
        row.appendixId ||
        row.appendix_id ||
        index + 1;

      // Render markdown for Hindi (both title and text)
      let renderedTitle = sectionTitle || null;
      let renderedText = sectionText || '';
      
      // Render markdown for title (inline, no paragraph wrapper)
      // Handle markdown headers - support both # at start and # at end
      if (sectionTitle) {
        try {
          // Normalize markdown before processing
          const normalizedTitle = normalizeMarkdown(sectionTitle);
          let titleToRender = normalizedTitle.trim();
          // If title ends with #, convert to standard markdown header format
          if (titleToRender.endsWith('#') && !titleToRender.startsWith('#')) {
            titleToRender = '#' + titleToRender.slice(0, -1).trim();
          }
          // Markdown requires space after # for headers - add space if missing
          if (titleToRender.startsWith('#') && titleToRender.length > 1 && titleToRender[1] !== ' ') {
            titleToRender = '# ' + titleToRender.substring(1);
          }
          // Ensure proper markdown parsing
          const html = marked.parse(titleToRender);
          // Remove <p> wrapper if present, but keep headers (h1, h2, etc.)
          renderedTitle = html.replace(/^<p>|<\/p>$/g, '').trim();
        } catch (error) {
          console.error('Markdown rendering error for title:', error.message);
          renderedTitle = sectionTitle;
        }
      }
      
      // Render markdown for text
      if (sectionText) {
        try {
          // Normalize markdown before parsing
          const normalizedText = normalizeMarkdown(sectionText);
          renderedText = marked.parse(normalizedText);
        } catch (error) {
          console.error('Markdown rendering error for text:', error.message);
          renderedText = sectionText;
        }
      }

      return {
        id: sectionId,
        title: renderedTitle,
        text: renderedText,
        raw_title: sectionTitle || null,
        raw_text: sectionText || '',
        raw: row
      };
    });

    res.json({
      language: 'hindi',
      count: sections.length,
      sections
    });
  } catch (error) {
    console.error('❌ Error fetching Hindi Jesus and Mohammed:', error.message);
    res.status(500).json({ error: 'Database error', message: error.message });
  }
};

// Get English Jesus and Mohammed (engjesusandmuhammed_library)
exports.getEnglishJesusMohammed = async (req, res) => {
  try {
    const query = `SELECT * FROM engjesusandmuhammed_library ORDER BY 1 ASC`;
    const [rows] = await mysqlPool.query(query);

    if (!rows || rows.length === 0) {
      return res.json({
        language: 'english',
        count: 0,
        sections: []
      });
    }

    const sections = rows.map((row = {}, index) => {
      const sectionTitle = extractFieldValue(row, APPENDIX_TITLE_FIELDS);
      const sectionText = extractFieldValue(row, APPENDIX_TEXT_FIELDS);
      const sectionId =
        row.ID ||
        row.id ||
        row.AID ||
        row.aid ||
        row.AppendixID ||
        row.appendixId ||
        row.appendix_id ||
        index + 1;

      // Render markdown for English (both title and text)
      let renderedTitle = sectionTitle || null;
      let renderedText = sectionText || '';
      
      // Render markdown for title (inline, no paragraph wrapper)
      // Handle markdown headers - support both # at start and # at end
      if (sectionTitle) {
        try {
          // Normalize markdown before processing
          const normalizedTitle = normalizeMarkdown(sectionTitle);
          let titleToRender = normalizedTitle.trim();
          // If title ends with #, convert to standard markdown header format
          if (titleToRender.endsWith('#') && !titleToRender.startsWith('#')) {
            titleToRender = '#' + titleToRender.slice(0, -1).trim();
          }
          // Markdown requires space after # for headers - add space if missing
          if (titleToRender.startsWith('#') && titleToRender.length > 1 && titleToRender[1] !== ' ') {
            titleToRender = '# ' + titleToRender.substring(1);
          }
          // Ensure proper markdown parsing
          const html = marked.parse(titleToRender);
          // Remove <p> wrapper if present, but keep headers (h1, h2, etc.)
          renderedTitle = html.replace(/^<p>|<\/p>$/g, '').trim();
        } catch (error) {
          console.error('Markdown rendering error for title:', error.message);
          renderedTitle = sectionTitle;
        }
      }
      
      // Render markdown for text
      if (sectionText) {
        try {
          // Normalize markdown before parsing
          const normalizedText = normalizeMarkdown(sectionText);
          renderedText = marked.parse(normalizedText);
        } catch (error) {
          console.error('Markdown rendering error for text:', error.message);
          renderedText = sectionText;
        }
      }

      return {
        id: sectionId,
        title: renderedTitle,
        text: renderedText,
        raw_title: sectionTitle || null,
        raw_text: sectionText || '',
        raw: row
      };
    });

    res.json({
      language: 'english',
      count: sections.length,
      sections
    });
  } catch (error) {
    console.error('❌ Error fetching English Jesus and Mohammed:', error.message);
    res.status(500).json({ error: 'Database error', message: error.message });
  }
};

// Get Bangla Jesus and Mohammed (bangla_jesus_muhammed)
exports.getBanglaJesusMohammed = async (req, res) => {
  try {
    const query = `SELECT * FROM bangla_jesus_muhammed ORDER BY 1 ASC`;
    const [rows] = await mysqlPool.query(query);

    if (!rows || rows.length === 0) {
      return res.json({
        language: 'bangla',
        count: 0,
        sections: []
      });
    }

    const sections = rows.map((row = {}, index) => {
      const sectionTitle = extractFieldValue(row, APPENDIX_TITLE_FIELDS);
      const sectionText = extractFieldValue(row, APPENDIX_TEXT_FIELDS);
      const sectionId =
        row.ID ||
        row.id ||
        row.AID ||
        row.aid ||
        row.AppendixID ||
        row.appendixId ||
        row.appendix_id ||
        index + 1;

      // Render markdown for Bangla (both title and text)
      let renderedTitle = sectionTitle || null;
      let renderedText = sectionText || '';
      
      // Render markdown for title (inline, no paragraph wrapper)
      // Handle markdown headers - support both # at start and # at end
      if (sectionTitle) {
        try {
          // Normalize markdown before processing
          const normalizedTitle = normalizeMarkdown(sectionTitle);
          let titleToRender = normalizedTitle.trim();
          // If title ends with #, convert to standard markdown header format
          if (titleToRender.endsWith('#') && !titleToRender.startsWith('#')) {
            titleToRender = '#' + titleToRender.slice(0, -1).trim();
          }
          // Markdown requires space after # for headers - add space if missing
          if (titleToRender.startsWith('#') && titleToRender.length > 1 && titleToRender[1] !== ' ') {
            titleToRender = '# ' + titleToRender.substring(1);
          }
          // Ensure proper markdown parsing
          const html = marked.parse(titleToRender);
          // Remove <p> wrapper if present, but keep headers (h1, h2, etc.)
          renderedTitle = html.replace(/^<p>|<\/p>$/g, '').trim();
        } catch (error) {
          console.error('Markdown rendering error for title:', error.message);
          renderedTitle = sectionTitle;
        }
      }
      
      // Render markdown for text
      if (sectionText) {
        try {
          // Normalize markdown before parsing
          const normalizedText = normalizeMarkdown(sectionText);
          renderedText = marked.parse(normalizedText);
        } catch (error) {
          console.error('Markdown rendering error for text:', error.message);
          renderedText = sectionText;
        }
      }

      return {
        id: sectionId,
        title: renderedTitle,
        text: renderedText,
        raw_title: sectionTitle || null,
        raw_text: sectionText || '',
        raw: row
      };
    });

    res.json({
      language: 'bangla',
      count: sections.length,
      sections
    });
  } catch (error) {
    console.error('❌ Error fetching Bangla Jesus and Mohammed:', error.message);
    res.status(500).json({ error: 'Database error', message: error.message });
  }
};

// Get Tamil Jesus and Mohammed (tamil_jesus_muhammed)
exports.getTamilJesusMohammed = async (req, res) => {
  try {
    const query = `SELECT * FROM tamil_jesus_muhammed ORDER BY 1 ASC`;
    const [rows] = await mysqlPool.query(query);

    if (!rows || rows.length === 0) {
      return res.json({
        language: 'tamil',
        count: 0,
        sections: []
      });
    }

    const sections = rows.map((row = {}, index) => {
      const sectionTitle = extractFieldValue(row, APPENDIX_TITLE_FIELDS);
      const sectionText = extractFieldValue(row, APPENDIX_TEXT_FIELDS);
      const sectionId =
        row.ID ||
        row.id ||
        row.AID ||
        row.aid ||
        row.AppendixID ||
        row.appendixId ||
        row.appendix_id ||
        index + 1;

      // Render markdown for Tamil (both title and text)
      let renderedTitle = sectionTitle || null;
      let renderedText = sectionText || '';
      
      // Render markdown for title (inline, no paragraph wrapper)
      // Handle markdown headers - support both # at start and # at end
      if (sectionTitle) {
        try {
          // Normalize markdown before processing
          const normalizedTitle = normalizeMarkdown(sectionTitle);
          let titleToRender = normalizedTitle.trim();
          // If title ends with #, convert to standard markdown header format
          if (titleToRender.endsWith('#') && !titleToRender.startsWith('#')) {
            titleToRender = '#' + titleToRender.slice(0, -1).trim();
          }
          // Markdown requires space after # for headers - add space if missing
          if (titleToRender.startsWith('#') && titleToRender.length > 1 && titleToRender[1] !== ' ') {
            titleToRender = '# ' + titleToRender.substring(1);
          }
          // Ensure proper markdown parsing
          const html = marked.parse(titleToRender);
          // Remove <p> wrapper if present, but keep headers (h1, h2, etc.)
          renderedTitle = html.replace(/^<p>|<\/p>$/g, '').trim();
        } catch (error) {
          console.error('Markdown rendering error for title:', error.message);
          renderedTitle = sectionTitle;
        }
      }
      
      // Render markdown for text
      if (sectionText) {
        try {
          // Normalize markdown before parsing
          const normalizedText = normalizeMarkdown(sectionText);
          renderedText = marked.parse(normalizedText);
        } catch (error) {
          console.error('Markdown rendering error for text:', error.message);
          renderedText = sectionText;
        }
      }

      return {
        id: sectionId,
        title: renderedTitle,
        text: renderedText,
        raw_title: sectionTitle || null,
        raw_text: sectionText || '',
        raw: row
      };
    });

    res.json({
      language: 'tamil',
      count: sections.length,
      sections
    });
  } catch (error) {
    console.error('❌ Error fetching Tamil Jesus and Mohammed:', error.message);
    res.status(500).json({ error: 'Database error', message: error.message });
  }
};

// Get Malayalam Finality of Prophethood (malparisamapthi)
exports.getMalayalamFinalityOfProphethood = async (req, res) => {
  try {
    const query = `SELECT * FROM malparisamapthi ORDER BY 1 ASC`;
    const [rows] = await mysqlPool.query(query);

    if (!rows || rows.length === 0) {
      return res.json({
        language: 'malayalam',
        count: 0,
        sections: []
      });
    }

    const sections = rows.map((row = {}, index) => {
      const sectionTitle = extractFieldValue(row, APPENDIX_TITLE_FIELDS);
      const sectionText = extractFieldValue(row, APPENDIX_TEXT_FIELDS);
      const sectionId =
        row.ID ||
        row.id ||
        row.AID ||
        row.aid ||
        row.AppendixID ||
        row.appendixId ||
        row.appendix_id ||
        index + 1;

      // Render markdown for Malayalam (both title and text)
      let renderedTitle = sectionTitle || null;
      let renderedText = sectionText || '';
      
      // Render markdown for title (inline, no paragraph wrapper)
      // Handle markdown headers - support both # at start and # at end
      if (sectionTitle) {
        try {
          // Normalize markdown before processing
          const normalizedTitle = normalizeMarkdown(sectionTitle);
          let titleToRender = normalizedTitle.trim();
          // If title ends with #, convert to standard markdown header format
          if (titleToRender.endsWith('#') && !titleToRender.startsWith('#')) {
            titleToRender = '#' + titleToRender.slice(0, -1).trim();
          }
          // Markdown requires space after # for headers - add space if missing
          if (titleToRender.startsWith('#') && titleToRender.length > 1 && titleToRender[1] !== ' ') {
            titleToRender = '# ' + titleToRender.substring(1);
          }
          // Ensure proper markdown parsing
          const html = marked.parse(titleToRender);
          // Remove <p> wrapper if present, but keep headers (h1, h2, etc.)
          renderedTitle = html.replace(/^<p>|<\/p>$/g, '').trim();
        } catch (error) {
          console.error('Markdown rendering error for title:', error.message);
          renderedTitle = sectionTitle;
        }
      }
      
      // Render markdown for text
      if (sectionText) {
        try {
          // Normalize markdown before parsing
          const normalizedText = normalizeMarkdown(sectionText);
          renderedText = marked.parse(normalizedText);
        } catch (error) {
          console.error('Markdown rendering error for text:', error.message);
          renderedText = sectionText;
        }
      }

      return {
        id: sectionId,
        title: renderedTitle,
        text: renderedText,
        raw_title: sectionTitle || null,
        raw_text: sectionText || '',
        raw: row
      };
    });

    res.json({
      language: 'malayalam',
      count: sections.length,
      sections
    });
  } catch (error) {
    console.error('❌ Error fetching Malayalam Finality of Prophethood:', error.message);
    res.status(500).json({ error: 'Database error', message: error.message });
  }
};

// Get English Finality of Prophethood (engparisamapthi)
exports.getEnglishFinalityOfProphethood = async (req, res) => {
  try {
    const query = `SELECT * FROM engparisamapthi ORDER BY 1 ASC`;
    const [rows] = await mysqlPool.query(query);

    if (!rows || rows.length === 0) {
      return res.json({
        language: 'english',
        count: 0,
        sections: []
      });
    }

    // Helper function to process footnotes: Convert (see footnote[1]) patterns to clickable HTML links
    const processFootnotes = (text) => {
      if (!text || typeof text !== 'string') return text;
      
      // Pattern 1: (see footnote[1]) or (see footnote [1])
      // This pattern should be processed first to avoid double-processing
      const originalText = text;
      text = text.replace(
        /\(see\s+footnote\s*\[(\d+)\]\)/gi,
        (match, id) => {
          console.log(`[English Finality] Processing footnote pattern: "${match}" -> ID: ${id}`);
          return `(see <sup class="footnote-link" data-footnote-id="${id}" style="color: #06b6d4; cursor: pointer; text-decoration: underline;">footnote[${id}]</sup>)`;
        }
      );
      
      // Debug: Log if any footnotes were found
      if (originalText !== text) {
        console.log('[English Finality] Footnotes processed in text');
      }
      
      // Pattern 2: footnote[1] (standalone) - only if not already inside a processed pattern
      // Check if the match is not already inside a sup tag (already processed)
      text = text.replace(
        /footnote\[(\d+)\]/gi,
        (match, id, offset, string) => {
          // Check if this match is already inside a sup tag
          const beforeMatch = string.substring(0, offset);
          const afterMatch = string.substring(offset + match.length);
          
          // Find the last unclosed sup tag before this match
          const lastSupOpen = beforeMatch.lastIndexOf('<sup');
          const lastSupClose = beforeMatch.lastIndexOf('</sup>');
          
          // If there's an unclosed sup tag, this is already processed
          if (lastSupOpen > lastSupClose) {
            return match; // Already processed, don't replace
          }
          
          // Check if this is part of "(see footnote[X])" pattern (already processed)
          const checkBefore = beforeMatch.substring(Math.max(0, beforeMatch.length - 20));
          if (checkBefore.includes('(see') && afterMatch.startsWith(')')) {
            return match; // Already processed by pattern 1
          }
          
          // Process standalone footnote
          return `<sup class="footnote-link" data-footnote-id="${id}" style="color: #06b6d4; cursor: pointer; text-decoration: underline;">footnote[${id}]</sup>`;
        }
      );
      
      return text;
    };

    const sections = rows.map((row = {}, index) => {
      const sectionTitle = extractFieldValue(row, APPENDIX_TITLE_FIELDS);
      const sectionText = extractFieldValue(row, APPENDIX_TEXT_FIELDS);
      const sectionId =
        row.ID ||
        row.id ||
        row.AID ||
        row.aid ||
        row.AppendixID ||
        row.appendixId ||
        row.appendix_id ||
        index + 1;

      // Render markdown for English (both title and text)
      let renderedTitle = sectionTitle || null;
      let renderedText = sectionText || '';
      
      // Render markdown for title (inline, no paragraph wrapper)
      // Handle markdown headers - support both # at start and # at end
      if (sectionTitle) {
        try {
          // Normalize markdown before processing
          const normalizedTitle = normalizeMarkdown(sectionTitle);
          let titleToRender = normalizedTitle.trim();
          // If title ends with #, convert to standard markdown header format
          if (titleToRender.endsWith('#') && !titleToRender.startsWith('#')) {
            titleToRender = '#' + titleToRender.slice(0, -1).trim();
          }
          // Markdown requires space after # for headers - add space if missing
          if (titleToRender.startsWith('#') && titleToRender.length > 1 && titleToRender[1] !== ' ') {
            titleToRender = '# ' + titleToRender.substring(1);
          }
          // Ensure proper markdown parsing
          const html = marked.parse(titleToRender);
          // Remove <p> wrapper if present, but keep headers (h1, h2, etc.)
          renderedTitle = html.replace(/^<p>|<\/p>$/g, '').trim();
        } catch (error) {
          console.error('Markdown rendering error for title:', error.message);
          renderedTitle = sectionTitle;
        }
      }
      
      // Render markdown for text
      if (sectionText) {
        try {
          // Normalize markdown before parsing
          const normalizedText = normalizeMarkdown(sectionText);
          renderedText = marked.parse(normalizedText);
        } catch (error) {
          console.error('Markdown rendering error for text:', error.message);
          renderedText = sectionText;
        }
      }

      // Process footnotes AFTER markdown rendering
      // This ensures we're working with the final HTML output
      if (renderedTitle) {
        renderedTitle = processFootnotes(renderedTitle);
      }
      if (renderedText) {
        renderedText = processFootnotes(renderedText);
      }

      return {
        id: sectionId,
        title: renderedTitle,
        text: renderedText,
        raw_title: sectionTitle || null,
        raw_text: sectionText || '',
        raw: row
      };
    });

    res.json({
      language: 'english',
      count: sections.length,
      sections
    });
  } catch (error) {
    console.error('❌ Error fetching English Finality of Prophethood:', error.message);
    res.status(500).json({ error: 'Database error', message: error.message });
  }
};

// Get Bangla Finality of Prophethood (bangla_parisamapthi)
exports.getBanglaFinalityOfProphethood = async (req, res) => {
  try {
    const query = `SELECT * FROM bangla_parisamapthi ORDER BY 1 ASC`;
    const [rows] = await mysqlPool.query(query);

    if (!rows || rows.length === 0) {
      return res.json({
        language: 'bangla',
        count: 0,
        sections: []
      });
    }

    const sections = rows.map((row = {}, index) => {
      const sectionTitle = extractFieldValue(row, APPENDIX_TITLE_FIELDS);
      const sectionText = extractFieldValue(row, APPENDIX_TEXT_FIELDS);
      const sectionId =
        row.ID ||
        row.id ||
        row.AID ||
        row.aid ||
        row.AppendixID ||
        row.appendixId ||
        row.appendix_id ||
        index + 1;

      // Render markdown for Bangla (both title and text)
      let renderedTitle = sectionTitle || null;
      let renderedText = sectionText || '';
      
      // Render markdown for title (inline, no paragraph wrapper)
      // Handle markdown headers - support both # at start and # at end
      if (sectionTitle) {
        try {
          // Normalize markdown before processing
          const normalizedTitle = normalizeMarkdown(sectionTitle);
          let titleToRender = normalizedTitle.trim();
          // If title ends with #, convert to standard markdown header format
          if (titleToRender.endsWith('#') && !titleToRender.startsWith('#')) {
            titleToRender = '#' + titleToRender.slice(0, -1).trim();
          }
          // Markdown requires space after # for headers - add space if missing
          if (titleToRender.startsWith('#') && titleToRender.length > 1 && titleToRender[1] !== ' ') {
            titleToRender = '# ' + titleToRender.substring(1);
          }
          // Ensure proper markdown parsing
          const html = marked.parse(titleToRender);
          // Remove <p> wrapper if present, but keep headers (h1, h2, etc.)
          renderedTitle = html.replace(/^<p>|<\/p>$/g, '').trim();
        } catch (error) {
          console.error('Markdown rendering error for title:', error.message);
          renderedTitle = sectionTitle;
        }
      }
      
      // Render markdown for text
      if (sectionText) {
        try {
          // Normalize markdown before preprocessing
          const normalizedText = normalizeMarkdown(sectionText);
          // Preprocess: Convert {dir="rtl"} markers to HTML spans for Arabic text
          // Pattern: [Arabic text]{dir="rtl"} -> <span dir="rtl">Arabic text</span>
          let processedText = normalizedText.replace(
            /\[([^\]]+)\]\{dir="rtl"\}/g,
            '<span dir="rtl" style="direction: rtl; text-align: right; display: inline-block; font-family: \'Amiri Quran\', serif;">$1</span>'
          );
          
          renderedText = marked.parse(processedText);
        } catch (error) {
          console.error('Markdown rendering error for text:', error.message);
          renderedText = sectionText;
        }
      }

      return {
        id: sectionId,
        title: renderedTitle,
        text: renderedText,
        raw_title: sectionTitle || null,
        raw_text: sectionText || '',
        raw: row
      };
    });

    res.json({
      language: 'bangla',
      count: sections.length,
      sections
    });
  } catch (error) {
    console.error('❌ Error fetching Bangla Finality of Prophethood:', error.message);
    res.status(500).json({ error: 'Database error', message: error.message });
  }
};

// Get Malayalam Introduction to Quran (malqurhanpadanammukavara)
exports.getMalayalamIntroductionToQuran = async (req, res) => {
  try {
    const query = `SELECT * FROM malqurhanpadanammukavara ORDER BY 1 ASC`;
    const [rows] = await mysqlPool.query(query);

    if (!rows || rows.length === 0) {
      return res.json({
        language: 'malayalam',
        count: 0,
        sections: []
      });
    }

    const sections = rows.map((row = {}, index) => {
      const sectionTitle = extractFieldValue(row, APPENDIX_TITLE_FIELDS);
      const sectionText = extractFieldValue(row, APPENDIX_TEXT_FIELDS);
      const sectionId =
        row.ID ||
        row.id ||
        row.AID ||
        row.aid ||
        row.AppendixID ||
        row.appendixId ||
        row.appendix_id ||
        index + 1;

      // Render markdown for Malayalam (both title and text)
      let renderedTitle = sectionTitle || null;
      let renderedText = sectionText || '';
      
      // Render markdown for title (inline, no paragraph wrapper)
      // Handle markdown headers - support both # at start and # at end
      if (sectionTitle) {
        try {
          // Normalize markdown before processing
          const normalizedTitle = normalizeMarkdown(sectionTitle);
          let titleToRender = normalizedTitle.trim();
          // If title ends with #, convert to standard markdown header format
          if (titleToRender.endsWith('#') && !titleToRender.startsWith('#')) {
            titleToRender = '#' + titleToRender.slice(0, -1).trim();
          }
          // Markdown requires space after # for headers - add space if missing
          if (titleToRender.startsWith('#') && titleToRender.length > 1 && titleToRender[1] !== ' ') {
            titleToRender = '# ' + titleToRender.substring(1);
          }
          // Ensure proper markdown parsing
          const html = marked.parse(titleToRender);
          // Remove <p> wrapper if present, but keep headers (h1, h2, etc.)
          renderedTitle = html.replace(/^<p>|<\/p>$/g, '').trim();
        } catch (error) {
          console.error('Markdown rendering error for title:', error.message);
          renderedTitle = sectionTitle;
        }
      }
      
      // Render markdown for text
      if (sectionText) {
        try {
          // Normalize markdown before parsing
          const normalizedText = normalizeMarkdown(sectionText);
          renderedText = marked.parse(normalizedText);
        } catch (error) {
          console.error('Markdown rendering error for text:', error.message);
          renderedText = sectionText;
        }
      }

      return {
        id: sectionId,
        title: renderedTitle,
        text: renderedText,
        raw_title: sectionTitle || null,
        raw_text: sectionText || '',
        raw: row
      };
    });

    res.json({
      language: 'malayalam',
      count: sections.length,
      sections
    });
  } catch (error) {
    console.error('❌ Error fetching Malayalam Introduction to Quran:', error.message);
    res.status(500).json({ error: 'Database error', message: error.message });
  }
};

// Get Hindi Introduction to Quran (hindi_quran_mukavura)
exports.getHindiIntroductionToQuran = async (req, res) => {
  try {
    const query = `SELECT * FROM hindi_quran_mukavura ORDER BY 1 ASC`;
    const [rows] = await mysqlPool.query(query);

    if (!rows || rows.length === 0) {
      return res.json({
        language: 'hindi',
        count: 0,
        sections: []
      });
    }

    const sections = rows.map((row = {}, index) => {
      const sectionTitle = extractFieldValue(row, APPENDIX_TITLE_FIELDS);
      const sectionText = extractFieldValue(row, APPENDIX_TEXT_FIELDS);
      const sectionId =
        row.ID ||
        row.id ||
        row.AID ||
        row.aid ||
        row.AppendixID ||
        row.appendixId ||
        row.appendix_id ||
        index + 1;

      // Render markdown for Hindi (both title and text)
      let renderedTitle = sectionTitle || null;
      let renderedText = sectionText || '';
      
      // Render markdown for title (inline, no paragraph wrapper)
      // Handle markdown headers - support both # at start and # at end
      if (sectionTitle) {
        try {
          // Normalize markdown before processing
          const normalizedTitle = normalizeMarkdown(sectionTitle);
          let titleToRender = normalizedTitle.trim();
          // If title ends with #, convert to standard markdown header format
          if (titleToRender.endsWith('#') && !titleToRender.startsWith('#')) {
            titleToRender = '#' + titleToRender.slice(0, -1).trim();
          }
          // Markdown requires space after # for headers - add space if missing
          if (titleToRender.startsWith('#') && titleToRender.length > 1 && titleToRender[1] !== ' ') {
            titleToRender = '# ' + titleToRender.substring(1);
          }
          // Ensure proper markdown parsing
          const html = marked.parse(titleToRender);
          // Remove <p> wrapper if present, but keep headers (h1, h2, etc.)
          renderedTitle = html.replace(/^<p>|<\/p>$/g, '').trim();
        } catch (error) {
          console.error('Markdown rendering error for title:', error.message);
          renderedTitle = sectionTitle;
        }
      }
      
      // Render markdown for text
      if (sectionText) {
        try {
          // Normalize markdown before parsing
          const normalizedText = normalizeMarkdown(sectionText);
          renderedText = marked.parse(normalizedText);
        } catch (error) {
          console.error('Markdown rendering error for text:', error.message);
          renderedText = sectionText;
        }
      }

      return {
        id: sectionId,
        title: renderedTitle,
        text: renderedText,
        raw_title: sectionTitle || null,
        raw_text: sectionText || '',
        raw: row
      };
    });

    res.json({
      language: 'hindi',
      count: sections.length,
      sections
    });
  } catch (error) {
    console.error('❌ Error fetching Hindi Introduction to Quran:', error.message);
    res.status(500).json({ error: 'Database error', message: error.message });
  }
};

// Get English Introduction to Quran (engqurhanpadanammukavara)
exports.getEnglishIntroductionToQuran = async (req, res) => {
  try {
    const query = `SELECT * FROM engqurhanpadanammukavara ORDER BY 1 ASC`;
    const [rows] = await mysqlPool.query(query);

    if (!rows || rows.length === 0) {
      return res.json({
        language: 'english',
        count: 0,
        sections: []
      });
    }

    const sections = rows.map((row = {}, index) => {
      const sectionTitle = extractFieldValue(row, APPENDIX_TITLE_FIELDS);
      const sectionText = extractFieldValue(row, APPENDIX_TEXT_FIELDS);
      const sectionId =
        row.ID ||
        row.id ||
        row.AID ||
        row.aid ||
        row.AppendixID ||
        row.appendixId ||
        row.appendix_id ||
        index + 1;

      // Render markdown for English (both title and text)
      let renderedTitle = sectionTitle || null;
      let renderedText = sectionText || '';
      
      // Render markdown for title (inline, no paragraph wrapper)
      // Handle markdown headers - support both # at start and # at end
      if (sectionTitle) {
        try {
          // Normalize markdown before processing
          const normalizedTitle = normalizeMarkdown(sectionTitle);
          let titleToRender = normalizedTitle.trim();
          // If title ends with #, convert to standard markdown header format
          if (titleToRender.endsWith('#') && !titleToRender.startsWith('#')) {
            titleToRender = '#' + titleToRender.slice(0, -1).trim();
          }
          // Markdown requires space after # for headers - add space if missing
          if (titleToRender.startsWith('#') && titleToRender.length > 1 && titleToRender[1] !== ' ') {
            titleToRender = '# ' + titleToRender.substring(1);
          }
          // Ensure proper markdown parsing
          const html = marked.parse(titleToRender);
          // Remove <p> wrapper if present, but keep headers (h1, h2, etc.)
          renderedTitle = html.replace(/^<p>|<\/p>$/g, '').trim();
        } catch (error) {
          console.error('Markdown rendering error for title:', error.message);
          renderedTitle = sectionTitle;
        }
      }
      
      // Render markdown for text
      if (sectionText) {
        try {
          // Normalize markdown before parsing
          const normalizedText = normalizeMarkdown(sectionText);
          renderedText = marked.parse(normalizedText);
        } catch (error) {
          console.error('Markdown rendering error for text:', error.message);
          renderedText = sectionText;
        }
      }

      return {
        id: sectionId,
        title: renderedTitle,
        text: renderedText,
        raw_title: sectionTitle || null,
        raw_text: sectionText || '',
        raw: row
      };
    });

    res.json({
      language: 'english',
      count: sections.length,
      sections
    });
  } catch (error) {
    console.error('❌ Error fetching English Introduction to Quran:', error.message);
    res.status(500).json({ error: 'Database error', message: error.message });
  }
};

// Get Bangla Introduction to Quran (bangla_quran_mukavura)
exports.getBanglaIntroductionToQuran = async (req, res) => {
  try {
    const query = `SELECT * FROM bangla_quran_mukavura ORDER BY 1 ASC`;
    const [rows] = await mysqlPool.query(query);

    if (!rows || rows.length === 0) {
      return res.json({
        language: 'bangla',
        count: 0,
        sections: []
      });
    }

    const sections = rows.map((row = {}, index) => {
      const sectionTitle = extractFieldValue(row, APPENDIX_TITLE_FIELDS);
      const sectionText = extractFieldValue(row, APPENDIX_TEXT_FIELDS);
      const sectionId =
        row.ID ||
        row.id ||
        row.AID ||
        row.aid ||
        row.AppendixID ||
        row.appendixId ||
        row.appendix_id ||
        index + 1;

      // Render markdown for Bangla (both title and text)
      let renderedTitle = sectionTitle || null;
      let renderedText = sectionText || '';
      
      // Render markdown for title (inline, no paragraph wrapper)
      // Handle markdown headers - support both # at start and # at end
      if (sectionTitle) {
        try {
          // Normalize markdown before processing
          const normalizedTitle = normalizeMarkdown(sectionTitle);
          let titleToRender = normalizedTitle.trim();
          
          // Fix bold+italic patterns: normalize ***text*** format
          // Handle patterns like ****text*** or ***text**** or * **text** * or ****text
          // Normalize 4+ asterisks to 3 asterisks for bold+italic
          titleToRender = titleToRender.replace(/\*{4,}([^*]+)\*{3,}/g, '***$1***');
          titleToRender = titleToRender.replace(/\*{3,}([^*]+)\*{4,}/g, '***$1***');
          titleToRender = titleToRender.replace(/\*{3,}([^*]+)\*{3,}/g, '***$1***');
          titleToRender = titleToRender.replace(/\*\s+\*\*([^*]+)\*\*\s+\*/g, '***$1***');
          
          // If title ends with #, convert to standard markdown header format
          if (titleToRender.endsWith('#') && !titleToRender.startsWith('#')) {
            titleToRender = '#' + titleToRender.slice(0, -1).trim();
          }
          // Markdown requires space after # for headers - add space if missing
          if (titleToRender.startsWith('#') && titleToRender.length > 1 && titleToRender[1] !== ' ') {
            titleToRender = '# ' + titleToRender.substring(1);
          }
          // Ensure proper markdown parsing
          const html = marked.parse(titleToRender);
          // Remove <p> wrapper if present, but keep headers (h1, h2, etc.)
          renderedTitle = html.replace(/^<p>|<\/p>$/g, '').trim();
        } catch (error) {
          console.error('Markdown rendering error for title:', error.message);
          renderedTitle = sectionTitle;
        }
      }
      
      // Render markdown for text
      if (sectionText) {
        try {
          // Normalize markdown before preprocessing
          const normalizedText = normalizeMarkdown(sectionText);
          // Preprocess: Normalize bold+italic markdown (***text***)
          // Fix patterns like ****text*** or ***text**** or * **text** * or ****text
          // Normalize 4+ asterisks to 3 asterisks for bold+italic
          let processedText = normalizedText;
          processedText = processedText.replace(/\*{4,}([^*]+)\*{3,}/g, '***$1***');
          processedText = processedText.replace(/\*{3,}([^*]+)\*{4,}/g, '***$1***');
          processedText = processedText.replace(/\*{3,}([^*]+)\*{3,}/g, '***$1***');
          processedText = processedText.replace(/\*\s+\*\*([^*]+)\*\*\s+\*/g, '***$1***');
          
          renderedText = marked.parse(processedText);
        } catch (error) {
          console.error('Markdown rendering error for text:', error.message);
          renderedText = sectionText;
        }
      }

      return {
        id: sectionId,
        title: renderedTitle,
        text: renderedText,
        raw_title: sectionTitle || null,
        raw_text: sectionText || '',
        raw: row
      };
    });

    res.json({
      language: 'bangla',
      count: sections.length,
      sections
    });
  } catch (error) {
    console.error('❌ Error fetching Bangla Introduction to Quran:', error.message);
    res.status(500).json({ error: 'Database error', message: error.message });
  }
};

// Get Tamil Introduction to Quran (tamil_side_menu, aid 4)
// Table structure: aid (int), title (text), matter (mediumtext)
exports.getTamilIntroductionToQuran = async (req, res) => {
  try {
    // Query tamil_side_menu table for aid 4 (the ID column is 'aid', not 'id')
    const query = `SELECT * FROM tamil_side_menu WHERE aid = 4 LIMIT 1`;
    const [rows] = await mysqlPool.query(query);

    if (!rows || rows.length === 0) {
      console.warn('⚠️ Tamil Introduction to Quran: No data found in tamil_side_menu table with aid 4');
      return res.json({
        language: 'tamil',
        count: 0,
        sections: []
      });
    }

    const row = rows[0];
    // Table has 'title' and 'matter' columns
    // Try to extract title and text from the row
    const sectionTitle = row.title || extractFieldValue(row, APPENDIX_TITLE_FIELDS);
    const sectionText = row.matter || extractFieldValue(row, APPENDIX_TEXT_FIELDS);
    const sectionId = row.aid || row.AID || 4;

    // Render markdown for Tamil (both title and text)
    let renderedTitle = sectionTitle || null;
    let renderedText = sectionText || '';
    
    // Render markdown for title (inline, no paragraph wrapper)
    if (sectionTitle) {
      try {
        // Normalize markdown before processing
        const normalizedTitle = normalizeMarkdown(sectionTitle);
        let titleToRender = normalizedTitle.trim();
        // If title ends with #, convert to standard markdown header format
        if (titleToRender.endsWith('#') && !titleToRender.startsWith('#')) {
          titleToRender = '#' + titleToRender.slice(0, -1).trim();
        }
        // Markdown requires space after # for headers - add space if missing
        if (titleToRender.startsWith('#') && titleToRender.length > 1 && titleToRender[1] !== ' ') {
          titleToRender = '# ' + titleToRender.substring(1);
        }
        // Ensure proper markdown parsing
        const html = marked.parse(titleToRender);
        // Remove <p> wrapper if present, but keep headers (h1, h2, etc.)
        renderedTitle = html.replace(/^<p>|<\/p>$/g, '').trim();
      } catch (error) {
        console.error('Markdown rendering error for title:', error.message);
        renderedTitle = sectionTitle;
      }
    }
    
    // Render markdown for text
    if (sectionText) {
      try {
        // Normalize markdown before parsing
        const normalizedText = normalizeMarkdown(sectionText);
        renderedText = marked.parse(normalizedText);
      } catch (error) {
        console.error('Markdown rendering error for text:', error.message);
        renderedText = sectionText;
      }
    }

    // Return as a single section (since it's one article)
    const sections = [{
      id: sectionId,
      title: renderedTitle,
      text: renderedText,
      raw_title: sectionTitle || null,
      raw_text: sectionText || '',
      raw: row
    }];

    res.json({
      language: 'tamil',
      count: sections.length,
      sections
    });
  } catch (error) {
    console.error('❌ Error fetching Tamil Introduction to Quran:', {
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      table: 'tamil_side_menu',
      id: 4
    });
    res.status(500).json({ 
      error: 'Database error', 
      message: error.message,
      details: process.env.NODE_ENV === 'development' ? {
        table: 'tamil_side_menu',
        id: 4,
        hint: 'Check if table exists and has a row with id = 4'
      } : undefined
    });
  }
};

// Get Tamil Finality of Prophethood (tamil_parisamapthi)
exports.getTamilFinalityOfProphethood = async (req, res) => {
  try {
    const query = `SELECT * FROM tamil_parisamapthi ORDER BY 1 ASC`;
    const [rows] = await mysqlPool.query(query);

    if (!rows || rows.length === 0) {
      return res.json({
        language: 'tamil',
        count: 0,
        sections: []
      });
    }

    const sections = rows.map((row = {}, index) => {
      const sectionTitle = extractFieldValue(row, APPENDIX_TITLE_FIELDS);
      const sectionText = extractFieldValue(row, APPENDIX_TEXT_FIELDS);
      const sectionId =
        row.ID ||
        row.id ||
        row.AID ||
        row.aid ||
        row.AppendixID ||
        row.appendixId ||
        row.appendix_id ||
        index + 1;

      // Render markdown for Tamil (both title and text)
      let renderedTitle = sectionTitle || null;
      let renderedText = sectionText || '';
      
      // Render markdown for title (inline, no paragraph wrapper)
      // Handle markdown headers - support both # at start and # at end
      if (sectionTitle) {
        try {
          // Normalize markdown before processing
          const normalizedTitle = normalizeMarkdown(sectionTitle);
          let titleToRender = normalizedTitle.trim();
          // If title ends with #, convert to standard markdown header format
          if (titleToRender.endsWith('#') && !titleToRender.startsWith('#')) {
            titleToRender = '#' + titleToRender.slice(0, -1).trim();
          }
          // Markdown requires space after # for headers - add space if missing
          if (titleToRender.startsWith('#') && titleToRender.length > 1 && titleToRender[1] !== ' ') {
            titleToRender = '# ' + titleToRender.substring(1);
          }
          // Ensure proper markdown parsing
          const html = marked.parse(titleToRender);
          // Remove <p> wrapper if present, but keep headers (h1, h2, etc.)
          renderedTitle = html.replace(/^<p>|<\/p>$/g, '').trim();
        } catch (error) {
          console.error('Markdown rendering error for title:', error.message);
          renderedTitle = sectionTitle;
        }
      }
      
      // Render markdown for text
      if (sectionText) {
        try {
          // Normalize markdown before parsing
          const normalizedText = normalizeMarkdown(sectionText);
          renderedText = marked.parse(normalizedText);
        } catch (error) {
          console.error('Markdown rendering error for text:', error.message);
          renderedText = sectionText;
        }
      }

      return {
        id: sectionId,
        title: renderedTitle,
        text: renderedText,
        raw_title: sectionTitle || null,
        raw_text: sectionText || '',
        raw: row
      };
    });

    res.json({
      language: 'tamil',
      count: sections.length,
      sections
    });
  } catch (error) {
    console.error('❌ Error fetching Tamil Finality of Prophethood:', error.message);
    res.status(500).json({ error: 'Database error', message: error.message });
  }
};

// Get article by ID from articles table
exports.getArticleById = async (req, res) => {
  try {
    const { articleId } = req.params;
    const articleIdNum = parseInt(articleId);

    if (isNaN(articleIdNum)) {
      return res.status(400).json({ error: 'Invalid article ID' });
    }

    // Try ID (uppercase) first, which is most common in MySQL
    let query = `SELECT * FROM articles WHERE ID = ? LIMIT 1`;
    let [rows] = await mysqlPool.query(query, [articleIdNum]);
    
    // If no results, try lowercase id
    if (!rows || rows.length === 0) {
      query = `SELECT * FROM articles WHERE id = ? LIMIT 1`;
      [rows] = await mysqlPool.query(query, [articleIdNum]);
    }
    
    // If still no results, try article_id
    if (!rows || rows.length === 0) {
      query = `SELECT * FROM articles WHERE article_id = ? LIMIT 1`;
      [rows] = await mysqlPool.query(query, [articleIdNum]);
    }

    if (!rows || rows.length === 0) {
      return res.status(404).json({
        error: 'Article not found',
        message: `Article with ID ${articleId} not found`
      });
    }

    const article = rows[0];
    const articleTitle = extractFieldValue(article, APPENDIX_TITLE_FIELDS);
    const articleText = extractFieldValue(article, APPENDIX_TEXT_FIELDS);

    // Render markdown for title
    let renderedTitle = articleTitle || null;
    if (articleTitle) {
      try {
        // Normalize markdown before processing
        const normalizedTitle = normalizeMarkdown(articleTitle);
        let titleToRender = normalizedTitle.trim();
        if (titleToRender.endsWith('#') && !titleToRender.startsWith('#')) {
          titleToRender = '#' + titleToRender.slice(0, -1).trim();
        }
        if (titleToRender.startsWith('#') && titleToRender.length > 1 && titleToRender[1] !== ' ') {
          titleToRender = '# ' + titleToRender.substring(1);
        }
        const html = marked.parse(titleToRender);
        renderedTitle = html.replace(/^<p>|<\/p>$/g, '').trim();
      } catch (error) {
        console.error('Markdown rendering error for title:', error.message);
        renderedTitle = articleTitle;
      }
    }

    // Render markdown for text
    let renderedText = articleText || '';
    if (articleText) {
      try {
        // Normalize markdown before parsing
        const normalizedText = normalizeMarkdown(articleText);
        renderedText = marked.parse(normalizedText);
      } catch (error) {
        console.error('Markdown rendering error for text:', error.message);
        renderedText = articleText;
      }
    }

    // Get the actual ID from the article (try different column names)
    const extractedId = article.ID || article.id || article.article_id || article.ArticleID || articleIdNum;

    res.json({
      id: extractedId,
      title: renderedTitle,
      text: renderedText,
      raw_title: articleTitle || null,
      raw_text: articleText || '',
      raw: article
    });
  } catch (error) {
    console.error('❌ Error fetching article:', error.message);
    res.status(500).json({ error: 'Database error', message: error.message });
  }
};

// Get Malayalam Technical Terms (article ID 9 from articles table)
exports.getMalayalamTechnicalTerms = async (req, res) => {
  try {
    // Query all articles and find the one with ID 9
    // This avoids needing to know the exact column name
    const query = `SELECT * FROM articles LIMIT 100`;
    const [allRows] = await mysqlPool.query(query);
    
    // Find the row where any ID-like column equals 9
    let article = null;
    for (const row of allRows) {
      // Check all possible ID column names
      const rowId = row.ID || row.id || row.article_id || row.ArticleID || row.Article_Id || 
                    row.articleId || row.ArticleId || row['Article ID'] || row['article id'];
      
      if (rowId == 9) { // Use == for loose comparison (handles string "9" vs number 9)
        article = row;
        break;
      }
    }
    
    // If not found in first 100, try to get by checking title contains "സങ്കേതസൂചി"
    if (!article) {
      for (const row of allRows) {
        const title = row.title || row.Title || row.TITLE || row.name || row.Name || 
                      row.subtitle || row.Subtitle || row.label || row.Label || '';
        if (title.includes('സങ്കേതസൂചി') || title.includes('സാങ്കേതിക')) {
          article = row;
          break;
        }
      }
    }
    
    if (!article) {
      return res.json({
        language: 'malayalam',
        title: null,
        text: '',
        raw_title: null,
        raw_text: '',
        error: 'Article not found'
      });
    }
    const articleTitle = extractFieldValue(article, APPENDIX_TITLE_FIELDS);
    const articleText = extractFieldValue(article, APPENDIX_TEXT_FIELDS);

    // Render markdown for title
    let renderedTitle = articleTitle || null;
    if (articleTitle) {
      try {
        // Normalize markdown before processing
        const normalizedTitle = normalizeMarkdown(articleTitle);
        let titleToRender = normalizedTitle.trim();
        if (titleToRender.endsWith('#') && !titleToRender.startsWith('#')) {
          titleToRender = '#' + titleToRender.slice(0, -1).trim();
        }
        if (titleToRender.startsWith('#') && titleToRender.length > 1 && titleToRender[1] !== ' ') {
          titleToRender = '# ' + titleToRender.substring(1);
        }
        const html = marked.parse(titleToRender);
        renderedTitle = html.replace(/^<p>|<\/p>$/g, '').trim();
      } catch (error) {
        console.error('Markdown rendering error for title:', error.message);
        renderedTitle = articleTitle;
      }
    }

    // Render markdown for text
    let renderedText = articleText || '';
    if (articleText) {
      try {
        // Normalize markdown before parsing
        const normalizedText = normalizeMarkdown(articleText);
        renderedText = marked.parse(normalizedText);
      } catch (error) {
        console.error('Markdown rendering error for text:', error.message);
        renderedText = articleText;
      }
    }

    // Get the actual ID from the article (try different column names)
    const extractedId = article.ID || article.id || article.article_id || article.ArticleID || 9;

    res.json({
      language: 'malayalam',
      id: extractedId,
      title: renderedTitle,
      text: renderedText,
      raw_title: articleTitle || null,
      raw_text: articleText || '',
      raw: article
    });
  } catch (error) {
    console.error('❌ Error fetching Malayalam Technical Terms:', error.message);
    res.status(500).json({ error: 'Database error', message: error.message });
  }
};

// Get Technical Terms by language (from technical_terms table)
exports.getTechnicalTermsByLanguage = async (req, res) => {
  try {
    const langParam = (req.params.language || '').toLowerCase();

    // Map frontend language codes to DB language values
    const langMap = {
      english: 'english', e: 'english', en: 'english',
      urdu: 'urdu', ur: 'urdu',
      hindi: 'hindi', hi: 'hindi',
      bangla: 'bangla', bn: 'bangla', bengali: 'bangla',
      tamil: 'tamil', ta: 'tamil',
    };

    const dbLanguage = langMap[langParam];
    if (!dbLanguage) {
      return res.status(400).json({ error: 'Invalid language', message: `Unsupported language: ${langParam}` });
    }

    const [rows] = await mysqlPool.query(
      'SELECT id, language, title, matter, audio_url FROM technical_terms WHERE language = ? LIMIT 1',
      [dbLanguage]
    );

    if (!rows.length) {
      return res.json({
        language: dbLanguage,
        title: null,
        text: '',
        audio_url: null,
        error: 'Technical terms not found for this language',
      });
    }

    const row = rows[0];
    res.json({
      language: row.language,
      id: row.id,
      title: row.title || null,
      text: row.matter || '',
      audio_url: row.audio_url || null,
    });
  } catch (error) {
    console.error('❌ Error fetching Technical Terms:', error.message);
    res.status(500).json({ error: 'Database error', message: error.message });
  }
};

// Get Malayalam Translators (from articles table)
exports.getMalayalamTranslators = async (req, res) => {
  try {
    // Query all articles and find the one with "വിവർത്തകർ" or "translators" in title
    const query = `SELECT * FROM articles LIMIT 100`;
    const [allRows] = await mysqlPool.query(query);
    
    // Find the row where title contains "വിവർത്തകർ" or similar
    let article = null;
    for (const row of allRows) {
      const title = row.title || row.Title || row.TITLE || row.name || row.Name || 
                    row.subtitle || row.Subtitle || row.label || row.Label || '';
      const matter = row.matter || row.Matter || row.MATTER || row.content || row.Content || '';
      
      // Check if title or content contains Malayalam "വിവർത്തകർ" or English "translators"
      if (title.includes('വിവർത്തകർ') || title.includes('വിവര്ത്തകര്‍') || 
          title.toLowerCase().includes('translator') || 
          matter.includes('വിവർത്തകർ') || matter.includes('tk.png') || matter.includes('tka.png')) {
        article = row;
        break;
      }
    }
    
    if (!article) {
      return res.json({
        language: 'malayalam',
        title: null,
        text: '',
        raw_title: null,
        raw_text: '',
        error: 'Article not found'
      });
    }
    
    const articleTitle = extractFieldValue(article, APPENDIX_TITLE_FIELDS);
    const articleText = extractFieldValue(article, APPENDIX_TEXT_FIELDS);

    // Render markdown for title
    let renderedTitle = articleTitle || null;
    if (articleTitle) {
      try {
        // Normalize markdown before processing
        const normalizedTitle = normalizeMarkdown(articleTitle);
        let titleToRender = normalizedTitle.trim();
        if (titleToRender.endsWith('#') && !titleToRender.startsWith('#')) {
          titleToRender = '#' + titleToRender.slice(0, -1).trim();
        }
        if (titleToRender.startsWith('#') && titleToRender.length > 1 && titleToRender[1] !== ' ') {
          titleToRender = '# ' + titleToRender.substring(1);
        }
        const html = marked.parse(titleToRender);
        renderedTitle = html.replace(/^<p>|<\/p>$/g, '').trim();
      } catch (error) {
        console.error('Markdown rendering error for title:', error.message);
        renderedTitle = articleTitle;
      }
    }

    // Render markdown for text
    let renderedText = articleText || '';
    if (articleText) {
      try {
        // Normalize markdown before parsing
        const normalizedText = normalizeMarkdown(articleText);
        renderedText = marked.parse(normalizedText);
      } catch (error) {
        console.error('Markdown rendering error for text:', error.message);
        renderedText = articleText;
      }
    }

    // Get the actual ID from the article (try different column names)
    const extractedId = article.ID || article.id || article.article_id || article.ArticleID || 
                        article.aid || article.AID || null;

    res.json({
      language: 'malayalam',
      id: extractedId,
      title: renderedTitle,
      text: renderedText,
      raw_title: articleTitle || null,
      raw_text: articleText || '',
      raw: article
    });
  } catch (error) {
    console.error('❌ Error fetching Malayalam Translators:', error.message);
    res.status(500).json({ error: 'Database error', message: error.message });
  }
};

// Get Malayalam History of Translation (article ID 11 from articles table)
exports.getMalayalamHistoryOfTranslation = async (req, res) => {
  try {
    // Query all articles and find the one with ID 11
    const query = `SELECT * FROM articles LIMIT 100`;
    const [allRows] = await mysqlPool.query(query);
    
    // Find the row where any ID-like column equals 11
    let foundArticle = null;
    for (const row of allRows) {
      // Check all possible ID column names
      const rowId = row.ID || row.id || row.article_id || row.ArticleID || row.Article_Id ||
                    row.articleId || row.ArticleId || row['Article ID'] || row['article id'];

      if (rowId == 11) { // Use == for loose comparison (handles string "11" vs number 11)
        foundArticle = row;
        break;
      }
    }
    
    // If not found in first 100, try to get by checking title contains "വിവർത്തന" or "history"
    if (!foundArticle) {
      for (const row of allRows) {
        const title = row.title || row.Title || row.TITLE || row.name || row.Name ||
                      row.subtitle || row.Subtitle || row.label || row.Label || '';
        if (title.includes('വിവർത്തന') || title.includes('ചരിത്രം') || 
            title.toLowerCase().includes('history')) {
          foundArticle = row;
          break;
        }
      }
    }
    
    if (!foundArticle) {
      return res.json({
        language: 'malayalam',
        title: null,
        text: '',
        raw_title: null,
        raw_text: '',
        error: 'Article not found'
      });
    }
    
    const articleTitle = extractFieldValue(foundArticle, APPENDIX_TITLE_FIELDS);
    const articleText = extractFieldValue(foundArticle, APPENDIX_TEXT_FIELDS);

    // Render markdown for title
    let renderedTitle = articleTitle || null;
    if (articleTitle) {
      try {
        // Normalize markdown before processing
        const normalizedTitle = normalizeMarkdown(articleTitle);
        let titleToRender = normalizedTitle.trim();
        if (titleToRender.endsWith('#') && !titleToRender.startsWith('#')) {
          titleToRender = '#' + titleToRender.slice(0, -1).trim();
        }
        if (titleToRender.startsWith('#') && titleToRender.length > 1 && titleToRender[1] !== ' ') {
          titleToRender = '# ' + titleToRender.substring(1);
        }
        const html = marked.parse(titleToRender);
        renderedTitle = html.replace(/^<p>|<\/p>$/g, '').trim();
      } catch (error) {
        console.error('Markdown rendering error for title:', error.message);
        renderedTitle = articleTitle;
      }
    }

    // Render markdown for text
    let renderedText = articleText || '';
    if (articleText) {
      try {
        // Normalize markdown before parsing
        const normalizedText = normalizeMarkdown(articleText);
        renderedText = marked.parse(normalizedText);
      } catch (error) {
        console.error('Markdown rendering error for text:', error.message);
        renderedText = articleText;
      }
    }

    // Get the actual ID from the article (try different column names)
    const extractedId = foundArticle.ID || foundArticle.id || foundArticle.article_id || 
                        foundArticle.ArticleID || foundArticle.Article_Id || 
                        foundArticle.articleId || foundArticle.ArticleId || 
                        foundArticle['Article ID'] || foundArticle['article id'] || 11;

    res.json({
      language: 'malayalam',
      id: extractedId,
      title: renderedTitle,
      text: renderedText,
      raw_title: articleTitle || null,
      raw_text: articleText || '',
      raw: foundArticle
    });
  } catch (error) {
    console.error('❌ Error fetching Malayalam History of Translation:', error.message);
    res.status(500).json({ error: 'Database error', message: error.message });
  }
};

// Get all translations for a surah
exports.getSurahTranslations = async (req, res) => {
  try {
    const { language, surah } = req.params;
    const { page: pageParam, pageSize, limit: limitParam } = req.query;
    const lang = language.toLowerCase();
    const tableConfig = getTableConfig(lang, 'translation');

    if (!tableConfig) {
      return res.status(400).json({ error: 'Invalid language' });
    }

    const { table, chapter, verse, verseFrom, verseTo, text, isRange } = tableConfig;
    const surahNum = parseInt(surah);

    const paginationEnabled = isPaginationRequested(req.query);

    const isEnglish = lang === 'english' || lang === 'e';
    let englishInterpretations = [];
    if (isEnglish) {
      englishInterpretations = await fetchEnglishInterpretations(surahNum);
    }

    if (!paginationEnabled) {
      let translations = [];

      if (isRange) {
        // Range-based: get all ranges for surah and parse
        const query = `SELECT ${text}, ${verseFrom}, ${verseTo} FROM ${table} WHERE ${chapter} = ? ORDER BY ${verseFrom} ASC`;
        const [rows] = await mysqlPool.query(query, [surahNum]);
        rows.forEach(row => {
          for (let a = row[verseFrom]; a <= row[verseTo]; a++) {
            const extracted = extractAyahFromRange(row[text], a, row[verseFrom], row[verseTo]);
            translations.push({
              verse_number: a,
              translation_text: extracted || row[text],
            });
          }
        });
      } else {
        // Direct query
        const query = `SELECT ${verse}, ${text} FROM ${table} WHERE ${chapter} = ? ORDER BY ${verse} ASC`;
        const [rows] = await mysqlPool.query(query, [surahNum]);
        translations = rows.map(row => ({
          verse_number: row[verse],
          translation_text: row[text] || ''
        }));
      }

      if (isEnglish && translations.length > 0) {
        translations = attachEnglishInterpretationsToVerses(translations, englishInterpretations);
        
        // Parse footnote metadata for each translation
        translations = translations.map(verse => {
          if (verse.translation_text) {
            const parsed = parseEnglishTranslationFootnotes(verse.translation_text, surahNum, verse.verse_number || verse.number);
            verse.raw_translation_text = parsed.rawHtml;
            verse.translation_text = parsed.processedHtml || parsed.rawHtml;
            verse.footnote_metadata = {
              structured: parsed.footnotes,
              loose: parsed.looseNumbers,
              total: parsed.footnotes.length + parsed.looseNumbers.length
            };
          }
          return verse;
        });
      }

      return res.json({
        language: lang,
        surah: surahNum,
        count: translations.length,
        translations
      });
    }

    const page = parsePositiveInt(pageParam, 1);
    let limit = parsePositiveInt(limitParam || pageSize, DEFAULT_PAGE_SIZE);
    limit = Math.min(limit || DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    const totalVerses = await getSurahVerseCount(surahNum);

    if (totalVerses === 0) {
      return res.status(404).json({ error: 'Surah not found', message: `No verses found for Surah ${surah}` });
    }

    const offset = (page - 1) * limit;
    if (offset >= totalVerses) {
      const pagination = buildPaginationMeta(page, limit, totalVerses, totalVerses + 1, totalVerses);
      return res.json({ language: lang, surah: surahNum, count: 0, translations: [], pagination });
    }

    const fromAyah = offset + 1;
    const toAyah = Math.min(offset + limit, totalVerses);
    let translations = [];

    if (isRange) {
      const query = `SELECT ${text}, ${verseFrom}, ${verseTo} FROM ${table} WHERE ${chapter} = ? AND ${verseFrom} <= ? AND ${verseTo} >= ? ORDER BY ${verseFrom} ASC`;
      const [rows] = await mysqlPool.query(query, [surahNum, toAyah, fromAyah]);
      rows.forEach(row => {
        const start = Math.max(row[verseFrom], fromAyah);
        const end = Math.min(row[verseTo], toAyah);
        for (let a = start; a <= end; a++) {
          const extracted = extractAyahFromRange(row[text], a, row[verseFrom], row[verseTo]);
          translations.push({
            verse_number: a,
            translation_text: extracted || row[text],
          });
        }
      });
    } else {
      const query = `SELECT ${verse}, ${text} FROM ${table} WHERE ${chapter} = ? AND ${verse} BETWEEN ? AND ? ORDER BY ${verse} ASC`;
      const [rows] = await mysqlPool.query(query, [surahNum, fromAyah, toAyah]);
      translations = rows.map(row => ({
        verse_number: row[verse],
        translation_text: row[text] || ''
      }));
    }

    if (isEnglish && translations.length > 0) {
      translations = attachEnglishInterpretationsToVerses(translations, englishInterpretations);
      
      // Parse footnote metadata for each translation
      translations = translations.map(verse => {
        if (verse.translation_text) {
          const parsed = parseEnglishTranslationFootnotes(verse.translation_text, surahNum, verse.verse_number || verse.number);
          verse.raw_translation_text = parsed.rawHtml;
          verse.translation_text = parsed.processedHtml || parsed.rawHtml;
          verse.footnote_metadata = {
            structured: parsed.footnotes,
            loose: parsed.looseNumbers,
            total: parsed.footnotes.length + parsed.looseNumbers.length
          };
        }
        return verse;
      });
    }

    const pagination = buildPaginationMeta(page, limit, totalVerses, fromAyah, toAyah);
    res.json({
      language: lang,
      surah: surahNum,
      count: translations.length,
      translations,
      pagination
    });
  } catch (error) {
    console.error(`❌ Error fetching surah translations:`, error.message);
    res.status(500).json({ error: 'Database error', message: error.message });
  }
};

// Get Arabic verses for a surah with optional pagination
exports.getArabicSurahVerses = async (req, res) => {
  try {
    const { surah } = req.params;
    const { page: pageParam, pageSize, limit: limitParam } = req.query;
    const surahNum = parseInt(surah, 10);

    if (Number.isNaN(surahNum) || surahNum < 1) {
      return res.status(400).json({ error: 'Invalid surah', message: 'Surah must be a positive number' });
    }

    const paginationEnabled = isPaginationRequested(req.query);

    // Check in-memory cache
    const cacheKey = paginationEnabled
      ? `arabic:${surahNum}:p${pageParam || 1}:l${limitParam || pageSize || DEFAULT_PAGE_SIZE}`
      : `arabic:${surahNum}:all`;
    const cached = getQuranayaCached(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const baseQuery = 'SELECT ayaid AS ayah, AyaHText AS text_uthmani, AyaNText AS text_simple FROM quranayas WHERE suraid = ? ORDER BY ayaid ASC';

    if (!paginationEnabled) {
      const [rows] = await mysqlPool.query(baseQuery, [surahNum]);
      const verses = rows.map(row => ({
        ayah: row.ayah,
        text_uthmani: row.text_uthmani || '',
        text_simple: row.text_simple || ''
      }));

      const result = { language: 'arabic', surah: surahNum, count: verses.length, verses };
      setQuranayaCache(cacheKey, result);
      return res.json(result);
    }

    const totalVerses = await getSurahVerseCount(surahNum);
    if (totalVerses === 0) {
      return res.status(404).json({ error: 'Surah not found', message: `No verses found for Surah ${surah}` });
    }

    const page = parsePositiveInt(pageParam, 1);
    let limit = parsePositiveInt(limitParam || pageSize, DEFAULT_PAGE_SIZE);
    limit = Math.min(limit || DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    const offset = (page - 1) * limit;

    if (offset >= totalVerses) {
      const pagination = buildPaginationMeta(page, limit, totalVerses, totalVerses + 1, totalVerses);
      return res.json({ language: 'arabic', surah: surahNum, count: 0, verses: [], pagination });
    }

    const fromAyah = offset + 1;
    const toAyah = Math.min(offset + limit, totalVerses);
    const pagedQuery = `${baseQuery} LIMIT ? OFFSET ?`;
    const [rows] = await mysqlPool.query(pagedQuery, [surahNum, limit, offset]);

    const verses = rows.map(row => ({
      ayah: row.ayah,
      text_uthmani: row.text_uthmani || '',
      text_simple: row.text_simple || ''
    }));

    const pagination = buildPaginationMeta(page, limit, totalVerses, fromAyah, toAyah);
    const result = { language: 'arabic', surah: surahNum, count: verses.length, verses, pagination };
    setQuranayaCache(cacheKey, result);
    res.json(result);
  } catch (error) {
    console.error('❌ Error fetching Arabic verses:', error.message);
    
    // Check for connection timeout errors
    if (error.code === 'ETIMEDOUT' || error.code === 'ECONNREFUSED' || error.message.includes('ETIMEDOUT') || error.message.includes('ECONNREFUSED')) {
      return res.status(503).json({ 
        error: 'Database connection timeout', 
        message: 'Unable to connect to database. Please check if the database server is running.',
        code: error.code
      });
    }
    
    res.status(500).json({ error: 'Database error', message: error.message });
  }
};

// Get blockwise translation (range of ayahs)
exports.getBlockwiseTranslation = async (req, res) => {
  try {
    const { surah, range, language } = req.params;
    const [fromAyah, toAyah] = range.split('-').map(Number);

    if (isNaN(fromAyah) || isNaN(toAyah) || fromAyah > toAyah) {
      return res.status(400).json({ error: 'Invalid range', message: 'Range should be in format: from-to (e.g., 1-7)' });
    }

    const lang = language.toLowerCase();
    const surahNum = parseInt(surah);
    const isMalayalam = lang === 'malayalam' || lang === 'mal';
    const isEnglish = lang === 'english' || lang === 'e';

    // Pagination support (minimal - for future use)
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 1;

    // Check in-memory cache
    const cacheKey = `bt:${lang}:${surahNum}:${range}`;
    const cached = getQuranayaCached(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    // Special handling for Malayalam blockwise - use qurmaltranslation table
    // Exact match: SuraID, ayafrom, ayato
    if (isMalayalam) {
      try {
        // Query qurmaltranslation table with exact match
        const query = `
          SELECT 
            ID,
            SuraID,
            ayafrom,
            ayato,
            TranslationText
          FROM qurmaltranslation
          WHERE SuraID = ? 
            AND ayafrom = ? 
            AND ayato = ?
          LIMIT 1
        `;
        
        const [rows] = await mysqlPool.query(query, [surahNum, fromAyah, toAyah]);

        if (rows && rows.length > 0) {
          const row = rows[0];
          const result = {
            language: lang,
            surah: surahNum,
            range,
            from: fromAyah,
            to: toAyah,
            count: 1,
            TranslationText: row.TranslationText || null,
            pagination: {
              page: page,
              limit: limit,
              total: 1,
              hasMore: false
            }
          };
          setQuranayaCache(cacheKey, result);
          return res.json(result);
        } else {
          const result = {
            language: lang,
            surah: surahNum,
            range,
            from: fromAyah,
            to: toAyah,
            count: 0,
            TranslationText: null
          };
          setQuranayaCache(cacheKey, result);
          return res.json(result);
        }
      } catch (malError) {
        console.error('❌ Error fetching from qurmaltranslation:', malError.message);
        return res.status(500).json({ 
          error: 'Database error', 
          message: `Failed to fetch from qurmaltranslation: ${malError.message}` 
        });
      }
    }

    // Special handling for English blockwise - use qurengtranslation table
    // Exact match: SuraID, ayafrom, ayato
    if (isEnglish) {
      try {
        // Query qurengtranslation table with exact match
        const query = `
          SELECT 
            ID,
            SuraID,
            ayafrom,
            ayato,
            TranslationText
          FROM qurengtranslation
          WHERE SuraID = ? 
            AND ayafrom = ? 
            AND ayato = ?
          LIMIT 1
        `;
        
        const [rows] = await mysqlPool.query(query, [surahNum, fromAyah, toAyah]);

        if (rows && rows.length > 0) {
          const row = rows[0];
          const result = {
            language: lang,
            surah: surahNum,
            range,
            from: fromAyah,
            to: toAyah,
            count: 1,
            TranslationText: row.TranslationText || null,
            pagination: {
              page: page,
              limit: limit,
              total: 1,
              hasMore: false
            }
          };
          setQuranayaCache(cacheKey, result);
          return res.json(result);
        } else {
          const result = {
            language: lang,
            surah: surahNum,
            range,
            from: fromAyah,
            to: toAyah,
            count: 0,
            TranslationText: null
          };
          setQuranayaCache(cacheKey, result);
          return res.json(result);
        }
      } catch (engError) {
        console.error('❌ Error fetching from qurengtranslation:', engError.message);
        return res.status(500).json({ 
          error: 'Database error', 
          message: `Failed to fetch from qurengtranslation: ${engError.message}` 
        });
      }
    }

    // Default behavior for other languages or fallback for Malayalam
    const tableConfig = getTableConfig(lang, 'translation');
    if (!tableConfig) {
      return res.status(400).json({ error: 'Invalid language' });
    }

    const { table, chapter, verse, verseFrom, verseTo, text, isRange } = tableConfig;
    let translations = [];
    let englishInterpretations = [];

    if (isEnglish) {
      englishInterpretations = await fetchEnglishInterpretations(surahNum);
    }

    if (isRange) {
      const query = `SELECT ${text}, ${verseFrom}, ${verseTo} FROM ${table} WHERE ${chapter} = ? AND ${verseFrom} <= ? AND ${verseTo} >= ? ORDER BY ${verseFrom} ASC`;
      const [rows] = await mysqlPool.query(query, [surahNum, toAyah, fromAyah]);
      rows.forEach(row => {
        for (let a = Math.max(row[verseFrom], fromAyah); a <= Math.min(row[verseTo], toAyah); a++) {
          const extracted = extractAyahFromRange(row[text], a, row[verseFrom], row[verseTo]);
          translations.push({
            verse_number: a,
            translation_text: extracted || row[text],
          });
        }
      });
    } else {
      const query = `SELECT ${verse}, ${text} FROM ${table} WHERE ${chapter} = ? AND ${verse} BETWEEN ? AND ? ORDER BY ${verse} ASC`;
      const [rows] = await mysqlPool.query(query, [surahNum, fromAyah, toAyah]);
      translations = rows.map(row => ({
        verse_number: row[verse],
        translation_text: row[text] || ''
      }));
    }

    if (isEnglish && translations.length > 0) {
      translations = attachEnglishInterpretationsToVerses(translations, englishInterpretations);
      
      translations = translations.map(verse => {
        if (!verse.translation_text) {
          return verse;
        }

        const parsed = parseEnglishTranslationFootnotes(
          verse.translation_text,
          surahNum,
          verse.verse_number || verse.number
        );

        return {
          ...verse,
          raw_translation_text: parsed.rawHtml,
          translation_text: parsed.processedHtml || parsed.rawHtml,
          footnote_metadata: {
            structured: parsed.footnotes,
            loose: parsed.looseNumbers,
            total: parsed.footnotes.length + parsed.looseNumbers.length
          }
        };
      });
    }

    res.json({
      language: lang,
      surah: surahNum,
      range,
      from: fromAyah,
      to: toAyah,
      count: translations.length,
      translations
    });
  } catch (error) {
    console.error(`❌ Error fetching blockwise translation:`, error.message);
    res.status(500).json({ error: 'Database error', message: error.message });
  }
};

// Get interpretation/explanation
exports.getInterpretation = async (req, res) => {
  try {
    const { language, surah, ayah } = req.params;
    const { explanationNo } = req.query;
    const lang = language.toLowerCase();

    // Tamil and Urdu use footnotes, not interpretations
    if (['tamil', 'urdu'].includes(lang)) {
      return res.status(404).json({ error: 'Not available', message: `${lang} uses footnote system instead` });
    }

    // English and Malayalam now use specific routes with surah/interpretationNo pattern
    if (['english', 'e', 'malayalam', 'mal'].includes(lang)) {
      return res.status(404).json({ 
        error: 'Use specific endpoint', 
        message: `For ${lang}, use /api/${lang}/interpretation/:surah/:interpretationNo instead` 
      });
    }

    const tableConfig = getTableConfig(lang, 'interpretation');
    if (!tableConfig) {
      return res.status(404).json({ error: 'Interpretation not available', message: `No interpretation table for ${lang}` });
    }

    const { table, chapter, verse, verseFrom, verseTo, text, explanationNo: expNo, interpretationNo, isRange } = tableConfig;
    const surahNum = parseInt(surah);
    const ayahNum = parseInt(ayah);

    let query, params, rows;

    if (isRange) {
      // Range-based (English, Malayalam)
      // For interpretations, return the full text - interpretations are meant for the entire range
      // Unlike translations, interpretations don't need to be extracted by individual ayah
      const interpNoCol = interpretationNo || 'InterpretationNo';
      query = `SELECT ${text}, ${verseFrom}, ${verseTo}, ${interpNoCol} as interp_no FROM ${table} WHERE ${chapter} = ? AND ${verseFrom} <= ? AND ${verseTo} >= ?`;
      params = [surahNum, ayahNum, ayahNum];
      if (explanationNo) {
        query += ` AND ${interpNoCol} = ?`;
        params.push(explanationNo);
      }
      query += ` ORDER BY ${interpNoCol} ASC`;
      const [result] = await mysqlPool.query(query, params);
      rows = result.map(row => ({
        explanation: row[text] || '', // Return full interpretation text, not extracted
        explanation_no_local: row.interp_no || null,
        explanation_no_en: row.interp_no || null
      }));
    } else {
      // Direct query (Bangla, Hindi)
      query = `SELECT ${text}, ${expNo}, explanation_no_EN FROM ${table} WHERE ${chapter} = ? AND ${verse} = ?`;
      params = [surahNum, ayahNum];
      if (explanationNo) {
        query += ` AND ${expNo} = ?`;
        params.push(explanationNo);
      }
      query += ` ORDER BY explanation_no_EN ASC`;
      const [result] = await mysqlPool.query(query, params);
      rows = result.map(row => ({
        explanation: row[text] || '',
        explanation_no_local: row[expNo],
        explanation_no_en: row.explanation_no_EN
      }));
    }

    res.json({ language: lang, surah: surahNum, ayah: ayahNum, count: rows.length, explanations: rows });
  } catch (error) {
    console.error(`❌ Error fetching interpretation:`, error.message);
    res.status(500).json({ error: 'Database error', message: error.message });
  }
};

// Get word-by-word translation
exports.getWordByWord = async (req, res) => {
  try {
    const { language, surah, ayah } = req.params;
    const lang = language.toLowerCase();
    const tableConfig = getTableConfig(lang, 'wordByWord');

    if (!tableConfig) {
      return res.status(404).json({ error: 'Word-by-word not available', message: `No word-by-word table for ${lang}` });
    }

    const { table, chapter, verse } = tableConfig;
    const query = `SELECT * FROM ${table} WHERE ${chapter} = ? AND ${verse} = ? ORDER BY WordId ASC`;
    const [rows] = await mysqlPool.query(query, [parseInt(surah), parseInt(ayah)]);

    // Deduplicate by WordId to handle duplicate records in database
    const seen = new Set();
    const uniqueWords = rows.filter(word => {
      if (seen.has(word.WordId)) {
        return false;
      }
      seen.add(word.WordId);
      return true;
    });

    res.json({ language: lang, surah: parseInt(surah), ayah: parseInt(ayah), count: uniqueWords.length, words: uniqueWords });
  } catch (error) {
    console.error(`❌ Error fetching word-by-word:`, error.message);
    res.status(500).json({ error: 'Database error', message: error.message });
  }
};

// Get ayah ranges for blockwise reading
exports.getAyaRanges = async (req, res) => {
  try {
    const { language, surah } = req.params;
    const lang = language.toLowerCase();

    const rangeTables = {
      english: { table: 'engayarange', id: 'AyaRangeId', surah: 'SuraId', range: 'AyaRange' },
      e: { table: 'engayarange', id: 'AyaRangeId', surah: 'SuraId', range: 'AyaRange' },
      malayalam: { table: 'malayarange', id: 'AyaRangeId', surah: 'SuraId', range: 'AyaRange' },
      mal: { table: 'malayarange', id: 'AyaRangeId', surah: 'SuraId', range: 'AyaRange' }
    };

    const rangeConfig = rangeTables[lang];
    if (!rangeConfig) {
      return res.status(404).json({ error: 'Block ranges not available', message: `Block ranges not configured for ${lang}` });
    }

    // Check in-memory cache
    const cacheKey = `ar:${lang}:${surah}`;
    const cached = getQuranayaCached(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const query = `SELECT ${rangeConfig.id} as id, ${rangeConfig.surah} as surah, ${rangeConfig.range} as range_value FROM ${rangeConfig.table} WHERE ${rangeConfig.surah} = ? ORDER BY ${rangeConfig.id} ASC`;
    const [rows] = await mysqlPool.query(query, [parseInt(surah)]);

    const formatted = rows.map(row => {
      const [fromStr, toStr] = String(row.range_value).split('-').map(s => s.trim());
      return {
        ID: row.id,
        SuraId: row.surah,
        AyaFrom: parseInt(fromStr) || null,
        AyaTo: parseInt(toStr) || null,
        Range: row.range_value
      };
    });

    setQuranayaCache(cacheKey, formatted);
    res.json(formatted);
  } catch (error) {
    console.error(`❌ Error fetching ayah ranges:`, error.message);
    
    // Check for connection timeout errors
    if (error.code === 'ETIMEDOUT' || error.code === 'ECONNREFUSED' || error.message.includes('ETIMEDOUT') || error.message.includes('ECONNREFUSED')) {
      return res.status(503).json({ 
        error: 'Database connection timeout', 
        message: 'Unable to connect to database. Please check if the database server is running.',
        code: error.code
      });
    }
    
    res.status(500).json({ error: 'Database error', message: error.message });
  }
};

// Get Arabic text
exports.getArabicText = async (req, res) => {
  try {
    const { surah, ayah } = req.params;
    const query = `SELECT AyaHText, AyaNText FROM quranayas WHERE suraid = ? AND ayaid = ? LIMIT 1`;
    const [rows] = await mysqlPool.query(query, [parseInt(surah), parseInt(ayah)]);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Arabic text not found', message: `No Arabic text found for Surah ${surah}, Ayah ${ayah}` });
    }

    res.json({
      language: 'arabic',
      surah: parseInt(surah),
      ayah: parseInt(ayah),
      text_uthmani: rows[0].AyaHText || '',
      text_simple: rows[0].AyaNText || ''
    });
  } catch (error) {
    console.error(`❌ Error fetching Arabic text:`, error.message);
    res.status(500).json({ error: 'Database error', message: error.message });
  }
};

// Urdu footnotes
exports.getUrduFootnote = async (req, res) => {
  try {
    const { footnoteId } = req.params;
    const query = `SELECT footnote_text FROM urdu_footnotes WHERE id = ? LIMIT 1`;
    const [rows] = await mysqlPool.query(query, [parseInt(footnoteId)]);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Footnote not found', message: `No footnote found with ID: ${footnoteId}` });
    }

    res.json({ footnote_id: parseInt(footnoteId), footnote_text: rows[0].footnote_text || '' });
  } catch (error) {
    console.error(`❌ Error fetching Urdu footnote:`, error.message);
    res.status(500).json({ error: 'Database error', message: error.message });
  }
};

exports.getEnglishFootnote = async (req, res) => {
  try {
    const { footnoteId } = req.params;
    const query = `SELECT footnote_text FROM thafheem_thafnewdb.eng_footnotes WHERE id = ? LIMIT 1`;
    const [rows] = await mysqlPool.query(query, [parseInt(footnoteId)]);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Footnote not found', message: `No footnote found with ID: ${footnoteId}` });
    }

    res.json({ footnote_id: parseInt(footnoteId), footnote_text: rows[0].footnote_text || '' });
  } catch (error) {
    console.error(`❌ Error fetching English footnote:`, error.message);
    res.status(500).json({ error: 'Database error', message: error.message });
  }
};

// Get English finality of prophethood footnote by ID
exports.getEnglishFinalityFootnote = async (req, res) => {
  try {
    const { footnoteId } = req.params;
    
    // Validate footnoteId
    const id = parseInt(footnoteId, 10);
    if (isNaN(id) || id <= 0) {
      return res.status(400).json({ 
        error: 'Invalid footnote ID', 
        message: 'Footnote ID must be a positive integer' 
      });
    }

    const query = `SELECT footnote_id, footnote_text FROM thafheem_thafnewdb.engparisamapthi_footnotes WHERE footnote_id = ? LIMIT 1`;
    const [rows] = await mysqlPool.query(query, [id]);

    if (rows.length === 0) {
      return res.status(404).json({ 
        error: 'Footnote not found', 
        message: `No footnote found with ID: ${footnoteId}` 
      });
    }

    res.json({ 
      footnote_id: rows[0].footnote_id, 
      footnote_text: rows[0].footnote_text || '' 
    });
  } catch (error) {
    console.error(`❌ Error fetching English finality of prophethood footnote:`, error.message);
    res.status(500).json({ 
      error: 'Database error', 
      message: error.message 
    });
  }
};

// Get Urdu finality of prophethood footnote by ID
exports.getUrduFinalityFootnote = async (req, res) => {
  const { footnoteId } = req.params;
  
  try {
    // Validate footnoteId
    const id = parseInt(footnoteId, 10);
    if (isNaN(id) || id <= 0) {
      return res.status(400).json({ 
        error: 'Invalid footnote ID', 
        message: 'Footnote ID must be a positive integer' 
      });
    }

    // Table structure: id, footnote (not footnote_text!)
    // Use the exact table name: thafheem_thafnewdb.urdu_parisamapthi_footnotes
    const query = `SELECT id, footnote FROM thafheem_thafnewdb.urdu_parisamapthi_footnotes WHERE id = ? LIMIT 1`;
    const [rows] = await mysqlPool.query(query, [id]);

    if (rows.length === 0) {
      return res.status(404).json({ 
        error: 'Footnote not found', 
        message: `No footnote found with ID: ${footnoteId}` 
      });
    }

    res.json({ 
      footnote_id: rows[0].id, 
      footnote_text: rows[0].footnote || '' 
    });
  } catch (error) {
    console.error(`❌ Error fetching Urdu finality of prophethood footnote:`, error.message);
    console.error(`❌ Full error details:`, error);
    console.error(`❌ Attempted query: SELECT id, footnote FROM thafheem_thafnewdb.urdu_parisamapthi_footnotes WHERE id = ${footnoteId}`);
    res.status(500).json({ 
      error: 'Database error', 
      message: error.message 
    });
  }
};

// Helper endpoint to check eng_footnotes table count and structure
exports.checkEnglishFootnotesCount = async (req, res) => {
  try {
    // Get total count
    const [countRows] = await mysqlPool.query(`SELECT COUNT(*) as total FROM thafheem_thafnewdb.eng_footnotes`);
    const total = countRows[0]?.total || 0;

    // Get sample structure (first 3 rows)
    const [sampleRows] = await mysqlPool.query(`
      SELECT * FROM thafheem_thafnewdb.eng_footnotes 
      LIMIT 3
    `);

    // Get column names
    const [columns] = await mysqlPool.query(`
      SELECT COLUMN_NAME, DATA_TYPE 
      FROM information_schema.COLUMNS 
      WHERE TABLE_SCHEMA = 'thafheem_thafnewdb' 
      AND TABLE_NAME = 'eng_footnotes'
      ORDER BY ORDINAL_POSITION
    `);

    res.json({
      table: 'thafheem_thafnewdb.eng_footnotes',
      total_records: total,
      columns: columns.map(col => ({ name: col.COLUMN_NAME, type: col.DATA_TYPE })),
      sample_data: sampleRows
    });
  } catch (error) {
    console.error(`❌ Error checking eng_footnotes:`, error.message);
    res.status(500).json({ error: 'Database error', message: error.message });
  }
};

exports.getEnglishInterpretationById = async (req, res) => {
  try {
    const { interpretationId } = req.params;
    const query = `SELECT ID, SuraId, ayafrom, ayato, InterpretationNo, Interpretation FROM enginterpretation WHERE ID = ? LIMIT 1`;
    const [rows] = await mysqlPool.query(query, [parseInt(interpretationId, 10)]);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Interpretation not found', message: `No interpretation found with ID: ${interpretationId}` });
    }

    const row = rows[0];
    res.json({
      id: row.ID,
      surah: row.SuraId,
      fromAyah: normalizeAyahNumber(row.ayafrom, 1),
      toAyah: normalizeAyahNumber(row.ayato, normalizeAyahNumber(row.ayafrom, 1)),
      interpretationNumber: row.InterpretationNo,
      interpretation_text: row.Interpretation || ''
    });
  } catch (error) {
    console.error(`❌ Error fetching English interpretation by ID:`, error.message);
    res.status(500).json({ error: 'Database error', message: error.message });
  }
};

// Get all English interpretations for a specific surah and ayah (fetch all from database, no regex parsing)
exports.getAllEnglishInterpretations = async (req, res) => {
  try {
    const { surah, ayah } = req.params;
    const surahNum = parseInt(surah);
    const ayahNum = parseInt(ayah);

    if (isNaN(surahNum) || isNaN(ayahNum)) {
      return res.status(400).json({ error: 'Invalid parameters', message: 'Surah and ayah must be valid numbers' });
    }

    // Query all interpretations that cover this ayah (range-based matching)
    // This matches the old API pattern: get all interpretations for the range containing this ayah
    const query = `
      SELECT 
        ID,
        SuraId AS SuraID,
        InterpretationNo,
        Interpretation,
        ayafrom,
        ayato
      FROM enginterpretation
      WHERE SuraId = ?
        AND ayafrom <= ?
        AND ayato >= ?
      ORDER BY CAST(InterpretationNo AS UNSIGNED) ASC
    `;
    
    const [rows] = await mysqlPool.query(query, [surahNum, ayahNum, ayahNum]);

    if (rows.length === 0) {
      return res.json({
        language: 'english',
        surah: surahNum,
        ayah: ayahNum,
        count: 0,
        interpretations: []
      });
    }

    // Format response similar to old API structure
    const interpretations = rows.map(row => ({
      ID: String(row.ID),
      SuraID: String(row.SuraID),
      InterpretationNo: String(row.InterpretationNo),
      Interpretation: row.Interpretation || ''
    }));

    res.json({
      language: 'english',
      surah: surahNum,
      ayah: ayahNum,
      count: interpretations.length,
      interpretations
    });
  } catch (error) {
    console.error(`❌ Error fetching all English interpretations:`, error.message);
    res.status(500).json({ error: 'Database error', message: error.message });
  }
};

// Get English interpretation by SuraId and InterpretationNo (simple direct query)
exports.getEnglishInterpretationBySurahAndNo = async (req, res) => {
  try {
    const { surah, interpretationNo } = req.params;
    const surahNum = parseInt(surah);
    const interpretationNoStr = String(interpretationNo).trim();

    if (isNaN(surahNum)) {
      return res.status(400).json({ error: 'Invalid parameter', message: 'Surah must be a valid number' });
    }

    if (!interpretationNoStr) {
      return res.status(400).json({ error: 'Invalid parameter', message: 'InterpretationNo is required' });
    }

    // Direct query by SuraId and InterpretationNo
    const query = `
      SELECT 
        ID,
        SuraId,
        InterpretationNo,
        Interpretation,
        ayafrom,
        ayato
      FROM enginterpretation
      WHERE SuraId = ? AND InterpretationNo = ?
      LIMIT 1
    `;
    
    const [rows] = await mysqlPool.query(query, [surahNum, interpretationNoStr]);

    if (rows.length === 0) {
      return res.status(404).json({ 
        error: 'Interpretation not found', 
        message: `No interpretation found for Surah ${surahNum} with InterpretationNo ${interpretationNoStr}` 
      });
    }

    const row = rows[0];
    res.json({
      id: row.ID,
      surah: row.SuraId,
      interpretationNo: row.InterpretationNo,
      interpretation: row.Interpretation || '',
      fromAyah: row.ayafrom,
      toAyah: row.ayato
    });
  } catch (error) {
    console.error(`❌ Error fetching English interpretation:`, error.message);
    res.status(500).json({ error: 'Database error', message: error.message });
  }
};

// Get Malayalam interpretation by SuraID and InterpretationNo (simple direct query)
exports.getMalayalamInterpretationBySurahAndNo = async (req, res) => {
  try {
    const { surah, interpretationNo } = req.params;
    const surahNum = parseInt(surah);
    const interpretationNoStr = String(interpretationNo).trim();

    if (isNaN(surahNum)) {
      return res.status(400).json({ error: 'Invalid parameter', message: 'Surah must be a valid number' });
    }

    if (!interpretationNoStr) {
      return res.status(400).json({ error: 'Invalid parameter', message: 'InterpretationNo is required' });
    }

    // Direct query by SuraID and InterpretationNo
    const query = `
      SELECT 
        ID,
        SuraID,
        InterpretationNo,
        Interpretation,
        AyaFrom,
        AyaTo
      FROM malinterpretation
      WHERE SuraID = ? AND InterpretationNo = ?
      LIMIT 1
    `;
    
    const [rows] = await mysqlPool.query(query, [surahNum, interpretationNoStr]);

    if (rows.length === 0) {
      return res.status(404).json({ 
        error: 'Interpretation not found', 
        message: `No interpretation found for Surah ${surahNum} with InterpretationNo ${interpretationNoStr}` 
      });
    }

    const row = rows[0];
    res.json({
      id: row.ID,
      surah: row.SuraID,
      interpretationNo: row.InterpretationNo,
      interpretation: row.Interpretation || '',
      fromAyah: row.AyaFrom,
      toAyah: row.AyaTo
    });
  } catch (error) {
    console.error(`❌ Error fetching Malayalam interpretation:`, error.message);
    res.status(500).json({ error: 'Database error', message: error.message });
  }
};

// Get all interpretations for a surah that cover a specific ayah number
// Used by the frontend to discover which InterpretationNo values exist for a block
exports.getMalayalamInterpretationsByAyah = async (req, res) => {
  try {
    const { surah, ayah } = req.params;
    const surahNum = parseInt(surah);
    const ayahNum = parseInt(ayah);

    if (isNaN(surahNum) || isNaN(ayahNum)) {
      return res.status(400).json({ error: 'Invalid parameters', message: 'Surah and ayah must be valid numbers' });
    }

    const [rows] = await mysqlPool.query(
      `SELECT InterpretationNo, Interpretation, AyaFrom, AyaTo
       FROM malinterpretation
       WHERE SuraID = ? AND AyaFrom <= ? AND AyaTo >= ?
       ORDER BY InterpretationNo`,
      [surahNum, ayahNum, ayahNum]
    );

    res.json({
      surah: surahNum,
      ayah: ayahNum,
      interpretations: rows.map(row => ({
        interpretationNo: row.InterpretationNo,
        interpretation: row.Interpretation || '',
        fromAyah: row.AyaFrom,
        toAyah: row.AyaTo
      }))
    });
  } catch (error) {
    console.error('❌ Error fetching Malayalam interpretations by ayah:', error.message);
    res.status(500).json({ error: 'Database error', message: error.message });
  }
};

// Malayalam footnotes
exports.getMalayalamFootnote = async (req, res) => {
  try {
    const { footnoteId } = req.params;
    const query = `SELECT footnote_text FROM malparisamapthi_footnotes WHERE footnote_id = ? LIMIT 1`;
    const [rows] = await mysqlPool.query(query, [parseInt(footnoteId)]);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Footnote not found', message: `No footnote found with ID: ${footnoteId}` });
    }

    res.json({ footnote_id: parseInt(footnoteId), footnote_text: rows[0].footnote_text || '' });
  } catch (error) {
    console.error(`❌ Error fetching Malayalam footnote:`, error.message);
    res.status(500).json({ error: 'Database error', message: error.message });
  }
};

const toPositiveInt = (value) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const formatQuranayaRow = (row = {}) => ({
  contiayano: toPositiveInt(row.contiayano) ?? toPositiveInt(row.ayaid),
  suraid: toPositiveInt(row.suraid),
  ayaid: toPositiveInt(row.ayaid),
  AyaHText: row.AyaHText || '',
  AyaNText: row.AyaNText || '',
  AudioText: row.AudioText || '',
  AudioIntrerptn: row.AudioIntrerptn || '',
  pageid: toPositiveInt(row.pageid),
  QAudioUrl: row.QAudioUrl || '',
  TransUrl: row.TransUrl || '',
  InterPtnUrl: row.InterPtnUrl || '',
  ASuraName: row.ASuraName ? row.ASuraName.trim() : ''
});

exports.getMalayalamQuranAya = async (req, res) => {
  try {
    const { language, surah, ayah } = req.params;
    const lang = String(language || '').toLowerCase();

    if (!MALAYALAM_LANGUAGE_CODES.has(lang)) {
      return res.status(400).json({
        error: 'Invalid language',
        message: 'Quranaya endpoint is only available for Malayalam'
      });
    }

    const surahNum = parseInt(surah, 10);
    const ayahNum = ayah !== undefined ? parseInt(ayah, 10) : null;

    if (!Number.isFinite(surahNum) || surahNum < 1 || surahNum > 114) {
      return res.status(400).json({ error: 'Invalid surah', message: 'Surah must be between 1 and 114' });
    }

    if (ayah !== undefined && (!Number.isFinite(ayahNum) || ayahNum < 1)) {
      return res.status(400).json({ error: 'Invalid ayah', message: 'Ayah must be a positive number' });
    }

    // Pagination support (optional — if not provided, return all rows for backward compatibility)
    const pageParam = req.query.page !== undefined ? parseInt(req.query.page, 10) : null;
    const limitParam = req.query.limit !== undefined ? parseInt(req.query.limit, 10) : null;
    const hasPagination = pageParam !== null && limitParam !== null;
    const page = hasPagination && Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1;
    const limit = hasPagination && Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 200) : null;

    // Check in-memory cache first
    const cacheKey = ayahNum !== null
      ? `qa:${surahNum}:${ayahNum}`
      : hasPagination
        ? `qa:${surahNum}:p${page}:l${limit}`
        : `qa:${surahNum}:all`;
    const cached = getQuranayaCached(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const conditions = ['suraid = ?'];
    const params = [surahNum];

    if (ayahNum !== null) {
      conditions.push('ayaid = ?');
      params.push(ayahNum);
    }

    // Fetch surah name once separately (avoids repeated JOIN per row)
    const [[suraRow]] = await mysqlPool.query('SELECT ASuraName FROM suratable WHERE SuraId = ? LIMIT 1', [surahNum]);
    const suraName = suraRow?.ASuraName?.trim() || '';

    const whereClause = conditions.join(' AND ');

    if (hasPagination && ayahNum === null) {
      // Paginated response
      const [[countRow]] = await mysqlPool.query(`SELECT COUNT(*) as total FROM quranayas WHERE ${whereClause}`, params);
      const totalItems = countRow?.total || 0;

      const offset = (page - 1) * limit;
      const query = `
        SELECT contiayano, suraid, ayaid, AyaHText, AyaNText, AudioText, AudioIntrerptn, pageid, QAudioUrl, TransUrl, InterPtnUrl
        FROM quranayas
        WHERE ${whereClause}
        ORDER BY ayaid ASC
        LIMIT ? OFFSET ?
      `;

      const [rows] = await mysqlPool.query(query, [...params, limit, offset]);
      rows.forEach(row => { row.ASuraName = suraName; });

      if (!rows || rows.length === 0) {
        // Out-of-range page: return empty paginated response (200) instead of 404
        // so the frontend pagination logic can handle it gracefully.
        const pagination = buildPaginationMeta(page, limit, totalItems, null, null);
        const result = { translations: [], pagination };
        return res.json(result);
      }

      const formatted = rows.map(formatQuranayaRow);
      const fromAyah = formatted[0]?.ayaid || offset + 1;
      const toAyah = formatted[formatted.length - 1]?.ayaid || offset + formatted.length;
      const pagination = buildPaginationMeta(page, limit, totalItems, fromAyah, toAyah);

      const result = { translations: formatted, pagination };
      setQuranayaCache(cacheKey, result);
      return res.json(result);
    }

    // Non-paginated response (backward compatible)
    const query = `
      SELECT contiayano, suraid, ayaid, AyaHText, AyaNText, AudioText, AudioIntrerptn, pageid, QAudioUrl, TransUrl, InterPtnUrl
      FROM quranayas
      WHERE ${whereClause}
      ORDER BY ayaid ASC
    `;

    const [rows] = await mysqlPool.query(query, params);

    // Attach surah name to each row
    rows.forEach(row => { row.ASuraName = suraName; });

    if (!rows || rows.length === 0) {
      return res.status(404).json({
        error: 'Not found',
        message: ayahNum
          ? `No data found for Surah ${surahNum}, Ayah ${ayahNum}`
          : `No data found for Surah ${surahNum}`
      });
    }

    const formatted = rows.map(formatQuranayaRow);
    setQuranayaCache(cacheKey, formatted);
    res.json(formatted);
  } catch (error) {
    console.error('❌ Error fetching Malayalam quranaya data:', error.message);
    
    // Check for connection timeout errors
    if (error.code === 'ETIMEDOUT' || error.code === 'ECONNREFUSED' || error.message.includes('ETIMEDOUT') || error.message.includes('ECONNREFUSED')) {
      return res.status(503).json({ 
        error: 'Database connection timeout', 
        message: 'Unable to connect to database. Please check if the database server is running.',
        code: error.code
      });
    }
    
    res.status(500).json({ error: 'Database error', message: error.message });
  }
};

// Get chapter info (detailed) from MySQL
exports.getChapterInfo = async (req, res) => {
  try {
    const { surah, language } = req.params;
    const result = await chapterService.getChapterInfo(surah, language);
    res.json(result);
  } catch (error) {
    console.error(`❌ Error fetching chapter info:`, error.message);
    
    if (error.message.includes('must be between')) {
      return res.status(400).json({ 
        error: 'Invalid surah', 
        message: error.message 
      });
    }
    
    if (error.message.includes('not available')) {
      return res.status(404).json({ 
        error: 'Not found', 
        message: error.message 
      });
    }
    
    res.status(500).json({ error: 'Database error', message: error.message });
  }
};

// Get Malayalam surah intro for blockwise (status=0 rows from preface table - with Arabic script)
exports.getMalayalamSurahIntro = async (req, res) => {
  try {
    const surahNum = parseInt(req.params.surah, 10);

    if (!Number.isFinite(surahNum) || surahNum < 1 || surahNum > 114) {
      return res.status(400).json({
        error: 'Invalid surah',
        message: 'Surah must be between 1 and 114'
      });
    }

    const query = `
      SELECT ID, SuraId, PrefaceSubTitle, PrefaceText
      FROM preface
      WHERE SuraId = ? AND status = 0
      ORDER BY ID ASC
    `;

    const [rows] = await mysqlPool.query(query, [surahNum]);

    if (!rows || rows.length === 0) {
      return res.status(404).json({
        error: 'Not found',
        message: `No Malayalam surah intro found for Surah ${surahNum}`
      });
    }

    const sections = rows.map(row => ({
      subtitle: row.PrefaceSubTitle || null,
      text: row.PrefaceText || ''
    }));

    return res.json({
      surah: surahNum,
      sections
    });
  } catch (error) {
    console.error('❌ Error fetching Malayalam surah intro:', error.message);
    res.status(500).json({
      error: 'Database error',
      message: error.message
    });
  }
};

// Get preface (Thafheem preface) for a surah - returns array format for frontend compatibility
exports.getPreface = async (req, res) => {
  try {
    const { surah, language } = req.params;
    const surahNum = parseInt(surah, 10);
    
    if (Number.isNaN(surahNum) || surahNum < 1 || surahNum > 114) {
      return res.status(400).json({ 
        error: 'Invalid surah', 
        message: 'Surah must be between 1 and 114' 
      });
    }

    // Normalize language code (M, E, malayalam, english, mal, en)
    const lang = (language || 'E').toUpperCase();
    const languageMap = {
      'M': 'M',
      'E': 'E',
      'MALAYALAM': 'M',
      'ENGLISH': 'E',
      'MAL': 'M',
      'EN': 'E'
    };
    const dbLangCode = languageMap[lang] || 'E';

    let tableName;
    if (dbLangCode === 'M') {
      tableName = 'preface';
    } else {
      tableName = 'engpreface';
    }

    // Query the preface table to get all sections
    const query = `
      SELECT 
        ID,
        SuraId,
        PrefaceSubTitle,
        PrefaceText
      FROM ${tableName}
      WHERE SuraId = ? ${dbLangCode === 'M' ? 'AND status = 1' : ''}
      ORDER BY ID ASC
    `;

    const [rows] = await mysqlPool.query(query, [surahNum]);

    if (!rows || rows.length === 0) {
      return res.status(404).json({ 
        error: 'Not found', 
        message: `No preface found for surah ${surahNum} in language ${dbLangCode}` 
      });
    }

    // Return array format that frontend expects
    const prefaceData = rows.map(row => ({
      ID: row.ID,
      SuraId: row.SuraId,
      PrefaceSubTitle: row.PrefaceSubTitle || null,
      PrefaceText: row.PrefaceText || null
    }));

    res.json(prefaceData);

  } catch (error) {
    console.error(`❌ Error fetching preface:`, error.message);
    
    if (error.code === 'ER_NO_SUCH_TABLE') {
      return res.status(404).json({ 
        error: 'Table not found', 
        message: `Preface table does not exist in database` 
      });
    }
    
    if (error.message.includes('must be between')) {
      return res.status(400).json({ 
        error: 'Invalid surah', 
        message: error.message 
      });
    }
    
    res.status(500).json({ error: 'Database error', message: error.message });
  }
};

// Health check
exports.checkLanguageHealth = async (req, res) => {
  try {
    const { language } = req.params;
    const lang = language.toLowerCase();
    
    if (!SUPPORTED_LANGUAGES.includes(lang)) {
      return res.status(400).json({ language, status: 'error', message: 'Invalid language' });
    }

    await mysqlPool.query('SELECT 1 as test');
    res.json({ language: lang, status: 'ok', message: `${lang} database is connected and working` });
  } catch (error) {
    res.status(500).json({ language, status: 'error', message: error.message });
  }
};

// Get Tajweed rules
exports.getTajweedRules = async (req, res) => {
  try {
    const { ruleNo } = req.params;
    
    // Handle rule number - if ruleNo contains dots, keep them for sub-rule queries
    // If ruleNo is '0', get all main rules, otherwise get specific rule or sub-rules
    const ruleNoStr = ruleNo ? ruleNo.toString() : '0';
    
    let query;
    let params;
    
    if (ruleNoStr === '0') {
      // Get all main rules (RuleNo 0-11, excluding sub-rules)
      // Main rules are those without decimal points
      query = `SELECT id, RuleNo, Rule, Ruledesc, Hassub, Examples 
               FROM ${TAJWEED_TABLE} 
               WHERE RuleNo NOT LIKE '%.%'
               ORDER BY CAST(RuleNo AS UNSIGNED) ASC`;
      params = [];
    } else {
      // Get specific rule or sub-rules
      // If ruleNo is '1', get rule '1' and all sub-rules like '1.1', '1.2', etc.
      // If ruleNo is '1_1' (from frontend), convert to '1.1' for database query
      const dbRuleNo = ruleNoStr.replace(/_/g, '.');
      
      query = `SELECT id, RuleNo, Rule, Ruledesc, Hassub, Examples 
               FROM ${TAJWEED_TABLE} 
               WHERE RuleNo = ? OR RuleNo LIKE ?
               ORDER BY CAST(RuleNo AS DECIMAL(10,2)) ASC`;
      params = [dbRuleNo, `${dbRuleNo}.%`];
    }
    
    const [rows] = await mysqlPool.query(query, params);
    
    if (rows.length === 0) {
      return res.status(404).json({ 
        error: 'Not Found', 
        message: `Tajweed rule ${ruleNo} not found` 
      });
    }
    
    // Add AudioUrl as null for frontend compatibility (column doesn't exist in table)
    const rowsWithAudioUrl = rows.map(row => ({
      ...row,
      AudioUrl: null
    }));
    
    // Return array format expected by frontend
    res.json(rowsWithAudioUrl);
  } catch (error) {
    console.error(`❌ Error fetching tajweed rules:`, error.message);
    console.error(`📋 Table name used: ${TAJWEED_TABLE}`);
    console.error(`🔍 Error code: ${error.code}`);
    console.error(`📝 Full error:`, error);
    
    // If table doesn't exist, return 404 with detailed info
    if (error.message.includes("doesn't exist") || error.code === 'ER_NO_SUCH_TABLE' || error.message.includes('Table') && error.message.includes("doesn't exist")) {
      return res.status(404).json({ 
        error: 'Not Found', 
        message: `Tajweed rules table '${TAJWEED_TABLE}' not found in database`,
        details: error.message,
        tableName: TAJWEED_TABLE
      });
    }
    
    res.status(500).json({ 
      error: 'Database error', 
      message: error.message,
      tableName: TAJWEED_TABLE,
      errorCode: error.code
    });
  }
};

// Get Tajweed glyph words (QCF V4 page-specific fonts) — supports three modes:
//   GET /api/tajweed/:suraid/:ayaid          → single ayah { suraid, ayaid, words: [...] }
//   GET /api/tajweed/:suraid?from=N&to=M     → ayah range  { suraid, from, to, ayahs: { N: [...], ... } }
//   GET /api/tajweed/:suraid                 → full surah  { suraid, ayahs: { 1: [...], ... } }
// Each word: { word_pos, word_text, code_v2, v2_page }
//   - code_v2 : the QCF V4 glyph character to render
//   - v2_page : Mushaf page (1-604) whose font renders code_v2 with embedded tajweed colors
exports.getTajweedWords = async (req, res) => {
  const { suraid, ayaid } = req.params;
  const s = parseInt(suraid, 10);

  if (isNaN(s) || s < 1 || s > 114) {
    return res.status(400).json({ error: 'Invalid surah number' });
  }

  try {
    // ── Mode 1: single ayah ──────────────────────────────────────────────────
    if (ayaid !== undefined) {
      const a = parseInt(ayaid, 10);
      if (isNaN(a) || a < 1) {
        return res.status(400).json({ error: 'Invalid ayah number' });
      }
      const [rows] = await mysqlPool.query(
        `SELECT word_pos, text_uthmani AS word_text, code_v2, v2_page
         FROM tajweed_glyphs
         WHERE surah_id = ? AND ayah_id = ? AND char_type = 'word'
         ORDER BY word_pos ASC`,
        [s, a]
      );
      if (rows.length === 0) {
        return res.status(404).json({ error: 'Tajweed data not found for this ayah' });
      }
      return res.json({ suraid: s, ayaid: a, words: rows });
    }

    // ── Mode 2: ayah range (?from=N&to=M) ───────────────────────────────────
    const fromQ = req.query.from ? parseInt(req.query.from, 10) : null;
    const toQ   = req.query.to   ? parseInt(req.query.to,   10) : null;

    if (fromQ !== null && toQ !== null) {
      if (isNaN(fromQ) || isNaN(toQ) || fromQ < 1 || toQ < fromQ || (toQ - fromQ) > 50) {
        return res.status(400).json({ error: 'Invalid range. from/to must be valid ayah numbers and range ≤ 50.' });
      }
      const [rows] = await mysqlPool.query(
        `SELECT ayah_id, word_pos, text_uthmani AS word_text, code_v2, v2_page
         FROM tajweed_glyphs
         WHERE surah_id = ? AND ayah_id BETWEEN ? AND ? AND char_type = 'word'
         ORDER BY ayah_id ASC, word_pos ASC`,
        [s, fromQ, toQ]
      );
      if (rows.length === 0) {
        return res.status(404).json({ error: 'Tajweed data not found for this range' });
      }
      const ayahs = {};
      for (const row of rows) {
        if (!ayahs[row.ayah_id]) ayahs[row.ayah_id] = [];
        ayahs[row.ayah_id].push({ word_pos: row.word_pos, word_text: row.word_text, code_v2: row.code_v2, v2_page: row.v2_page });
      }
      return res.json({ suraid: s, from: fromQ, to: toQ, ayahs });
    }

    // ── Mode 3: full surah ───────────────────────────────────────────────────
    const [rows] = await mysqlPool.query(
      `SELECT ayah_id, word_pos, text_uthmani AS word_text, code_v2, v2_page
       FROM tajweed_glyphs
       WHERE surah_id = ? AND char_type = 'word'
       ORDER BY ayah_id ASC, word_pos ASC`,
      [s]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Tajweed data not found for this surah' });
    }
    const ayahs = {};
    for (const row of rows) {
      if (!ayahs[row.ayah_id]) ayahs[row.ayah_id] = [];
      ayahs[row.ayah_id].push({ word_pos: row.word_pos, word_text: row.word_text, code_v2: row.code_v2, v2_page: row.v2_page });
    }
    return res.json({ suraid: s, ayahs });

  } catch (error) {
    console.error('❌ Error fetching tajweed words:', error.message);
    res.status(500).json({ error: 'Database error', message: error.message });
  }
};

// Get Tajweed glyphs grouped into Mushaf lines (QCF V4) — for true printed-Mushaf
// page layout where each line is rendered as its own centered row.
//   GET /api/tajweed/lines/:suraid?from=N&to=M  → { suraid, from, to, lines: [...] }
// Each line: { key, line_number, v2_page, words: [{ word_pos, char_type, ayah_id,
//   word_text, code_v2, v2_page }] }  (includes char_type='end' ayah-number glyphs)
// Glyphs are ordered by the table's global `id` (= correct Mushaf reading order,
// which can interleave words from two ayahs on the same line) then grouped by
// (v2_page, line_number).
exports.getTajweedLines = async (req, res) => {
  const { suraid } = req.params;
  const s = parseInt(suraid, 10);

  if (isNaN(s) || s < 1 || s > 114) {
    return res.status(400).json({ error: 'Invalid surah number' });
  }

  const fromQ = req.query.from ? parseInt(req.query.from, 10) : null;
  const toQ   = req.query.to   ? parseInt(req.query.to,   10) : null;

  try {
    let rows;
    if (fromQ !== null && toQ !== null) {
      if (isNaN(fromQ) || isNaN(toQ) || fromQ < 1 || toQ < fromQ || (toQ - fromQ) > 300) {
        return res.status(400).json({ error: 'Invalid range. from/to must be valid ayah numbers and range ≤ 300.' });
      }
      [rows] = await mysqlPool.query(
        `SELECT id, surah_id, ayah_id, word_pos, char_type,
                text_uthmani AS word_text, code_v2, v2_page, line_number
         FROM tajweed_glyphs
         WHERE surah_id = ? AND ayah_id BETWEEN ? AND ?
         ORDER BY id ASC`,
        [s, fromQ, toQ]
      );
    } else {
      [rows] = await mysqlPool.query(
        `SELECT id, surah_id, ayah_id, word_pos, char_type,
                text_uthmani AS word_text, code_v2, v2_page, line_number
         FROM tajweed_glyphs
         WHERE surah_id = ?
         ORDER BY id ASC`,
        [s]
      );
    }

    if (!rows || rows.length === 0) {
      return res.status(404).json({ error: 'Tajweed data not found' });
    }

    const lineMap = new Map();
    for (const row of rows) {
      const key = `${row.v2_page}_${row.line_number}`;
      if (!lineMap.has(key)) {
        lineMap.set(key, { key, line_number: row.line_number, v2_page: row.v2_page, words: [] });
      }
      lineMap.get(key).words.push({
        word_pos: row.word_pos,
        char_type: row.char_type,
        ayah_id: row.ayah_id,
        word_text: row.word_text,
        code_v2: row.code_v2,
        v2_page: row.v2_page,
      });
    }

    const lines = Array.from(lineMap.values());
    return res.json({ suraid: s, from: fromQ, to: toQ, lines });

  } catch (error) {
    console.error('❌ Error fetching tajweed lines:', error.message);
    res.status(500).json({ error: 'Database error', message: error.message });
  }
};

// Get Urdu translation audio
exports.getUrduTranslationAudio = async (req, res) => {
  try {
    const { surah, ayah } = req.params;
    const surahNum = parseInt(surah, 10);
    const ayahNum = ayah !== undefined ? parseInt(ayah, 10) : null;

    if (!Number.isFinite(surahNum) || surahNum < 1 || surahNum > 114) {
      return res.status(400).json({ error: 'Invalid surah', message: 'Surah must be between 1 and 114' });
    }

    if (ayahNum !== null && (!Number.isFinite(ayahNum) || ayahNum < 1)) {
      return res.status(400).json({ error: 'Invalid ayah', message: 'Ayah must be a positive number' });
    }

    // Query with common column name patterns
    // Based on Urdu translation table pattern: chapter_number, verse_number
    // Try most common patterns first
    let query;
    let params;

    // First, try to get the actual column names by querying information_schema
    // This is more reliable than guessing column names
    let tableExists = false;
    try {
      const [tableCheck] = await mysqlPool.query(
        `SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'urdu_translation_audio'`
      );
      tableExists = tableCheck.length > 0;
    } catch (err) {
      console.error('Error checking table existence:', err.message);
    }

    if (!tableExists) {
      return res.status(404).json({
        error: 'Table not found',
        message: 'urdu_translation_audio table does not exist in the database'
      });
    }

    // Get column names from the table
    let columnInfo = [];
    try {
      const [columns] = await mysqlPool.query(
        `SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'urdu_translation_audio'`
      );
      columnInfo = columns.map(col => col.COLUMN_NAME);
    } catch (err) {
      console.error('Error getting column info:', err.message);
      return res.status(500).json({ error: 'Database error', message: 'Could not retrieve table structure' });
    }

    // Find the relevant columns
    const surahCol = columnInfo.find(col => 
      ['chapter_number', 'surah', 'suraid', 'SuraId', 'chapter', 'SuraID'].includes(col)
    ) || columnInfo.find(col => col.toLowerCase().includes('sura') || col.toLowerCase().includes('chapter'));
    
    const ayahCol = columnInfo.find(col => 
      ['verse_number', 'ayah', 'ayaid', 'AyaId', 'verse', 'AyaID'].includes(col)
    ) || columnInfo.find(col => col.toLowerCase().includes('ayah') || col.toLowerCase().includes('verse'));
    
    const audioCol = columnInfo.find(col => 
      ['audio_url', 'audio_path', 'url', 'audioUrl', 'audioPath', 'AudioUrl', 'AudioPath',
       'translation_audio_url', 'translation_audio_path', 'translation_url',
       'TranslationAudioUrl', 'TranslationAudioPath', 'TranslationUrl'].includes(col)
    ) || columnInfo.find(col => col.toLowerCase().includes('audio') || col.toLowerCase().includes('url'));

    if (!surahCol || !ayahCol || !audioCol) {
      return res.status(500).json({ 
        error: 'Table structure error', 
        message: `Could not identify required columns. Found columns: ${columnInfo.join(', ')}` 
      });
    }

    if (ayahNum !== null) {
      // Query for specific surah and ayah
      query = `SELECT * FROM urdu_translation_audio WHERE ${surahCol} = ? AND ${ayahCol} = ? LIMIT 1`;
      params = [surahNum, ayahNum];
    } else {
      // Query for all ayahs in a surah
      query = `SELECT * FROM urdu_translation_audio WHERE ${surahCol} = ? ORDER BY ${ayahCol} ASC`;
      params = [surahNum];
    }

    const [rows] = await mysqlPool.query(query, params);

    if (!rows || rows.length === 0) {
      return res.status(404).json({
        error: 'Not found',
        message: ayahNum
          ? `No Urdu translation audio found for Surah ${surahNum}, Ayah ${ayahNum}`
          : `No Urdu translation audio found for Surah ${surahNum}`
      });
    }

    // Format response using detected columns
    const formatted = rows.map(row => {
      const surahValue = row[surahCol] || surahNum;
      const ayahValue = row[ayahCol] || null;
      const audioUrl = row[audioCol] || '';

      return {
        surah: parseInt(surahValue) || surahNum,
        ayah: parseInt(ayahValue) || null,
        audio_url: audioUrl,
        raw: row // Include raw row for debugging
      };
    });

    // If single ayah requested, return single object; otherwise return array
    if (ayahNum !== null && formatted.length === 1) {
      res.json(formatted[0]);
    } else {
      res.json({
        language: 'urdu',
        surah: surahNum,
        ayah: ayahNum,
        count: formatted.length,
        audio: formatted
      });
    }
  } catch (error) {
    console.error('❌ Error fetching Urdu translation audio:', error.message);
    console.error('❌ Full error:', error);
    res.status(500).json({ error: 'Database error', message: error.message });
  }
};

// Get Urdu interpretation audio
exports.getUrduInterpretationAudio = async (req, res) => {
  try {
    const { surah, ayah } = req.params;
    const surahNum = parseInt(surah, 10);
    const ayahNum = ayah !== undefined ? parseInt(ayah, 10) : null;

    if (!Number.isFinite(surahNum) || surahNum < 1 || surahNum > 114) {
      return res.status(400).json({ error: 'Invalid surah', message: 'Surah must be between 1 and 114' });
    }

    if (ayahNum !== null && (!Number.isFinite(ayahNum) || ayahNum < 1)) {
      return res.status(400).json({ error: 'Invalid ayah', message: 'Ayah must be a positive number' });
    }

    // First, try to get the actual column names by querying information_schema
    // This is more reliable than guessing column names
    let tableExists = false;
    try {
      const [tableCheck] = await mysqlPool.query(
        `SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'urdu_interpretation_audio'`
      );
      tableExists = tableCheck.length > 0;
    } catch (err) {
      console.error('Error checking table existence:', err.message);
    }

    if (!tableExists) {
      return res.status(404).json({
        error: 'Table not found',
        message: 'urdu_interpretation_audio table does not exist in the database'
      });
    }

    // Get column names from the table
    let columnInfo = [];
    try {
      const [columns] = await mysqlPool.query(
        `SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'urdu_interpretation_audio'`
      );
      columnInfo = columns.map(col => col.COLUMN_NAME);
    } catch (err) {
      console.error('Error getting column info:', err.message);
      return res.status(500).json({ error: 'Database error', message: 'Could not retrieve table structure' });
    }

    // Find the relevant columns
    const surahCol = columnInfo.find(col => 
      ['chapter_number', 'surah', 'suraid', 'SuraId', 'chapter', 'SuraID'].includes(col)
    ) || columnInfo.find(col => col.toLowerCase().includes('sura') || col.toLowerCase().includes('chapter'));
    
    const ayahCol = columnInfo.find(col => 
      ['verse_number', 'ayah', 'ayaid', 'AyaId', 'verse', 'AyaID'].includes(col)
    ) || columnInfo.find(col => col.toLowerCase().includes('ayah') || col.toLowerCase().includes('verse'));
    
    const audioCol = columnInfo.find(col => 
      ['audio_url', 'audio_path', 'url', 'audioUrl', 'audioPath', 'AudioUrl', 'AudioPath',
       'interpretation_audio_url', 'interpretation_audio_path', 'interpretation_url',
       'InterpretationAudioUrl', 'InterpretationAudioPath', 'InterpretationUrl'].includes(col)
    ) || columnInfo.find(col => col.toLowerCase().includes('audio') || col.toLowerCase().includes('url'));

    if (!surahCol || !ayahCol || !audioCol) {
      return res.status(500).json({ 
        error: 'Table structure error', 
        message: `Could not identify required columns. Found columns: ${columnInfo.join(', ')}` 
      });
    }

    let query;
    let params;

    if (ayahNum !== null) {
      // Query for specific surah and ayah
      query = `SELECT * FROM urdu_interpretation_audio WHERE ${surahCol} = ? AND ${ayahCol} = ? LIMIT 1`;
      params = [surahNum, ayahNum];
    } else {
      // Query for all ayahs in a surah
      query = `SELECT * FROM urdu_interpretation_audio WHERE ${surahCol} = ? ORDER BY ${ayahCol} ASC`;
      params = [surahNum];
    }

    const [rows] = await mysqlPool.query(query, params);

    if (!rows || rows.length === 0) {
      return res.status(404).json({
        error: 'Not found',
        message: ayahNum
          ? `No Urdu interpretation audio found for Surah ${surahNum}, Ayah ${ayahNum}`
          : `No Urdu interpretation audio found for Surah ${surahNum}`
      });
    }

    // Format response using detected columns
    const formatted = rows.map(row => {
      const surahValue = row[surahCol] || surahNum;
      const ayahValue = row[ayahCol] || null;
      const audioUrl = row[audioCol] || '';

      return {
        surah: parseInt(surahValue) || surahNum,
        ayah: parseInt(ayahValue) || null,
        audio_url: audioUrl,
        raw: row // Include raw row for debugging
      };
    });

    // If single ayah requested, return single object; otherwise return array
    if (ayahNum !== null && formatted.length === 1) {
      res.json(formatted[0]);
    } else {
      res.json({
        language: 'urdu',
        surah: surahNum,
        ayah: ayahNum,
        count: formatted.length,
        audio: formatted
      });
    }
  } catch (error) {
    console.error('❌ Error fetching Urdu interpretation audio:', error.message);
    console.error('❌ Full error:', error);
    res.status(500).json({ error: 'Database error', message: error.message });
  }
};

// Word search for languages (Bangla, Hindi, Tamil, Urdu, English, Malayalam, Arabic)
exports.searchWords = async (req, res) => {
  try {
    const { language } = req.params;
    // Get query from query string parameter (preferred) or path parameter (backward compatibility)
    const query = req.query.q || req.query.query || req.params.query;
    const lang  = language.toLowerCase();

    if (!query || query.trim().length === 0) {
      return res.status(400).json({ error: 'Invalid query', message: 'Search query cannot be empty. Use ?q=your+search+term' });
    }

    // Pagination
    const page   = Math.max(1, parseInt(req.query.page,  10) || 1);
    const limit  = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 10));
    const offset = (page - 1) * limit;

    const searchTerm = `%${query.trim()}%`;

    // ── Arabic ─────────────────────────────────────────────────────────────
    if (lang === 'arabic') {
      const [[{ total }]] = await mysqlPool.query(
        `SELECT COUNT(DISTINCT CONCAT(suraid, '_', ayaid)) AS total
         FROM quranayas WHERE AyaHText LIKE ? OR AyaNText LIKE ?`,
        [searchTerm, searchTerm]
      );

      const [rows] = await mysqlPool.query(
        `SELECT DISTINCT suraid AS surah, ayaid AS ayah,
                AyaHText AS arabicWord, AyaNText AS matchedText
         FROM quranayas
         WHERE AyaHText LIKE ? OR AyaNText LIKE ?
         ORDER BY surah, ayah
         LIMIT ? OFFSET ?`,
        [searchTerm, searchTerm, limit, offset]
      );

      return res.json({
        language: lang,
        query:    query.trim(),
        count:    rows.length,
        total:    Number(total),
        page,
        limit,
        hasMore:  offset + rows.length < Number(total),
        results:  rows.map(row => ({
          surah:       parseInt(row.surah),
          ayah:        parseInt(row.ayah),
          arabicWord:  row.arabicWord  || '',
          matchedText: row.matchedText || ''
        }))
      });
    }

    // ── English ────────────────────────────────────────────────────────────
    if (lang === 'english' || lang === 'e') {
      const [[{ total }]] = await mysqlPool.query(
        `SELECT COUNT(*) AS total FROM (
           SELECT DISTINCT t.chapter_number AS surah, t.verse_number AS ayah
           FROM eng_translations t WHERE t.translation_text LIKE ?
           UNION
           SELECT DISTINCT i.SuraId AS surah, i.ayafrom AS ayah
           FROM enginterpretation i WHERE i.Interpretation LIKE ?
         ) sub`,
        [searchTerm, searchTerm]
      );

      const [rows] = await mysqlPool.query(
        `SELECT * FROM (
           SELECT DISTINCT
             t.chapter_number AS surah,
             t.verse_number   AS ayah,
             t.translation_text AS matchedText,
             t.translation_text AS translationText,
             'translation' AS sourceType
           FROM eng_translations t
           WHERE t.translation_text LIKE ?
           UNION
           SELECT DISTINCT
             i.SuraId   AS surah,
             i.ayafrom  AS ayah,
             i.Interpretation AS matchedText,
             COALESCE(t2.translation_text, '') AS translationText,
             'interpretation' AS sourceType
           FROM enginterpretation i
           LEFT JOIN eng_translations t2
             ON t2.chapter_number = i.SuraId AND t2.verse_number = i.ayafrom
           WHERE i.Interpretation LIKE ?
         ) combined
         ORDER BY surah, ayah
         LIMIT ? OFFSET ?`,
        [searchTerm, searchTerm, limit, offset]
      );

      return res.json({
        language: 'english',
        query:    query.trim(),
        count:    rows.length,
        total:    Number(total),
        page,
        limit,
        hasMore:  offset + rows.length < Number(total),
        results:  rows.map(row => ({
          surah:           parseInt(row.surah),
          ayah:            parseInt(row.ayah),
          arabicWord:      '',
          matchedText:     row.matchedText     || '',
          translationText: row.translationText || '',
          sourceType:      row.sourceType      || 'translation'
        }))
      });
    }

    // ── Malayalam ──────────────────────────────────────────────────────────
    if (lang === 'malayalam' || lang === 'mal') {
      const dbName      = mysqlPool.meta?.database || 'thafheem_thafnewdb';
      const escapedDb   = `\`${dbName.replace(/`/g, '``')}\``;

      const [[{ total }]] = await mysqlPool.query(
        `SELECT COUNT(*) AS total FROM (
           SELECT DISTINCT tr.suraid AS surah, tr.ayaid AS ayah
           FROM ${escapedDb}.audiotranslation tr WHERE tr.AudioText LIKE ?
           UNION
           SELECT DISTINCT ai.suraid AS surah, ai.aya_no AS ayah
           FROM ${escapedDb}.audiointerpretation ai WHERE ai.AudioIntrerptn LIKE ?
         ) sub`,
        [searchTerm, searchTerm]
      );

      const [rows] = await mysqlPool.query(
        `SELECT * FROM (
           SELECT DISTINCT
             tr.suraid AS surah,
             tr.ayaid  AS ayah,
             tr.AudioText AS matchedText,
             tr.AudioText AS translationText,
             'translation' AS sourceType
           FROM ${escapedDb}.audiotranslation tr
           WHERE tr.AudioText LIKE ?
           UNION
           SELECT DISTINCT
             ai.suraid AS surah,
             ai.aya_no AS ayah,
             ai.AudioIntrerptn AS matchedText,
             COALESCE(tr2.AudioText, '') AS translationText,
             'interpretation' AS sourceType
           FROM ${escapedDb}.audiointerpretation ai
           LEFT JOIN ${escapedDb}.audiotranslation tr2
             ON tr2.suraid = ai.suraid AND tr2.ayaid = ai.aya_no
           WHERE ai.AudioIntrerptn LIKE ?
         ) combined
         ORDER BY surah, ayah
         LIMIT ? OFFSET ?`,
        [searchTerm, searchTerm, limit, offset]
      );

      return res.json({
        language: lang,
        query:    query.trim(),
        count:    rows.length,
        total:    Number(total),
        page,
        limit,
        hasMore:  offset + rows.length < Number(total),
        results:  rows.map(row => ({
          surah:           parseInt(row.surah),
          ayah:            parseInt(row.ayah),
          arabicWord:      '',
          matchedText:     row.matchedText     || '',
          translationText: row.translationText || '',
          sourceType:      row.sourceType      || 'translation'
        }))
      });
    }

    // ── Other languages (word-by-word tables) ──────────────────────────────
    const tableConfig = getTableConfig(lang, 'wordByWord');
    if (!tableConfig) {
      return res.status(404).json({ error: 'Language not supported', message: `Word search not available for ${lang}` });
    }

    const { table, chapter, verse } = tableConfig;
    const meaningColumn = (lang === 'english' || lang === 'e') ? 'EngMeaning' : 'WordMeaning';

    const [[{ total: wbwTotal }]] = await mysqlPool.query(
      `SELECT COUNT(DISTINCT CONCAT(${chapter}, '_', ${verse})) AS total
       FROM ${table} WHERE ${meaningColumn} LIKE ?`,
      [searchTerm]
    );

    const [rows] = await mysqlPool.query(
      `SELECT DISTINCT ${chapter} AS surah, ${verse} AS ayah,
              WordPhrase AS arabicWord, ${meaningColumn} AS matchedText
       FROM ${table}
       WHERE ${meaningColumn} LIKE ?
       ORDER BY ${chapter}, ${verse}
       LIMIT ? OFFSET ?`,
      [searchTerm, limit, offset]
    );

    res.json({
      language: lang,
      query:    query.trim(),
      count:    rows.length,
      total:    Number(wbwTotal),
      page,
      limit,
      hasMore:  offset + rows.length < Number(wbwTotal),
      results:  rows.map(row => ({
        surah:       parseInt(row.surah),
        ayah:        parseInt(row.ayah),
        arabicWord:  row.arabicWord  || '',
        matchedText: row.matchedText || ''
      }))
    });
  } catch (error) {
    const lang = req.params.language?.toLowerCase();
    console.error(`❌ Error searching words for ${lang}:`, {
      message: error.message,
      query:    req.query.q || req.query.query || req.params.query,
      database: mysqlPool.meta?.database,
      host:     mysqlPool.meta?.host,
      stack:    process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
    res.status(500).json({
      error:    'Database error',
      message:  error.message,
      language: lang,
      query:    req.query.q || req.query.query || req.params.query
    });
  }
};

// Get all surah names from suratable
exports.getAllSurahNames = async (req, res) => {
  try {
    // Query suratable to get all surah information
    const query = `
      SELECT 
        SuraId AS SuraID,
        ASuraName,
        ESuraName,
        TotalAyas,
        SuraType
      FROM suratable
      ORDER BY SuraId ASC
    `;

    const [rows] = await mysqlPool.query(query);

    if (!rows || rows.length === 0) {
      return res.status(404).json({
        error: 'Not found',
        message: 'No surah data found in database'
      });
    }

    // Format the response to match frontend expectations
    const surahs = rows.map(row => ({
      SuraID: parseInt(row.SuraID) || parseInt(row.SuraId) || null,
      ASuraName: row.ASuraName ? row.ASuraName.trim() : '',
      ESuraName: row.ESuraName ? row.ESuraName.trim() : '',
      TotalAyas: parseInt(row.TotalAyas) || 0,
      SuraType: row.SuraType || ''
    }));

    return res.json(surahs);
  } catch (error) {
    console.error('❌ Error fetching surah names from MySQL:', error.message);
    res.status(500).json({
      error: 'Database error',
      message: error.message
    });
  }
};

// Get surah names by language
exports.getSurahNamesByLanguage = async (req, res) => {
  try {
    const lang = (req.params.language || 'english').toLowerCase();
    
    let query;
    let surahNameColumn;
    
    // Map language codes to database tables and columns
    switch (lang) {
      case 'bangla':
      case 'bn':
        query = `
          SELECT 
            s.SuraId AS SuraID,
            s.ASuraName,
            b.surah_name AS SuraName,
            s.TotalAyas,
            s.SuraType
          FROM suratable s
          INNER JOIN bangla_surah_names b ON s.SuraId = b.surah_id
          ORDER BY s.SuraId ASC
        `;
        surahNameColumn = 'SuraName';
        break;
        
      case 'hindi':
      case 'hi':
        query = `
          SELECT 
            h.surah_number AS SuraID,
            h.name_ar AS ASuraName,
            h.name_hi AS SuraName,
            h.ayah_count AS TotalAyas,
            h.type AS SuraType
          FROM hindi_surah_names h
          ORDER BY h.surah_number ASC
        `;
        surahNameColumn = 'SuraName';
        break;
        
      case 'tamil':
      case 'ta':
        query = `
          SELECT 
            s.SuraId AS SuraID,
            s.ASuraName,
            t.surah_name AS SuraName,
            s.TotalAyas,
            s.SuraType
          FROM suratable s
          INNER JOIN tamil_surah_names t ON s.SuraId = t.surah_id
          ORDER BY s.SuraId ASC
        `;
        surahNameColumn = 'SuraName';
        break;
        
      case 'urdu':
      case 'ur':
        query = `
          SELECT 
            s.SuraId AS SuraID,
            s.ASuraName,
            u.surah_name AS SuraName,
            s.TotalAyas,
            s.SuraType
          FROM suratable s
          INNER JOIN urdu_surah_names u ON s.SuraId = u.surah_id
          ORDER BY s.SuraId ASC
        `;
        surahNameColumn = 'SuraName';
        break;
        
      case 'english':
      case 'en':
      case 'e':
        query = `
          SELECT 
            SuraId AS SuraID,
            ASuraName,
            ESuraName AS SuraName,
            TotalAyas,
            SuraType
          FROM suratable
          ORDER BY SuraId ASC
        `;
        surahNameColumn = 'SuraName';
        break;
        
      case 'malayalam':
      case 'mal':
      case 'ml':
        query = `
          SELECT 
            SuraId AS SuraID,
            ASuraName,
            MSuraName AS SuraName,
            TotalAyas,
            SuraType
          FROM suratable
          ORDER BY SuraId ASC
        `;
        surahNameColumn = 'SuraName';
        break;
        
      default:
        return res.status(400).json({
          error: 'Invalid language',
          message: 'Supported languages: bangla, hindi, tamil, urdu, english, malayalam'
        });
    }

    const [rows] = await mysqlPool.query(query);

    if (!rows || rows.length === 0) {
      return res.status(404).json({
        error: 'Not found',
        message: `No surah data found for language: ${lang}`
      });
    }

    // Format the response to match frontend expectations
    const surahs = rows.map(row => ({
      SuraID: parseInt(row.SuraID) || parseInt(row.SuraId) || null,
      ASuraName: row.ASuraName ? row.ASuraName.trim() : '',
      SuraName: row[surahNameColumn] ? row[surahNameColumn].trim() : '',
      TotalAyas: parseInt(row.TotalAyas) || 0,
      SuraType: row.SuraType || ''
    }));

    return res.json(surahs);
  } catch (error) {
    console.error(`❌ Error fetching surah names for language ${req.params.language}:`, error.message);
    res.status(500).json({
      error: 'Database error',
      message: error.message
    });
  }
};

// Get sujud ayahs with language-specific surah names
exports.getSujudAyahsByLanguage = async (req, res) => {
  try {
    const lang = (req.params.language || 'english').toLowerCase();

    let surahNamesQuery;

    switch (lang) {
      case 'bangla':
      case 'bn':
        surahNamesQuery = `
          SELECT
            s.SuraId AS SuraID,
            b.surah_name AS SuraName
          FROM suratable s
          INNER JOIN bangla_surah_names b ON s.SuraId = b.surah_id
          ORDER BY s.SuraId ASC
        `;
        break;

      case 'hindi':
      case 'hi':
        surahNamesQuery = `
          SELECT
            h.surah_number AS SuraID,
            h.name_hi AS SuraName
          FROM hindi_surah_names h
          ORDER BY h.surah_number ASC
        `;
        break;

      case 'tamil':
      case 'ta':
        surahNamesQuery = `
          SELECT
            s.SuraId AS SuraID,
            t.surah_name AS SuraName
          FROM suratable s
          INNER JOIN tamil_surah_names t ON s.SuraId = t.surah_id
          ORDER BY s.SuraId ASC
        `;
        break;

      case 'urdu':
      case 'ur':
        surahNamesQuery = `
          SELECT
            s.SuraId AS SuraID,
            u.surah_name AS SuraName
          FROM suratable s
          INNER JOIN urdu_surah_names u ON s.SuraId = u.surah_id
          ORDER BY s.SuraId ASC
        `;
        break;

      case 'english':
      case 'en':
      case 'e':
        surahNamesQuery = `
          SELECT
            SuraId AS SuraID,
            ESuraName AS SuraName
          FROM suratable
          ORDER BY SuraId ASC
        `;
        break;

      case 'malayalam':
      case 'mal':
      case 'ml':
        surahNamesQuery = `
          SELECT
            SuraId AS SuraID,
            MSuraName AS SuraName
          FROM suratable
          ORDER BY SuraId ASC
        `;
        break;

      default:
        return res.status(400).json({
          error: 'Invalid language',
          message: 'Supported languages: bangla, hindi, tamil, urdu, english, malayalam'
        });
    }

    const sujudQuery = `
      SELECT
        ID,
        suraName,
        suraNo,
        Ayath,
        startAya,
        endAya,
        ayaNo
      FROM sujud_aya
      ORDER BY ID ASC
    `;

    const [[sujudRows], [surahNameRows]] = await Promise.all([
      mysqlPool.query(sujudQuery),
      mysqlPool.query(surahNamesQuery)
    ]);

    if (!sujudRows || sujudRows.length === 0) {
      return res.status(404).json({
        error: 'Not found',
        message: 'No sujud ayah data found in database'
      });
    }

    const surahNameMap = new Map(
      (surahNameRows || []).map((row) => [
        parseInt(row.SuraID, 10),
        row.SuraName ? row.SuraName.toString().trim() : ''
      ])
    );

    const results = sujudRows.map((row) => {
      const suraNo = parseInt(row.suraNo, 10);
      const localizedSurahName = surahNameMap.get(suraNo);

      return {
        ID: parseInt(row.ID, 10) || null,
        suraName: localizedSurahName ?? (row.suraName ? row.suraName.toString().trim() : ''),
        suraNo: suraNo || null,
        Ayath: row.Ayath || '',
        startAya: parseInt(row.startAya, 10) || null,
        endAya: parseInt(row.endAya, 10) || null,
        ayaNo: parseInt(row.ayaNo, 10) || null
      };
    });

    return res.json(results);
  } catch (error) {
    console.error(`❌ Error fetching sujud ayahs for language ${req.params.language}:`, error.message);
    return res.status(500).json({
      error: 'Database error',
      message: error.message
    });
  }
};

// Get surah metadata (name, type, verses, etc.) from suratable
exports.getSurahMetadata = async (req, res) => {
  try {
    const surahNum = parseInt(req.params.surah, 10);
    const lang = (req.params.language || 'en').toLowerCase();

    if (!Number.isFinite(surahNum) || surahNum < 1 || surahNum > 114) {
      return res.status(400).json({
        error: 'Invalid surah',
        message: 'Surah must be between 1 and 114'
      });
    }

    const query = `
      SELECT 
        SuraId,
        ASuraName,
        ESuraName,
        TotalAyas,
        SuraType,
        ThafVolume,
        RevOrder
      FROM suratable
      WHERE SuraId = ?
      LIMIT 1
    `;

    const [rows] = await mysqlPool.query(query, [surahNum]);

    if (!rows || rows.length === 0) {
      return res.status(404).json({
        error: 'Not found',
        message: `No surah data found for Surah ${surahNum}`
      });
    }

    const row = rows[0] || {};
    const result = {
      id: surahNum,
      name_arabic: row.ASuraName || null,
      name_simple: row.ESuraName || null,
      verses_count: row.TotalAyas || null,
      revelation_place: row.SuraType || null,
      revelation_order: row.RevOrder || surahNum, // fallback to surah number when order is not provided
      ThafVolume: row.ThafVolume || null,
      language: lang
    };

    return res.json(result);
  } catch (error) {
    console.error('❌ Error fetching surah metadata from MySQL:', error.message);
    res.status(500).json({
      error: 'Database error',
      message: error.message
    });
  }
};

// Helper function to query page ranges table
const findAndQueryPageRangesTable = async (whereClause = '', params = []) => {
  const query = `
    SELECT 
      PageId,
      SuraId,
      ayafrom,
      ayato,
      juzid
    FROM pagerange
    ${whereClause}
    ORDER BY PageId ASC
  `;
  const [result] = await mysqlPool.query(query, params);
  return result || [];
};

// Get all page ranges
exports.getAllPageRanges = async (req, res) => {
  try {
    const rows = await findAndQueryPageRangesTable();

    if (rows.length === 0) {
      return res.status(404).json({
        error: 'Not found',
        message: 'No page ranges found in database'
      });
    }

    // Format the response to match frontend expectations
    const pageRanges = rows.map(row => ({
      PageId: parseInt(row.PageId) || null,
      SuraId: parseInt(row.SuraId) || null,
      ayafrom: parseFloat(row.ayafrom) || null,
      ayato: parseFloat(row.ayato) || null,
      juzid: parseInt(row.juzid) || null
    }));

    return res.json(pageRanges);
  } catch (error) {
    console.error('❌ Error fetching page ranges from MySQL:', error.message);
    res.status(500).json({
      error: 'Database error',
      message: error.message
    });
  }
};

// Get page range by pageId
exports.getPageRangeById = async (req, res) => {
  try {
    const { pageId } = req.params;
    const pageIdNum = parseInt(pageId, 10);

    if (isNaN(pageIdNum) || pageIdNum < 1) {
      return res.status(400).json({
        error: 'Invalid pageId',
        message: 'PageId must be a positive number'
      });
    }

    const rows = await findAndQueryPageRangesTable('WHERE PageId = ?', [pageIdNum]);

    if (rows.length === 0) {
      return res.status(404).json({
        error: 'Not found',
        message: `Page range with PageId ${pageId} not found`
      });
    }

    // Format the response - return single object (frontend expects array with one item)
    const pageRange = {
      PageId: parseInt(rows[0].PageId) || null,
      SuraId: parseInt(rows[0].SuraId) || null,
      ayafrom: parseFloat(rows[0].ayafrom) || null,
      ayato: parseFloat(rows[0].ayato) || null,
      juzid: parseInt(rows[0].juzid) || null
    };

    return res.json([pageRange]); // Return as array for frontend compatibility
  } catch (error) {
    console.error('❌ Error fetching page range by ID from MySQL:', error.message);
    res.status(500).json({
      error: 'Database error',
      message: error.message
    });
  }
};
