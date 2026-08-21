const express = require('express');
const router = express.Router();
const bookmarkController = require('../controllers/bookmarkController');
const { requireUser } = require('../middlewares/requireUser');
const { writeLimiter } = require('../middlewares/security');

// ─── Bookmarks ───────────────────────────────────────────────────────────────
router.get('/bookmarks', requireUser, bookmarkController.getBookmarks);
router.post('/bookmarks', writeLimiter, requireUser, bookmarkController.addBookmark);
router.delete('/bookmarks/delete/:id', writeLimiter, requireUser, bookmarkController.deleteBookmark);

// ─── Favorites ───────────────────────────────────────────────────────────────
router.get('/favorites', requireUser, bookmarkController.getFavorites);
router.post('/favorites', writeLimiter, requireUser, bookmarkController.addFavorite);
router.delete('/favorites/:userId/:surahId', writeLimiter, requireUser, bookmarkController.deleteFavorite);

module.exports = router;
