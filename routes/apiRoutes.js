const express = require('express');
const router = express.Router();
const translationController = require('../controllers/translationController');
const notesController = require('../controllers/notesController');
const mediaController = require('../controllers/mediaController');
const bookmarkRoutes = require('./bookmarkRoutes');
const feedbackRoutes = require('./feedbackRoutes');
const quizController = require('../controllers/quizController');
const accountCleanupController = require('../controllers/accountCleanupController');
const searchRoutes = require('./searchRoutes');
const { verifyFirebaseUser } = require('../middlewares/firebaseAuth');

/**
 * @swagger
 * /api/health:
 *   get:
 *     summary: Health check endpoint
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: API is healthy
 */

// TODO: Enable Redis caching later when needed
// Uncomment the lines below and set REDIS_ENABLED=true in .env to enable caching
// const { cacheMiddleware } = require('../middlewares/cache');
// const shortCache = cacheMiddleware(300);      // 5 minutes - for frequently updated content
// const longCache = cacheMiddleware(3600);      // 1 hour - for translations, interpretations
// const dayCache = cacheMiddleware(86400);       // 24 hours - for Arabic text (never changes)

// Placeholder middleware that does nothing (when Redis is disabled)
const noCache = (req, res, next) => next();
const shortCache = noCache;
const longCache = noCache;
const dayCache = noCache;

router.use('/search', searchRoutes);
router.use('/', bookmarkRoutes);
router.use('/', feedbackRoutes);

// Public config endpoint — serves analytics SDK config to the frontend
router.get('/config/analytics', (req, res) => {
  res.json({
    apiKey: process.env.ANALYTICS_API_KEY || '',
    baseUrl: process.env.ANALYTICS_BASE_URL || '',
  });
});

/**
 * @swagger
 * /api/notes/{noteId}:
 *   get:
 *     summary: Get note by ID
 *     tags: [Notes]
 *     parameters:
 *       - $ref: '#/components/parameters/NoteId'
 *     responses:
 *       200:
 *         description: Note retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                 NoteText:
 *                   type: string
 *                 note_text:
 *                   type: string
 *                 content:
 *                   type: string
 *       404:
 *         description: Note not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
// Notes route - short cache (might be updated)
router.get('/notes/:noteId', shortCache, notesController.getNoteById);

/**
 * @swagger
 * /api/media/{noteNo}:
 *   get:
 *     summary: Get media by NoteNo
 *     tags: [Media]
 *     parameters:
 *       - name: noteNo
 *         in: path
 *         required: true
 *         description: Note number (e.g., M1, M2, M3)
 *         schema:
 *           type: string
 *           example: M1
 *     responses:
 *       200:
 *         description: Media retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   mediasubject:
 *                     type: string
 *                   Mediafile:
 *                     type: string
 *       400:
 *         description: Invalid NoteNo
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: Media not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
// Media route - short cache (might be updated)
router.get('/media/:noteNo', shortCache, mediaController.getMediaByNoteNo);

/**
 * @swagger
 * /api/suranames/all:
 *   get:
 *     summary: Get all surah names
 *     tags: [Surah Info]
 *     responses:
 *       200:
 *         description: List of all surahs
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Surah'
 */
// Surah names route - long cache (rarely changes)
router.get('/suranames/all', longCache, translationController.getAllSurahNames);

/**
 * @swagger
 * /api/suranames/{language}:
 *   get:
 *     summary: Get all surah names in a specific language
 *     tags: [Surah Info]
 *     parameters:
 *       - name: language
 *         in: path
 *         required: true
 *         description: Language code (bangla, hindi, tamil, urdu, english, malayalam)
 *         schema:
 *           type: string
 *           enum: ['bangla', 'hindi', 'tamil', 'urdu', 'english', 'malayalam', 'bn', 'hi', 'ta', 'ur', 'en', 'e', 'mal', 'ml']
 *     responses:
 *       200:
 *         description: List of all surahs in the specified language
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   SuraID:
 *                     type: integer
 *                   ASuraName:
 *                     type: string
 *                   SuraName:
 *                     type: string
 *                   TotalAyas:
 *                     type: integer
 *                   SuraType:
 *                     type: string
 *       400:
 *         description: Invalid language
 *       404:
 *         description: No surah data found
 */
