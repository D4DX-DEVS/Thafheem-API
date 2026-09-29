// The IDOR fix: with REQUIRE_USER_AUTH on, the owner must come from the verified
// token and never from what the client claims. Also pins the flag-off path, so
// turning this on is the only thing that changes behaviour.
// Run: node middlewares/requireUser.test.js
const assert = require('assert');
const express = require('express');
const http = require('http');

// Stub token verification so the test needs no Firebase credentials.
const authPath = require.resolve('./firebaseAuth');
require.cache[authPath] = {
  id: authPath,
  filename: authPath,
  loaded: true,
  exports: {
    verifyFirebaseUser: (req, res, next) => {
      const header = req.headers.authorization || '';
      if (!header.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      // The token encodes its own uid, the way a real decoded token would.
      req.firebaseUser = { uid: header.substring(7) };
      return next();
    },
  },
};

const { requireUser } = require('./requireUser');

const app = express();
app.use(express.json());
// Echo whatever the controller would end up trusting as the owner.
app.get('/bookmarks', requireUser, (req, res) => res.json({ owner: req.query.userId }));
app.delete('/favorites/:userId/:surahId', requireUser, (req, res) =>
  res.json({ owner: req.params.userId }));

const server = app.listen(0, async () => {
  const port = server.address().port;
  const call = (method, path, headers = {}) =>
    new Promise((resolve) => {
      const req = http.request({ port, method, path, headers }, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode, body }));
      });
      req.end();
    });

  try {
    // ── Flag off: today's production behaviour must be untouched ──
    delete process.env.REQUIRE_USER_AUTH;
    const off = await call('GET', '/bookmarks?userId=whoever');
    assert.strictEqual(off.status, 200, 'with the flag off nothing may be blocked');
    assert.strictEqual(JSON.parse(off.body).owner, 'whoever');

    // ── Flag on ──
    process.env.REQUIRE_USER_AUTH = 'true';

    const noToken = await call('GET', '/bookmarks?userId=victim-uid');
    assert.strictEqual(noToken.status, 401, 'no token must be rejected');

    // The attack: ask for someone else's data with your own valid token.
    const idor = await call('GET', '/bookmarks?userId=victim-uid', {
      authorization: 'Bearer attacker-uid',
    });
    assert.strictEqual(idor.status, 200);
    assert.strictEqual(
      JSON.parse(idor.body).owner,
      'attacker-uid',
      "the client's claimed userId must be replaced by the token's uid",
    );

    // Omitting userId entirely must still resolve to the token's uid.
    const omitted = await call('GET', '/bookmarks', { authorization: 'Bearer real-uid' });
    assert.strictEqual(JSON.parse(omitted.body).owner, 'real-uid');

    // Route params carry the uid too (DELETE /favorites/:userId/:surahId).
    const param = await call('DELETE', '/favorites/victim-uid/2', {
      authorization: 'Bearer attacker-uid',
    });
    assert.strictEqual(JSON.parse(param.body).owner, 'attacker-uid');

    delete process.env.REQUIRE_USER_AUTH;
    console.log('requireUser.test.js PASS');
    server.close();
  } catch (err) {
    console.error('requireUser.test.js FAIL');
    console.error(err.message);
    server.close();
    process.exitCode = 1;
  }
});
