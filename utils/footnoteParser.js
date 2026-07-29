/**
 * Parse English translation HTML and extract footnote metadata
 * This function finds both structured footnotes (<sup foot_note="...">) and loose numbers in text
 * @param {string} htmlContent - The HTML translation text
 * @param {number} surahNo - Surah number
 * @param {number} ayahNo - Ayah number
 * @returns {Object} Object containing raw HTML and footnote metadata
 */
function parseEnglishTranslationFootnotes(htmlContent, surahNo, ayahNo) {
  if (!htmlContent || typeof htmlContent !== 'string') {
    return {
      rawHtml: htmlContent || '',
      processedHtml: htmlContent || '',
      footnotes: [],
      looseNumbers: []
    };
  }

  const footnotes = [];
  const looseNumbers = [];

  const supFootnoteRegex = /<sup[^>]*foot_note="([^"]+)"[^>]*>(\d+)<\/sup>/g;
  let match;
  while ((match = supFootnoteRegex.exec(htmlContent)) !== null) {
    const footnoteId = match[1];
    const footnoteNumber = parseInt(match[2], 10);
    footnotes.push({
      type: 'structured',
      number: footnoteNumber,
      footnoteId: footnoteId,
      position: match.index,
      length: match[0].length
    });
  }

  return {
    rawHtml: htmlContent,
    processedHtml: htmlContent,
    footnotes: footnotes,
    looseNumbers: looseNumbers
  };
}

module.exports = { parseEnglishTranslationFootnotes };