// Surah names by language route - long cache (rarely changes)
router.get('/suranames/:language', longCache, translationController.getSurahNamesByLanguage);

// Sujud ayahs by language route - long cache (rarely changes)
router.get('/sujud-ayahs/:language', longCache, translationController.getSujudAyahsByLanguage);

/**
 * @swagger
 * /api/pageranges/all:
 *   get:
 *     summary: Get all page ranges
 *     tags: [Surah Info]
 *     responses:
 *       200:
 *         description: Page ranges retrieved successfully
 */
// Page ranges route - long cache (rarely changes)
router.get('/pageranges/all', longCache, translationController.getAllPageRanges);

/**
 * @swagger
 * /api/pageranges/{pageId}:
 *   get:
 *     summary: Get page range by page ID
 *     tags: [Surah Info]
 *     parameters:
 *       - $ref: '#/components/parameters/PageId'
 *     responses:
 *       200:
 *         description: Page range retrieved successfully
 */
router.get('/pageranges/:pageId', longCache, translationController.getPageRangeById);

/**
 * @swagger
 * /api/urdu/footnote/{footnoteId}:
 *   get:
 *     summary: Get Urdu footnote by ID
 *     tags: [Footnotes]
 *     parameters:
 *       - $ref: '#/components/parameters/FootnoteId'
 *     responses:
 *       200:
 *         description: Footnote retrieved successfully
 *       404:
 *         description: Footnote not found
 */
// Special footnote routes for Urdu, English, and Malayalam - long cache (rarely changes)
router.get('/urdu/footnote/:footnoteId', longCache, translationController.getUrduFootnote);

/**
 * @swagger
 * /api/english/footnote/{footnoteId}:
 *   get:
 *     summary: Get English footnote by ID
 *     tags: [Footnotes]
 *     parameters:
 *       - $ref: '#/components/parameters/FootnoteId'
 *     responses:
 *       200:
 *         description: Footnote retrieved successfully
 *       404:
 *         description: Footnote not found
 */
router.get('/english/footnote/:footnoteId', longCache, translationController.getEnglishFootnote);

/**
 * @swagger
 * /api/english/finality-of-prophethood/footnote/{footnoteId}:
 *   get:
 *     summary: Get English finality of prophethood footnote by ID
 *     tags: [Footnotes]
 *     parameters:
 *       - name: footnoteId
 *         in: path
 *         required: true
 *         description: Footnote ID from engparisamapthi_footnotes table
 *         schema:
 *           type: integer
 *           example: 1
 *     responses:
 *       200:
 *         description: Footnote retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 footnote_id:
 *                   type: integer
 *                 footnote_text:
 *                   type: string
 *       400:
 *         description: Invalid footnote ID
 *       404:
 *         description: Footnote not found
 */
router.get('/english/finality-of-prophethood/footnote/:footnoteId', longCache, translationController.getEnglishFinalityFootnote);

/**
 * @swagger
 * /api/english/footnotes/count:
 *   get:
 *     summary: Get count of English footnotes
 *     tags: [Footnotes]
 *     responses:
 *       200:
 *         description: Count retrieved successfully
 */
router.get('/english/footnotes/count', translationController.checkEnglishFootnotesCount);

/**
 * @swagger
 * /api/malayalam/footnote/{footnoteId}:
 *   get:
 *     summary: Get Malayalam footnote by ID
 *     tags: [Footnotes]
 *     parameters:
 *       - $ref: '#/components/parameters/FootnoteId'
 *     responses:
 *       200:
 *         description: Footnote retrieved successfully
 *       404:
 *         description: Footnote not found
 */
router.get('/malayalam/footnote/:footnoteId', longCache, translationController.getMalayalamFootnote);
router.get('/mal/footnote/:footnoteId', longCache, translationController.getMalayalamFootnote);
router.get('/english/interpretation/:surah/:interpretationNo', longCache, translationController.getEnglishInterpretationBySurahAndNo);
router.get('/malayalam/interpretation/:surah/:interpretationNo', longCache, translationController.getMalayalamInterpretationBySurahAndNo);
router.get('/mal/interpretation/:surah/:interpretationNo', longCache, translationController.getMalayalamInterpretationBySurahAndNo);
router.get('/malayalam/interpretations-by-ayah/:surah/:ayah', longCache, translationController.getMalayalamInterpretationsByAyah);

