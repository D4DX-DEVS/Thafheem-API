// Table configuration for all languages
const getTableConfig = (language, type) => {
  const lang = language.toLowerCase();
  const config = {
    bangla: {
      translation: { table: 'bangla_translations', chapter: 'chapter_number', verse: 'verse_number', text: 'translation_text', isRange: false },
      interpretation: { table: 'bangla_explanations', chapter: 'surah_no', verse: 'ayah_no', text: 'explanation', explanationNo: 'explanation_no_BNG' },
      wordByWord: { table: 'bangla_wordmeanings', chapter: 'SuraId', verse: 'AyaId' }
    },
    hindi: {
      translation: { table: 'hindi_translation', chapter: 'chapter_number', verse: 'verse_number', text: 'translation_text', isRange: false },
      interpretation: { table: 'hindi_explanation', chapter: 'surah_no', verse: 'ayah_no', text: 'explanation', explanationNo: 'explanation_no_BN' },
      wordByWord: { table: 'hindi_wordmeanings', chapter: 'SuraId', verse: 'AyaId' }
    },
    tamil: {
      translation: { table: 'tamil_translations', chapter: 'chapter_number', verse: 'verse_number', text: 'translation_text', isRange: false },
      interpretation: null,
      wordByWord: { table: 'tamil_wordsmeanings', chapter: 'SuraId', verse: 'AyaId' }
    },
    urdu: {
      translation: { table: 'urdu_translations', chapter: 'chapter_number', verse: 'verse_number', text: 'translation_text', isRange: false },
      interpretation: null,
      wordByWord: { table: 'urdu_wordmeanings', chapter: 'SuraId', verse: 'AyaId' }
    },
    english: {
      translation: { table: 'eng_translations', chapter: 'chapter_number', verse: 'verse_number', text: 'translation_text', isRange: false },
      interpretation: { table: 'enginterpretation', chapter: 'SuraId', verseFrom: 'ayafrom', verseTo: 'ayato', text: 'Interpretation', interpretationNo: 'InterpretationNo', isRange: true },
      wordByWord: { table: 'qwmenglish', chapter: 'SuraId', verse: 'AyaId' }
    },
    e: {
      translation: { table: 'eng_translations', chapter: 'chapter_number', verse: 'verse_number', text: 'translation_text', isRange: false },
      interpretation: { table: 'enginterpretation', chapter: 'SuraId', verseFrom: 'ayafrom', verseTo: 'ayato', text: 'Interpretation', interpretationNo: 'InterpretationNo', isRange: true },
      wordByWord: { table: 'qwmenglish', chapter: 'SuraId', verse: 'AyaId' }
    },
    malayalam: {
      translation: { table: 'qurmaltranslation', chapter: 'SuraID', verseFrom: 'ayafrom', verseTo: 'ayato', text: 'TranslationText', isRange: true },
      interpretation: { table: 'malinterpretation', chapter: 'SuraID', verseFrom: 'AyaFrom', verseTo: 'AyaTo', text: 'Interpretation', interpretationNo: 'InterpretationNo', isRange: true },
      wordByWord: { table: 'qwmmalayalam', chapter: 'SuraId', verse: 'AyaId' }
    },
    mal: {
      translation: { table: 'qurmaltranslation', chapter: 'SuraID', verseFrom: 'ayafrom', verseTo: 'ayato', text: 'TranslationText', isRange: true },
      interpretation: { table: 'malinterpretation', chapter: 'SuraID', verseFrom: 'AyaFrom', verseTo: 'AyaTo', text: 'Interpretation', interpretationNo: 'InterpretationNo', isRange: true },
      wordByWord: { table: 'qwmmalayalam', chapter: 'SuraId', verse: 'AyaId' }
    }
  };
  return config[lang]?.[type];
};

module.exports = { getTableConfig };


