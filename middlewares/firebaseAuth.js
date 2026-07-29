const { initializeApp, getApps } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');

// Token verification only needs the project id (uses Google's public certs),
// no service account required.
if (!getApps().length) {
  initializeApp({
    projectId: process.env.FIREBASE_PROJECT_ID || 'thafheem-ul-quran',
  });
}

/**
 * Verifies a Firebase ID token from the Authorization header and, when the
 * route has a :uid param, ensures the token belongs to that user.
 */
const verifyFirebaseUser = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'No token provided',
      });
    }

    const decoded = await getAuth().verifyIdToken(authHeader.substring(7));

    if (req.params.uid && decoded.uid !== req.params.uid) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Token does not match requested user',
      });
    }

    req.firebaseUser = decoded;
    return next();
  } catch (error) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid or expired token',
    });
  }
};

module.exports = { verifyFirebaseUser };
