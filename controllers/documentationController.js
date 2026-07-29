const { banglaDB, hindiDB, tamilDB, urduDB, englishDB } = require('../config/database');

// Get comprehensive API documentation
exports.getDocumentation = (req, res) => {
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  
  const documentation = {
    title: 'Thafheem Quran API Documentation',
    version: '1.0.0',
    description: 'Comprehensive API for accessing Quran translations, interpretations, and word-by-word meanings in multiple languages',
    baseUrl: baseUrl,
    lastUpdated: new Date().toISOString(),
    
    // API Overview
    overview: {
      purpose: 'Provide access to Quran translations, interpretations, and word-by-word meanings',
      supportedLanguages: ['bangla', 'hindi', 'tamil', 'urdu', 'english'],
      totalEndpoints: 12,
      databaseConnections: 5
    },

    // Health & Status
    health: {
      main: `${baseUrl}/health`,
      languageSpecific: `${baseUrl}/api/:language/health`
    },

    // Core Endpoints
    endpoints: {
      // Translation Endpoints
      translation: {
        singleAyah: {
          method: 'GET',
          path: '/api/:language/translation/:surah/:ayah',
          description: 'Get translation for a specific ayah',
          parameters: {
            language: {
              type: 'string',
              required: true,
              options: ['bangla', 'hindi', 'tamil', 'urdu', 'english'],
              description: 'Language code for translation'
            },
            surah: {
              type: 'number',
              required: true,
              range: '1-114',
              description: 'Surah number (1-114)'
            },
            ayah: {
              type: 'number',
              required: true,
              range: '1-286',
              description: 'Ayah number within the surah'
            }
          },
          example: `${baseUrl}/api/bangla/translation/1/1`,
          response: {
            language: 'bangla',
            surah: 1,
            ayah: 1,
            translation_text: 'Translation text here...'
          }
        },
        
        surahTranslations: {
          method: 'GET',
          path: '/api/:language/surah/:surah',
          description: 'Get all translations for a complete surah',
          parameters: {
            language: {
              type: 'string',
              required: true,
              options: ['bangla', 'hindi', 'tamil', 'urdu', 'english']
            },
            surah: {
              type: 'number',
              required: true,
              range: '1-114'
            }
          },
          example: `${baseUrl}/api/hindi/surah/1`,
          response: {
            language: 'hindi',
            surah: 1,
            count: 7,
            translations: [
              {
                verse_number: 1,
                translation_text: 'Translation text...'
              }
            ]
          }
        }
      },

      // Interpretation Endpoints
      interpretation: {
        method: 'GET',
        path: '/api/:language/interpretation/:surah/:ayah',
        description: 'Get interpretation/explanation for a specific ayah',
        parameters: {
          language: {
            type: 'string',
            required: true,
            options: ['bangla', 'hindi'],
            note: 'Tamil has no interpretations. Urdu and English use footnote system.'
          },
          surah: {
            type: 'number',
            required: true,
            range: '1-114'
          },
          ayah: {
            type: 'number',
            required: true,
            range: '1-286'
          },
          explanationNo: {
            type: 'number',
            required: false,
            description: 'Specific explanation number (optional)'
          }
        },
        example: `${baseUrl}/api/bangla/interpretation/1/1`,
        response: {
          language: 'bangla',
          surah: 1,
          ayah: 1,
          count: 1,
          explanations: [
            {
              explanation: 'Explanation text...',
              explanation_no_local: 1,
              explanation_no_en: 1
            }
          ]
        }
      },

      // Word-by-Word Endpoints
      wordByWord: {
        method: 'GET',
        path: '/api/:language/word-by-word/:surah/:ayah',
        description: 'Get word-by-word translation and meanings',
        parameters: {
          language: {
            type: 'string',
            required: true,
            options: ['bangla', 'hindi', 'tamil', 'urdu', 'english']
          },
          surah: {
            type: 'number',
            required: true,
            range: '1-114'
          },
          ayah: {
            type: 'number',
            required: true,
            range: '1-286'
          }
        },
        example: `${baseUrl}/api/urdu/word-by-word/1/1`,
        response: {
          language: 'urdu',
          surah: 1,
          ayah: 1,
          count: 4,
          words: [
            {
              WordId: 1,
              ArabicWord: 'بِسْمِ',
              Translation: 'In the name of',
              // ... other word fields
            }
          ]
        }
      },

      // Footnote Endpoints (Urdu & English)
      footnotes: {
        urduFootnote: {
          method: 'GET',
          path: '/api/urdu/footnote/:footnoteId',
          description: 'Get Urdu footnote/interpretation by ID',
          parameters: {
            footnoteId: {
              type: 'number',
              required: true,
              description: 'Footnote ID from the database'
            }
          },
          example: `${baseUrl}/api/urdu/footnote/176997`,
          response: {
            footnote_id: 176997,
            footnote_text: 'Footnote text here...'
          }
        },
        
        englishFootnote: {
          method: 'GET',
          path: '/api/english/footnote/:footnoteId',
          description: 'Get English footnote/interpretation by ID',
          parameters: {
            footnoteId: {
              type: 'number',
              required: true,
              description: 'Footnote ID from the database'
            }
          },
          example: `${baseUrl}/api/english/footnote/176997`,
          response: {
            footnote_id: 176997,
            footnote_text: 'Footnote text here...'
          }
        }
      }
    },

    // Language-Specific Information
    languages: {
      bangla: {
        name: 'Bengali',
        translationTable: 'bangla_translations',
        interpretationTable: 'bengla_explanations',
        wordByWordTable: 'bengla_wordmeanings',
        hasInterpretations: true,
        hasFootnotes: false,
        totalVerses: 6236
      },
      hindi: {
        name: 'Hindi',
        translationTable: 'hindi_translation',
        interpretationTable: 'hindi_explanation',
        wordByWordTable: 'hindi_wordmeanings',
        hasInterpretations: true,
        hasFootnotes: false,
        totalVerses: 6236
      },
      tamil: {
        name: 'Tamil',
        translationTable: 'tamil_translations',
        interpretationTable: null,
        wordByWordTable: 'tamil_wordmeanings',
        hasInterpretations: false,
        hasFootnotes: false,
        totalVerses: 6236
      },
      urdu: {
        name: 'Urdu',
        translationTable: 'urdu_tranlations',
        interpretationTable: null,
        wordByWordTable: 'urdu_wordmeanings',
        hasInterpretations: false,
        hasFootnotes: true,
        totalVerses: 6236
      },
      english: {
        name: 'English',
        translationTable: 'eng_translations',
        interpretationTable: null,
        wordByWordTable: 'qwmenglish',
        hasInterpretations: false,
        hasFootnotes: true,
        totalVerses: 6236
      }
    },

    // Error Handling
    errorCodes: {
      400: 'Bad Request - Invalid parameters or language',
      404: 'Not Found - Resource not available',
      500: 'Internal Server Error - Database or server error'
    },

    // Common Error Responses
    errorResponses: {
      invalidLanguage: {
        status: 400,
        error: 'Invalid language',
        message: 'Language is not supported. Supported languages: bangla, hindi, tamil, urdu, english'
      },
      notFound: {
        status: 404,
        error: 'Not Found',
        message: 'Resource not found'
      },
      databaseError: {
        status: 500,
        error: 'Database error',
        message: 'Database connection or query error'
      }
    },

    // Usage Examples
    examples: {
      getBanglaTranslation: {
        url: `${baseUrl}/api/bangla/translation/1/1`,
        description: 'Get Bengali translation of Al-Fatiha, verse 1'
      },
      getHindiSurah: {
        url: `${baseUrl}/api/hindi/surah/2`,
        description: 'Get all Hindi translations of Al-Baqarah'
      },
      getTamilWordByWord: {
        url: `${baseUrl}/api/tamil/word-by-word/1/1`,
        description: 'Get Tamil word-by-word meanings for Al-Fatiha, verse 1'
      },
      getUrduFootnote: {
        url: `${baseUrl}/api/urdu/footnote/176997`,
        description: 'Get Urdu footnote/interpretation by ID'
      },
      checkHealth: {
        url: `${baseUrl}/api/bangla/health`,
        description: 'Check Bengali database health'
      }
    },

    // Rate Limiting & Best Practices
    bestPractices: {
      caching: 'Consider implementing client-side caching for better performance',
      errorHandling: 'Always handle HTTP error codes appropriately',
      languageValidation: 'Validate language parameter before making requests',
      pagination: 'For large datasets, consider implementing pagination',
      compression: 'Use gzip compression for better performance'
    },

    // Contact & Support
    support: {
      documentation: `${baseUrl}/doc`,
      healthCheck: `${baseUrl}/health`,
      version: '1.0.0',
      lastUpdated: new Date().toISOString()
    }
  };

  res.json(documentation);
};

