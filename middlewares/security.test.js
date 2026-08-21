// Smallest thing that fails if the limiter or the trusted-key bypass breaks.
// Run: node middlewares/security.test.js
const assert = require('assert');
const express = require('express');
const http = require('http');

process.env.RATE_LIMIT_READ = '3';
process.env.INTERNAL_API_KEY = 'test-key';
const { readLimiter } = require('./security');

const app = express();
app.use('/api', readLimiter, (req, res) => res.json({ ok: true }));
const server = app.listen(0, async () => {
  const url = `http://127.0.0.1:${server.address().port}/api/x`;
  const get = (headers) =>
    new Promise((r) => http.get(url, { headers }, (res) => { res.resume(); r(res.statusCode); }));

  assert.strictEqual(await get(), 200);
  assert.strictEqual(await get(), 200);
  assert.strictEqual(await get(), 200);
  assert.strictEqual(await get(), 429, 'limit must kick in on the 4th request');

  // Our own scrapers must not be throttled.
  for (let i = 0; i < 10; i++) {
    assert.strictEqual(await get({ 'x-internal-key': 'test-key' }), 200, 'internal key must bypass');
  }
  // Wrong key gets no bypass.
  assert.strictEqual(await get({ 'x-internal-key': 'nope' }), 429);

  console.log('security.test.js PASS');
  server.close();
});