// Urdu audio routes - long cache (rarely changes)
router.get('/urdu/translation-audio/:surah/:ayah?', longCache, translationController.getUrduTranslationAudio);
router.get('/urdu/interpretation-audio/:surah/:ayah?', longCache, translationController.getUrduInterpretationAudio);
router.get('/urdu/surah-intro-audio/:surah', longCache, translationController.getUrduSurahIntroAudio);
// ─── Quiz routes (must be before /:language wildcard) ───────────────────────
router.get('/quiz/surah/:surahId',        noCache, quizController.getSurahQuizPaginated);
router.get('/quiz/tafheem',               noCache, quizController.getTafheemQuizPaginated);
router.get('/quiz/block/:surahId/:from/:to', noCache, quizController.getBlockQuiz);
router.delete('/quiz/cache/:surahId?',           quizController.clearQuizCache);

// User data cleanup route (used during account deletion)
router.delete('/users/:uid/data', noCache, verifyFirebaseUser, accountCleanupController.deleteUserData);

router.get('/:language/quranaya/:surah/:ayah?', longCache, translationController.getMalayalamQuranAya);
router.get('/:language/appendix', longCache, translationController.getAppendix);
// Urdu content routes - long cache (rarely changes)
router.get('/urdu/finality-of-prophethood', longCache, translationController.getUrduFinalityOfProphethood);
router.get('/urdu/finality-of-prophethood/footnote/:footnoteId', longCache, translationController.getUrduFinalityFootnote);
router.get('/urdu/jesus-mohammed', longCache, translationController.getUrduJesusMohammed);

// Malayalam content routes - long cache (rarely changes)
router.get('/malayalam/jesus-mohammed', longCache, translationController.getMalayalamJesusMohammed);
router.get('/mal/jesus-mohammed', longCache, translationController.getMalayalamJesusMohammed);

// Hindi content routes - long cache (rarely changes)
router.get('/hindi/jesus-mohammed', longCache, translationController.getHindiJesusMohammed);
router.get('/hi/jesus-mohammed', longCache, translationController.getHindiJesusMohammed);
router.get('/hindi/introduction-to-quran', longCache, translationController.getHindiIntroductionToQuran);
router.get('/hi/introduction-to-quran', longCache, translationController.getHindiIntroductionToQuran);
router.get('/hindi/finality-of-prophethood', longCache, translationController.getHindiFinalityOfProphethood);
router.get('/hi/finality-of-prophethood', longCache, translationController.getHindiFinalityOfProphethood);

// English content routes - long cache (rarely changes)
router.get('/english/jesus-mohammed', longCache, translationController.getEnglishJesusMohammed);
router.get('/english/introduction-to-quran', longCache, translationController.getEnglishIntroductionToQuran);
router.get('/english/finality-of-prophethood', longCache, translationController.getEnglishFinalityOfProphethood);

// Bangla content routes - long cache (rarely changes)
router.get('/bangla/jesus-mohammed', longCache, translationController.getBanglaJesusMohammed);
router.get('/bn/jesus-mohammed', longCache, translationController.getBanglaJesusMohammed);

// Tamil content routes - long cache (rarely changes)
router.get('/tamil/jesus-mohammed', longCache, translationController.getTamilJesusMohammed);
router.get('/ta/jesus-mohammed', longCache, translationController.getTamilJesusMohammed);
router.get('/bangla/introduction-to-quran', longCache, translationController.getBanglaIntroductionToQuran);
router.get('/bn/introduction-to-quran', longCache, translationController.getBanglaIntroductionToQuran);
router.get('/bangla/finality-of-prophethood', longCache, translationController.getBanglaFinalityOfProphethood);
router.get('/bn/finality-of-prophethood', longCache, translationController.getBanglaFinalityOfProphethood);
router.get('/malayalam/finality-of-prophethood', longCache, translationController.getMalayalamFinalityOfProphethood);
router.get('/mal/finality-of-prophethood', longCache, translationController.getMalayalamFinalityOfProphethood);
router.get('/malayalam/introduction-to-quran', longCache, translationController.getMalayalamIntroductionToQuran);
router.get('/mal/introduction-to-quran', longCache, translationController.getMalayalamIntroductionToQuran);

