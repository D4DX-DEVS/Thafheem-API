const { verifyFirebaseUser } = require('./firebaseAuth');

// Bookmarks/favorites take userId from the client (query/body/params), so anyone
// can read or delete anyone else's rows. This verifies the Firebase token and
// overwrites the client-supplied userId with the one from the token.
//
// ponytail: gated by REQUIRE_USER_AUTH so it can be turned on the moment the
// web/app clients start sending `Authorization: Bearer <idToken>`. Delete the
// gate (and this comment) once they do.
const requireUser = (req, res, next) => {
  if (process.env.REQUIRE_USER_AUTH !== 'true') return next();

  verifyFirebaseUser(req, res, () => {
    const uid = req.firebaseUser.uid;
    if (req.query.userId) req.query.userId = uid;
    if (req.body && req.body.userId) req.body.userId = uid;
    if (req.params.userId) req.params.userId = uid;
    next();
  });
};

module.exports = { requireUser };
