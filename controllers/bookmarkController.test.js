// Guards the bookmark delete against id enumeration. `id` is AUTO_INCREMENT, so
// before the owner check anyone could walk 1, 2, 3... and wipe every user's
// bookmarks with no uid and no token.
// Run: node controllers/bookmarkController.test.js
const assert = require('assert');
const path = require('path');
const express = require('express');
const http = require('http');

// Stub the pool before the controller requires it, so this test needs no DB.
const dbPath = require.resolve('./../config/database');
const queries = [];
require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: {
    query: async (sql, params) => {
      queries.push({ sql, params });
      // Emulate MySQL: the row is only touched when both id and uid match.
      const [id, uid] = params;
      const owned = String(id) === '42' && uid === 'owner-uid';
      return [{ affectedRows: owned ? 1 : 0 }];
    },
  },
};

const bookmarkController = require('./bookmarkController');

const app = express();
app.use(express.json());
app.delete('/api/bookmarks/delete/:id', bookmarkController.deleteBookmark);

const server = app.listen(0, async () => {
  const port = server.address().port;
  const del = (pathname) =>
    new Promise((resolve) => {
      const req = http.request(
        { port, method: 'DELETE', path: pathname },
        (res) => {
          let body = '';
          res.on('data', (c) => (body += c));
          res.on('end', () => resolve({ status: res.statusCode, body }));
        },
      );
      req.end();
    });

  try {
    // 1. The old attack: bare id, no uid. Must be refused before touching SQL.
    const before = queries.length;
    const bare = await del('/api/bookmarks/delete/42');
    assert.strictEqual(bare.status, 400, 'delete without userId must be refused');
    assert.strictEqual(queries.length, before, 'no query may run without a userId');

    // 2. Right row, wrong owner. Reaches SQL but deletes nothing.
    const wrong = await del('/api/bookmarks/delete/42?userId=someone-else');
    assert.strictEqual(wrong.status, 404, 'another user must not be able to delete the row');

    // 3. The owner still deletes their own bookmark.
    const ok = await del('/api/bookmarks/delete/42?userId=owner-uid');
    assert.strictEqual(ok.status, 200, 'the owner must still be able to delete');
    assert.deepStrictEqual(JSON.parse(ok.body), { success: true });

    // 4. Every delete is scoped by uid in SQL, not filtered in JS afterwards.
    for (const q of queries) {
      assert.ok(
        /DELETE FROM bookmarks WHERE id = \? AND uid = \?/.test(q.sql),
        `delete must be scoped by uid in SQL, got: ${q.sql}`,
      );
      assert.strictEqual(q.params.length, 2, 'delete must bind both id and uid');
    }

    console.log('bookmarkController.test.js PASS');
    server.close();
  } catch (err) {
    console.error('bookmarkController.test.js FAIL');
    console.error(err.message);
    server.close();
    process.exitCode = 1;
  }
});
