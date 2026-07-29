const mysqlPool = require('../config/database');
const { sendFeedbackNotification, sendFeatureRequestNotification } = require('../services/emailService');

// Validation helpers
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_REGEX = /^\+?[\d\s\-()]{7,20}$/;
const VALID_PLATFORMS = ['website', 'android', 'ios', 'all'];
const VALID_RATINGS = ['excellent', 'good', 'average', 'poor'];
const VALID_TARGET_PLATFORMS = ['website', 'mobile', 'both'];
const VALID_CATEGORIES = ['ui_ux', 'content', 'performance', 'accessibility', 'other'];

const sanitize = (value, maxLength) => {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLength);
};

const submitFeedback = async (req, res) => {
  try {
    const { name, email, phone, platform, rating, message } = req.body;

    // Validate required fields
    const cleanName = sanitize(name, 100);
    const cleanEmail = sanitize(email, 255);
    const cleanPhone = sanitize(phone, 20);
    const cleanRating = sanitize(rating, 20).toLowerCase();
    const cleanMessage = sanitize(message, 5000);

    // Platform can be comma-separated (multi-select) — validate each value
    const cleanPlatform = sanitize(platform, 100).toLowerCase();
    const platformValues = cleanPlatform.split(',').map((p) => p.trim()).filter(Boolean);
    const invalidPlatforms = platformValues.filter((p) => !VALID_PLATFORMS.includes(p));

    if (!cleanName) return res.status(400).json({ error: 'Name is required' });
    if (!cleanEmail || !EMAIL_REGEX.test(cleanEmail)) return res.status(400).json({ error: 'Valid email is required' });
    if (cleanPhone && !PHONE_REGEX.test(cleanPhone)) return res.status(400).json({ error: 'Invalid phone number format' });
    if (!platformValues.length) return res.status(400).json({ error: 'At least one platform is required' });
    if (invalidPlatforms.length) return res.status(400).json({ error: `Invalid platform(s): ${invalidPlatforms.join(', ')}. Must be: website, android, ios, all` });
    if (!VALID_RATINGS.includes(cleanRating)) return res.status(400).json({ error: 'Rating must be one of: excellent, good, average, poor' });
    if (!cleanMessage) return res.status(400).json({ error: 'Message is required' });

    const platformString = platformValues.join(', ');
    const sql = `INSERT INTO feedback (name, email, phone, platform, rating, message) VALUES (?, ?, ?, ?, ?, ?)`;
    const params = [cleanName, cleanEmail, cleanPhone || null, platformString, cleanRating, cleanMessage];

    const [result] = await mysqlPool.query(sql, params);

    // Send email notification (non-blocking — don't await in response path)
    const source = sanitize(req.body.source || '', 20).toLowerCase();
    sendFeedbackNotification({ name: cleanName, email: cleanEmail, phone: cleanPhone, platform: cleanPlatform, rating: cleanRating, message: cleanMessage, source })
      .catch((err) => console.error('Email notification error:', err.message));

    return res.status(201).json({
      message: 'Feedback submitted successfully',
      id: result.insertId,
    });
  } catch (error) {
    console.error('Error submitting feedback:', error.message);
    return res.status(500).json({ error: 'Failed to submit feedback' });
  }
};

const submitFeatureRequest = async (req, res) => {
  try {
    const { name, email, phone, target_platform, category, title, description } = req.body;

    // Validate required fields
    const cleanName = sanitize(name, 100);
    const cleanEmail = sanitize(email, 255);
    const cleanPhone = sanitize(phone, 20);
    const cleanPlatform = sanitize(target_platform, 20).toLowerCase();
    const cleanCategory = sanitize(category, 20).toLowerCase();
    const cleanTitle = sanitize(title, 200);
    const cleanDescription = sanitize(description, 5000);

    if (!cleanName) return res.status(400).json({ error: 'Name is required' });
    if (!cleanEmail || !EMAIL_REGEX.test(cleanEmail)) return res.status(400).json({ error: 'Valid email is required' });
    if (!cleanPhone) return res.status(400).json({ error: 'Phone number is required' });
    if (!PHONE_REGEX.test(cleanPhone)) return res.status(400).json({ error: 'Invalid phone number format' });
    if (!VALID_TARGET_PLATFORMS.includes(cleanPlatform)) return res.status(400).json({ error: 'Target platform must be one of: website, mobile, both' });
    if (!VALID_CATEGORIES.includes(cleanCategory)) return res.status(400).json({ error: 'Category must be one of: ui_ux, content, performance, accessibility, other' });
    if (!cleanTitle) return res.status(400).json({ error: 'Feature title is required' });
    if (!cleanDescription) return res.status(400).json({ error: 'Feature description is required' });

    const sql = `INSERT INTO feature_requests (name, email, phone, target_platform, category, title, description) VALUES (?, ?, ?, ?, ?, ?, ?)`;
    const params = [cleanName, cleanEmail, cleanPhone, cleanPlatform, cleanCategory, cleanTitle, cleanDescription];

    const [result] = await mysqlPool.query(sql, params);

    // Send email notification (non-blocking)
    const source = sanitize(req.body.source || '', 20).toLowerCase();
    sendFeatureRequestNotification({ name: cleanName, email: cleanEmail, phone: cleanPhone, target_platform: cleanPlatform, category: cleanCategory, title: cleanTitle, description: cleanDescription, source })
      .catch((err) => console.error('Email notification error:', err.message));

    return res.status(201).json({
      message: 'Feature request submitted successfully',
      id: result.insertId,
    });
  } catch (error) {
    console.error('Error submitting feature request:', error.message);
    return res.status(500).json({ error: 'Failed to submit feature request' });
  }
};

module.exports = {
  submitFeedback,
  submitFeatureRequest,
};
