const express = require('express');
const router  = express.Router();
const search  = require('../controllers/searchController');
const { searchLimiter } = require('../middlewares/security');

// Search hits LIKE '%..%' scans — limit it before anything else.
router.use(searchLimiter);

// ── Arabic phrase search ────────────────────────────────────────────────────
// GET /api/search/arabic-phrase?q=<arabic>&page=1&limit=10
router.get('/arabic-phrase', search.searchArabicPhrase);

// ── Malayalam / English text search ────────────────────────────────────────
// GET /api/search/text?q=...&lang=mal|eng&type=translation|interpretation&page=1&limit=10
router.get('/text', search.searchText);

// ── Quran subjects ─────────────────────────────────────────────────────────
// GET /api/search/quran-subjects?q=...&lang=mal|eng&page=1&limit=20
router.get('/quran-subjects', search.searchQuranSubjects);

// GET /api/search/quran-subject-results/:subjectId?lang=mal|eng&page=1&limit=20
router.get('/quran-subject-results/:subjectId', search.getQuranSubjectResults);

// ── Tafseer subjects ───────────────────────────────────────────────────────
// GET /api/search/tafseer-subjects?q=...&page=1&limit=20
router.get('/tafseer-subjects', search.searchTafseerSubjects);

// GET /api/search/tafseer-subject-results/:subjectId?page=1&limit=20
router.get('/tafseer-subject-results/:subjectId', search.getTafseerSubjectResults);

// ── Word meaning search (home page qwm tables) ───────────────────────────
// GET /api/search/word-meaning?q=...&lang=mal|eng&page=1&limit=10
router.get('/word-meaning', search.searchWordMeaning);
// ── Arabic root search ──────────────────────────────────────────────────────
// GET /api/search/roots?q=<arabic>&page=1&limit=10
router.get('/roots', search.searchRoots);
// GET /api/search/roots-seed?limit=20
router.get('/roots-seed', search.getRootSeeds);
// ── Root word search ──────────────────────────────────────────────────────
// GET /api/search/root-word-forms/:rootGroupId
router.get('/root-word-forms/:rootGroupId', search.getRootWordForms);

// GET /api/search/root-word-verses/:rootGroupId?page=1&limit=10
router.get('/root-word-verses/:rootGroupId', search.getRootWordVerses);

// GET /api/search/rootwords/:rootGroupId?page=1&limit=10
router.get('/rootwords/:rootGroupId', search.getRootWordBundle);

// ── Glossary ──────────────────────────────────────────────────────────────
// GET /api/search/glossary
router.get('/glossary', search.getGlossaryEntries);

module.exports = router;