// Tamil content routes - long cache (rarely changes)
router.get('/tamil/introduction-to-quran', longCache, translationController.getTamilIntroductionToQuran);
router.get('/ta/introduction-to-quran', longCache, translationController.getTamilIntroductionToQuran);
router.get('/tamil/finality-of-prophethood', longCache, translationController.getTamilFinalityOfProphethood);
router.get('/ta/finality-of-prophethood', longCache, translationController.getTamilFinalityOfProphethood);
router.get('/malayalam/technical-terms', longCache, translationController.getMalayalamTechnicalTerms);
router.get('/mal/technical-terms', longCache, translationController.getMalayalamTechnicalTerms);
router.get('/technical-terms/:language', longCache, translationController.getTechnicalTermsByLanguage);
router.get('/malayalam/translators', longCache, translationController.getMalayalamTranslators);
router.get('/mal/translators', longCache, translationController.getMalayalamTranslators);
router.get('/malayalam/history-of-translation', longCache, translationController.getMalayalamHistoryOfTranslation);
router.get('/mal/history-of-translation', longCache, translationController.getMalayalamHistoryOfTranslation);

// Article routes - long cache (rarely changes)
router.get('/article/:articleId', longCache, translationController.getArticleById);

/**
 * @swagger
 * /api/arabic/text/{surah}/{ayah}:
 *   get:
 *     summary: Get Arabic text for a specific ayah
 *     tags: [Arabic Text]
 *     parameters:
 *       - $ref: '#/components/parameters/Surah'
 *       - $ref: '#/components/parameters/Ayah'
 *     responses:
 *       200:
 *         description: Arabic text retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 surah:
 *                   type: integer
 *                 ayah:
 *                   type: integer
 *                 text_uthmani:
 *                   type: string
 *                   description: Uthmani script
 *                 text_simple:
 *                   type: string
 *                   description: Simple script
 *       404:
 *         description: Arabic text not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
// Arabic text route - day cache (never changes)
router.get('/arabic/text/:surah/:ayah', dayCache, translationController.getArabicText);

/**
 * @swagger
 * /api/arabic/surah/{surah}:
 *   get:
 *     summary: Get all Arabic verses for a complete surah
 *     tags: [Arabic Text]
 *     parameters:
 *       - $ref: '#/components/parameters/Surah'
 *     responses:
 *       200:
 *         description: Arabic verses retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 surah:
 *                   type: integer
 *                 count:
 *                   type: integer
 *                 verses:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       ayah:
 *                         type: integer
 *                       text_uthmani:
 *                         type: string
 *                       text_simple:
 *                         type: string
 */
router.get('/arabic/surah/:surah', dayCache, translationController.getArabicSurahVerses);

/**
 * @swagger
 * /api/{language}/translation/{surah}/{ayah}:
 *   get:
 *     summary: Get translation for a specific ayah
 *     tags: [Translation]
 *     parameters:
 *       - $ref: '#/components/parameters/Language'
 *       - $ref: '#/components/parameters/Surah'
 *       - $ref: '#/components/parameters/Ayah'
 *     responses:
 *       200:
 *         description: Translation retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Translation'
 *       400:
 *         description: Invalid language or parameters
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: Translation not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
// Translation routes (supports: bangla, hindi, tamil, urdu, english) - long cache
router.get('/:language/translation/:surah/:ayah', longCache, translationController.getTranslation);

/**
 * @swagger
 * /api/{language}/surah/{surah}:
 *   get:
 *     summary: Get all translations for a complete surah
 *     tags: [Translation]
 *     parameters:
 *       - $ref: '#/components/parameters/Language'
 *       - $ref: '#/components/parameters/Surah'
 *     responses:
 *       200:
 *         description: Surah translations retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 language:
 *                   type: string
 *                 surah:
 *                   type: integer
 *                 count:
 *                   type: integer
 *                 translations:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Translation'
 */
router.get('/:language/surah/:surah', longCache, translationController.getSurahTranslations);

