const swaggerJsdoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Thafheem Quran API',
      version: '1.0.0',
      description: 'Comprehensive REST API for accessing Quran translations, interpretations, word-by-word meanings, and related content in multiple languages',
      contact: {
        name: 'Thafheem API Support',
        url: 'https://thafheem.net',
      },
      license: {
        name: 'ISC',
      },
    },
    servers: [
      {
        url: process.env.API_BASE_URL || 'http://localhost:5000',
        description: 'Development server',
      },
      {
        url: 'https://thafheem.net/api',
        description: 'Production server',
      },
    ],
    tags: [
      {
        name: 'Health',
        description: 'Health check endpoints',
      },
      {
        name: 'Translation',
        description: 'Quran translation endpoints for multiple languages',
      },
      {
        name: 'Interpretation',
        description: 'Quran interpretation/explanation endpoints',
      },
      {
        name: 'Word-by-Word',
        description: 'Word-by-word translation and meaning endpoints',
      },
      {
        name: 'Arabic Text',
        description: 'Arabic Quran text endpoints',
      },
      {
        name: 'Footnotes',
        description: 'Footnote endpoints for Urdu, English, and Malayalam',
      },
      {
        name: 'Notes',
        description: 'Notes endpoints',
      },
      {
        name: 'Surah Info',
        description: 'Surah/chapter information endpoints',
      },
      {
        name: 'Blockwise',
        description: 'Blockwise translation and ayah range endpoints',
      },
      {
        name: 'Search',
        description: 'Word search and content search endpoints',
      },
      {
        name: 'Content Pages',
        description: 'Special content pages (Jesus & Mohammed, Finality of Prophethood, etc.)',
      },
      {
        name: 'Tajweed',
        description: 'Tajweed rules endpoints',
      },
      {
        name: 'Audio',
        description: 'Audio URL endpoints for translations and interpretations',
      },
    ],
    components: {
      schemas: {
        Error: {
          type: 'object',
          properties: {
            error: {
              type: 'string',
              description: 'Error type',
            },
            message: {
              type: 'string',
              description: 'Error message',
            },
          },
        },
        Translation: {
          type: 'object',
          properties: {
            language: {
              type: 'string',
              example: 'bangla',
            },
            surah: {
              type: 'integer',
              example: 1,
            },
            ayah: {
              type: 'integer',
              example: 1,
            },
            translation_text: {
              type: 'string',
              description: 'Translation text',
            },
          },
        },
        Interpretation: {
          type: 'object',
          properties: {
            language: {
              type: 'string',
              example: 'bangla',
            },
            surah: {
              type: 'integer',
              example: 1,
            },
            ayah: {
              type: 'integer',
              example: 1,
            },
            count: {
              type: 'integer',
              description: 'Number of interpretations available',
            },
            explanations: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  explanation: {
                    type: 'string',
                  },
                  explanation_no_local: {
                    type: 'integer',
                  },
                  explanation_no_en: {
                    type: 'integer',
                  },
                },
              },
            },
          },
        },
        WordByWord: {
          type: 'object',
          properties: {
            language: {
              type: 'string',
            },
            surah: {
              type: 'integer',
            },
            ayah: {
              type: 'integer',
            },
            count: {
              type: 'integer',
            },
            words: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  WordId: {
                    type: 'integer',
                  },
                  ArabicWord: {
                    type: 'string',
                  },
                  Translation: {
                    type: 'string',
                  },
                },
              },
            },
          },
        },
        Surah: {
          type: 'object',
          properties: {
            number: {
              type: 'integer',
              example: 1,
            },
            name: {
              type: 'string',
              example: 'Al-Fatiha',
            },
            arabic: {
              type: 'string',
              example: 'الفاتحة',
            },
            ayahs: {
              type: 'integer',
              example: 7,
            },
            type: {
              type: 'string',
              example: 'Meccan',
            },
          },
        },
      },
      parameters: {
        Language: {
          name: 'language',
          in: 'path',
          required: true,
          description: 'Language code',
          schema: {
            type: 'string',
            enum: ['bangla', 'hindi', 'tamil', 'urdu', 'english', 'malayalam', 'mal', 'hi', 'bn', 'e', 'en'],
            example: 'bangla',
          },
        },
        Surah: {
          name: 'surah',
          in: 'path',
          required: true,
          description: 'Surah number (1-114)',
          schema: {
            type: 'integer',
            minimum: 1,
            maximum: 114,
            example: 1,
          },
        },
        Ayah: {
          name: 'ayah',
          in: 'path',
          required: true,
          description: 'Ayah/verse number',
          schema: {
            type: 'integer',
            minimum: 1,
            example: 1,
          },
        },
        Range: {
          name: 'range',
          in: 'path',
          required: true,
          description: 'Ayah range (e.g., "1-7" or "1")',
          schema: {
            type: 'string',
            example: '1-7',
          },
        },
        NoteId: {
          name: 'noteId',
          in: 'path',
          required: true,
          description: 'Note ID (can be numeric or alphanumeric like "N53")',
          schema: {
            type: 'string',
            example: '1',
          },
        },
        FootnoteId: {
          name: 'footnoteId',
          in: 'path',
          required: true,
          description: 'Footnote ID',
          schema: {
            type: 'integer',
            example: 176997,
          },
        },
        RuleNo: {
          name: 'ruleNo',
          in: 'path',
          required: true,
          description: 'Tajweed rule number (use "0" for all main rules)',
          schema: {
            type: 'string',
            example: '0',
          },
        },
        ArticleId: {
          name: 'articleId',
          in: 'path',
          required: true,
          description: 'Article ID',
          schema: {
            type: 'integer',
            example: 1,
          },
        },
        PageId: {
          name: 'pageId',
          in: 'path',
          required: false,
          description: 'Page ID',
          schema: {
            type: 'integer',
            example: 1,
          },
        },
        Query: {
          name: 'q',
          in: 'query',
          required: true,
          description: 'Search query',
          schema: {
            type: 'string',
            example: 'الله',
          },
        },
      },
    },
  },
  apis: ['./routes/*.js', './server.js'], // Path to the API files
};

const swaggerSpec = swaggerJsdoc(options);

module.exports = swaggerSpec;