// Get quick reference guide
exports.getQuickReference = (req, res) => {
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  
  const quickRef = {
    title: 'Thafheem API - Quick Reference',
    baseUrl: baseUrl,
    
    // Most Common Endpoints
    commonEndpoints: [
      {
        method: 'GET',
        path: '/api/:language/translation/:surah/:ayah',
        description: 'Get single ayah translation',
        example: `${baseUrl}/api/bangla/translation/1/1`
      },
      {
        method: 'GET',
        path: '/api/:language/surah/:surah',
        description: 'Get complete surah translation',
        example: `${baseUrl}/api/hindi/surah/1`
      },
      {
        method: 'GET',
        path: '/api/:language/word-by-word/:surah/:ayah',
        description: 'Get word-by-word meanings',
        example: `${baseUrl}/api/urdu/word-by-word/1/1`
      },
      {
        method: 'GET',
        path: '/api/:language/interpretation/:surah/:ayah',
        description: 'Get interpretation (Bangla/Hindi only)',
        example: `${baseUrl}/api/bangla/interpretation/1/1`
      },
      {
        method: 'GET',
        path: '/api/urdu/footnote/:footnoteId',
        description: 'Get Urdu footnote',
        example: `${baseUrl}/api/urdu/footnote/176997`
      },
      {
        method: 'GET',
        path: '/api/english/footnote/:footnoteId',
        description: 'Get English footnote',
        example: `${baseUrl}/api/english/footnote/176997`
      }
    ],
    
    // Supported Languages
    languages: ['bangla', 'hindi', 'tamil', 'urdu', 'english'],
    
    // Quick Health Check
    healthCheck: `${baseUrl}/health`,
    
    // Full Documentation
    fullDocs: `${baseUrl}/doc`
  };

  res.json(quickRef);
};