/**
 * @swagger
 * /api/ayatransl/{surah}/{range}/{language}:
 *   get:
 *     summary: Get blockwise translation for ayah range
 *     tags: [Blockwise]
 *     parameters:
 *       - $ref: '#/components/parameters/Surah'
 *       - $ref: '#/components/parameters/Range'
 *       - $ref: '#/components/parameters/Language'
 *     responses:
 *       200:
 *         description: Blockwise translation retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 surah:
 *                   type: integer
 *                 range:
 *                   type: string
 *                 language:
 *                   type: string
 *                 translations:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Translation'
 */
// Blockwise translation route (supports ranges like 1-7) - long cache
router.get('/ayatransl/:surah/:range/:language', longCache, translationController.getBlockwiseTranslation);

/**
 * @swagger
 * /api/{language}/ayaranges/{surah}:
 *   get:
 *     summary: Get ayah ranges for blockwise reading
 *     tags: [Blockwise]
 *     parameters:
 *       - $ref: '#/components/parameters/Language'
 *       - $ref: '#/components/parameters/Surah'
 *     responses:
 *       200:
 *         description: Ayah ranges retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 surah:
 *                   type: integer
 *                 ranges:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       range:
 *                         type: string
 *                         example: "1-7"
 */
router.get('/:language/ayaranges/:surah', longCache, translationController.getAyaRanges);

/**
 * @swagger
 * /api/{language}/interpretation/{surah}/{ayah}:
 *   get:
 *     summary: Get interpretation/explanation for a specific ayah
 *     tags: [Interpretation]
 *     parameters:
 *       - $ref: '#/components/parameters/Language'
 *       - $ref: '#/components/parameters/Surah'
 *       - $ref: '#/components/parameters/Ayah'
 *       - name: explanationNo
 *         in: query
 *         required: false
 *         description: Specific explanation number (optional)
 *         schema:
 *           type: integer
 *           example: 1
 *     responses:
 *       200:
 *         description: Interpretation retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Interpretation'
 *       400:
 *         description: Invalid language (interpretations only available for bangla and hindi)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: Interpretation not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
// Interpretation routes - long cache (rarely changes)
router.get('/:language/interpretation/:surah/:ayah', longCache, translationController.getInterpretation);

/**
 * @swagger
 * /api/{language}/word-by-word/{surah}/{ayah}:
 *   get:
 *     summary: Get word-by-word translation and meanings
 *     tags: [Word-by-Word]
 *     parameters:
 *       - $ref: '#/components/parameters/Language'
 *       - $ref: '#/components/parameters/Surah'
 *       - $ref: '#/components/parameters/Ayah'
 *     responses:
 *       200:
 *         description: Word-by-word data retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/WordByWord'
 *       400:
 *         description: Invalid language or parameters
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
// Word-by-word routes - long cache (never changes)
router.get('/:language/word-by-word/:surah/:ayah', longCache, translationController.getWordByWord);

/**
 * @swagger
 * /api/{language}/word-search:
 *   get:
 *     summary: Search for words in translations
 *     tags: [Search]
 *     parameters:
 *       - $ref: '#/components/parameters/Language'
 *       - $ref: '#/components/parameters/Query'
 *     responses:
 *       200:
 *         description: Search results retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 language:
 *                   type: string
 *                 query:
 *                   type: string
 *                 count:
 *                   type: integer
 *                 results:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       surah:
 *                         type: integer
 *                       ayah:
 *                         type: integer
 *                       word:
 *                         type: string
 *                       meaning:
 *                         type: string
 *       400:
 *         description: Invalid query or language
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
// Word search routes - long cache
// Use query parameter to handle special characters like colons in search terms
router.get('/:language/word-search', longCache, translationController.searchWords);

/**
 * @swagger
 * /api/chapter-info/{surah}/{language}:
 *   get:
 *     summary: Get chapter/surah information
 *     tags: [Surah Info]
 *     parameters:
 *       - $ref: '#/components/parameters/Surah'
 *       - name: language
 *         in: path
 *         required: false
 *         description: Language for chapter info
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Chapter info retrieved successfully
 */
