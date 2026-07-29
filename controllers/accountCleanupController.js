const accountCleanupService = require('../services/accountCleanupService');

const isValidUid = (uid) => {
  if (typeof uid !== 'string') {
    return false;
  }

  const trimmed = uid.trim();
  if (!trimmed) {
    return false;
  }

  // Firebase UIDs are URL-safe strings. Keep validation permissive but bounded.
  return trimmed.length <= 128 && /^[A-Za-z0-9:_-]+$/.test(trimmed);
};

const deleteUserData = async (req, res, next) => {
  try {
    const { uid } = req.params;

    if (!isValidUid(uid)) {
      return res.status(400).json({
        error: 'Invalid uid parameter'
      });
    }

    const result = await accountCleanupService.deleteUserData(uid);

    return res.status(200).json({
      success: true,
      message: 'User-scoped data cleanup completed',
      ...result
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  deleteUserData
};
