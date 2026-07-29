const express = require('express');
const router = express.Router();
const bookmarkController = require('../controllers/bookmarkController');

// ─── Bookmarks ───────────────────────────────────────────────────────────────
router.get('/bookmarks', bookmarkController.getBookmarks);
router.post('/bookmarks', bookmarkController.addBookmark);
router.delete('/bookmarks/delete/:id', bookmarkController.deleteBookmark);

// ─── Favorites ───────────────────────────────────────────────────────────────
router.get('/favorites', bookmarkController.getFavorites);
router.post('/favorites', bookmarkController.addFavorite);
router.delete('/favorites/:userId/:surahId', bookmarkController.deleteFavorite);

module.exports = router;