// Chapter info route - long cache (rarely changes)
router.get('/chapter-info/:surah/:language?', longCache, translationController.getChapterInfo);

/**
 * @swagger
 * /api/preface/{surah}/{language}:
 *   get:
 *     summary: Get Thafheem preface for a surah
 *     tags: [Content Pages]
 *     parameters:
 *       - $ref: '#/components/parameters/Surah'
 *       - name: language
 *         in: path
 *         required: false
 *         description: Language code (M, E, malayalam, english, mal, en)
 *         schema:
 *           type: string
 *           enum: ['M', 'E', 'malayalam', 'english', 'mal', 'en']
 *           example: 'E'
 *     responses:
 *       200:
 *         description: Preface retrieved successfully
 */
// Preface route (Thafheem preface) - long cache (rarely changes)
// Supports: /api/preface/:surah/:language (language: M, E, malayalam, english, mal, en)
router.get('/preface/:surah/:language?', longCache, translationController.getPreface);

// Blockwise Malayalam surah intro (status=0 rows from preface table - with Arabic script)
router.get('/malayalam/surah-intro/:surah', longCache, translationController.getMalayalamSurahIntro);
router.get('/mal/surah-intro/:surah', longCache, translationController.getMalayalamSurahIntro);

// Surah metadata (names/type/count) from suratable
router.get('/surah-metadata/:surah/:language?', longCache, translationController.getSurahMetadata);

// Hindi surah intro (fallback source)
router.get('/hindi/surah-intro/:surah', longCache, translationController.getHindiSurahIntro);

// Urdu surah intro from urdu_intro table
router.get('/urdu/surah-intro/:surah', longCache, translationController.getUrduSurahIntro);

// Bangla surah intro from bangla_intro table
router.get('/bangla/surah-intro/:surah', longCache, translationController.getBanglaSurahIntro);
router.get('/bn/surah-intro/:surah', longCache, translationController.getBanglaSurahIntro);

// Tamil surah intro from tamil_intro table
router.get('/tamil/surah-intro/:surah', longCache, translationController.getTamilSurahIntro);

/**
 * @swagger
 * /api/thajweedrules/{ruleNo}:
 *   get:
 *     summary: Get Tajweed rules
 *     tags: [Tajweed]
 *     description: Use ruleNo="0" to get all main rules, or specific rule number for sub-rules
 *     parameters:
 *       - $ref: '#/components/parameters/RuleNo'
 *     responses:
 *       200:
 *         description: Tajweed rules retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ruleNo:
 *                   type: string
 *                 rules:
 *                   type: array
 *                   items:
 *                     type: object
 *       404:
 *         description: Rule not found
 */
// Tajweed rules routes (supports both /thajweedrules and /tajweedrules for compatibility)
// GET /api/thajweedrules/0 - get all main rules
// GET /api/thajweedrules/:ruleNo - get specific rule or sub-rules - long cache (never changes)
router.get('/thajweedrules/:ruleNo', longCache, translationController.getTajweedRules);
router.get('/tajweedrules/:ruleNo', longCache, translationController.getTajweedRules);

// Tajweed word images (color-coded words from tajweed_words table)
// GET /api/tajweed/lines/:suraid  → glyphs grouped into Mushaf lines (page layout)
// GET /api/tajweed/:suraid        → all words for surah, grouped by ayah
// GET /api/tajweed/:suraid/:ayaid → words for single ayah
router.get('/tajweed/lines/:suraid', longCache, translationController.getTajweedLines);
router.get('/tajweed/:suraid/:ayaid', longCache, translationController.getTajweedWords);
router.get('/tajweed/:suraid', longCache, translationController.getTajweedWords);

/**
 * @swagger
 * /api/{language}/health:
 *   get:
 *     summary: Health check for specific language database
 *     tags: [Health]
 *     parameters:
 *       - $ref: '#/components/parameters/Language'
 *     responses:
 *       200:
 *         description: Language database is healthy
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: "OK"
 *                 language:
 *                   type: string
 *                 database:
 *                   type: object
 *                   properties:
 *                     status:
 *                       type: string
 *       500:
 *         description: Database connection error
 */
// Health check for specific language
router.get('/:language/health', translationController.checkLanguageHealth);

module.exports = router;

