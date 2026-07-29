const express = require('express');
const rateLimit = require('express-rate-limit');
const feedbackController = require('../controllers/feedbackController');

const router = express.Router();

// Rate limit: 5 submissions per 15 minutes per IP
const feedbackLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Too many submissions. Please try again after 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

router.post('/feedback', feedbackLimiter, feedbackController.submitFeedback);
router.post('/feature-request', feedbackLimiter, feedbackController.submitFeatureRequest);

module.exports = router;
