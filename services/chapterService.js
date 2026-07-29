const mysqlPool = require('../config/database');

// Get chapter info (preface) for a surah
const getChapterInfo = async (surah, language) => {
  const surahNum = parseInt(surah, 10);
  const lang = (language || 'en').toLowerCase();

  if (Number.isNaN(surahNum) || surahNum < 1 || surahNum > 114) {
    throw new Error('Surah must be between 1 and 114');
  }

  const languageMap = {
    'malayalam': 'M',
    'mal': 'M',
    'english': 'E',
    'en': 'E'
  };
  const dbLangCode = languageMap[lang] || 'E';

  const tableQueries = [];

  if (dbLangCode === 'M') {
    tableQueries.push({
      name: 'preface',
      query: `
        SELECT 
          PrefaceSubTitle,
          PrefaceText
        FROM preface
        WHERE SuraId = ? AND status = 1
        ORDER BY ID ASC
      `
    });
  } else if (dbLangCode === 'E') {
    tableQueries.push({
      name: 'engpreface',
      query: `
        SELECT 
          PrefaceSubTitle,
          PrefaceText
        FROM engpreface
        WHERE SuraId = ?
        ORDER BY ID ASC
      `
    });
  }

  // Also try generic tables if they exist
  tableQueries.push(
    {
      name: 'chapter_info',
      query: `
        SELECT 
          SuraId,
          Language,
          short_text,
          text,
          translated_name,
          name_simple,
          name_arabic,
          revelation_place,
          revelation_order,
          verses_count
        FROM chapter_info
        WHERE SuraId = ? AND (Language = ? OR Language = 'E')
        ORDER BY CASE WHEN Language = ? THEN 0 ELSE 1 END
        LIMIT 1
      `
    },
    {
      name: 'surah_info',
      query: `
        SELECT 
          SuraId,
          Language,
          short_text,
          text,
          overview,
          detailed_info
        FROM surah_info
        WHERE SuraId = ? AND (Language = ? OR Language = 'E')
        ORDER BY CASE WHEN Language = ? THEN 0 ELSE 1 END
        LIMIT 1
      `
    }
  );

  for (const tableQuery of tableQueries) {
    try {
      // Handle different parameter counts for different queries
      let params;
      if (tableQuery.name === 'preface' || tableQuery.name === 'engpreface') {
        params = [surahNum];
      } else {
        params = [surahNum, dbLangCode, dbLangCode];
      }
      
      const [rows] = await mysqlPool.query(tableQuery.query, params);
      
      if (rows && rows.length > 0) {
        // For preface tables, combine all sections into one text
        if (tableQuery.name === 'preface' || tableQuery.name === 'engpreface') {
          const sections = rows.map((row, index) => {
            const subtitle = row.PrefaceSubTitle?.toString().trim() || "";
            const text = row.PrefaceText?.toString().trim() || "";
            
            if (subtitle && text) {
              return `<h2>${subtitle}</h2>\n${text}`;
            } else if (subtitle) {
              return `<h2>${subtitle}</h2>`;
            } else {
              return text;
            }
          }).filter(Boolean);
          
          const combinedText = sections.join("\n\n");
          const firstSubtitle = rows[0]?.PrefaceSubTitle?.toString().trim() || "";
          
          const result = {
            id: rows[0].SuraId,
            language: lang,
            short_text: firstSubtitle || null,
            text: combinedText || null
          };
          
          console.log(`[ChapterInfo] Found data in table: ${tableQuery.name}`, {
            surah: surahNum,
            language: lang,
            sections: rows.length,
            hasShortText: Boolean(result.short_text),
            hasText: Boolean(result.text)
          });
          
          return result;
        } else {
          // For other table structures
          const row = rows[0];
          const result = {
            id: row.SuraId,
            language: lang
          };

          // Map different column names to standard format
          if (row.short_text) result.short_text = row.short_text;
          if (row.text) result.text = row.text;
          if (row.overview) result.short_text = row.overview;
          if (row.detailed_info) result.text = row.detailed_info;
          if (row.translated_name) result.translated_name = row.translated_name;
          if (row.name_simple) result.name_simple = row.name_simple;
          if (row.name_arabic) result.name_arabic = row.name_arabic;
          if (row.revelation_place) result.revelation_place = row.revelation_place;
          if (row.revelation_order) result.revelation_order = row.revelation_order;
          if (row.verses_count) result.verses_count = row.verses_count;

          console.log(`[ChapterInfo] Found data in table: ${tableQuery.name}`, {
            surah: surahNum,
            language: lang,
            hasShortText: Boolean(result.short_text),
            hasText: Boolean(result.text)
          });

          return result;
        }
      }
    } catch (tableError) {
      console.log(`[ChapterInfo] Table ${tableQuery.name} not found or error:`, tableError.message);
      continue;
    }
  }

  throw new Error(`Chapter info not available in MySQL database for chapter ${surahNum} in language ${lang}`);
};

module.exports = {
  getChapterInfo
};

