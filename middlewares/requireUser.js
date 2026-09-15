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
    // Set unconditionally, not only when the client already sent a userId:
    // otherwise a request that simply omits it falls through with no owner at
    // all and the controller has to guess. The token is the only source here.
    // NB: this mutates req.query in place, which works on Express 4. Express 5
    // turns req.query into a getter that re-parses the URL on every access, so
    // an upgrade would silently drop this and hand the client's value back.
    if (req.query) req.query.userId = uid;
    if (req.body) req.body.userId = uid;
    if (req.params) req.params.userId = uid;
    next();
  });
};

module.exports = { requireUser };
