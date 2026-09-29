// Guards footnote links on the English "Finality of Prophethood" page. In section 7
// the DB text reads "(see \nfootnote [5])" inside a tab-indented paragraph, so the
// markdown render splits "(see" from "footnote [5]"; the marker must still become
// a clickable <sup data-footnote-id="5">.
// Run: node controllers/englishFinalityFootnotes.test.js
const assert = require('assert');

// Stub the pool before the controller requires it, so this test needs no DB.
const dbPath = require.resolve('./../config/database');
const rows = [
  {
    aid: 7,
    title: 'The Promised Messiah',
    matter:
      'Traditions Relating to the Descent of Christ, Son of Mary\n\n' +
      '\tHe will break the cross and kill the swine;(see \nfootnote [5]) and he will put an end to war.\n\n' +
      '\tIn another tradition he will abolish the jizya. (see footnote[6])',
  },
];
require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: { query: async () => [rows] },
};

const translationController = require('./translationController');

const run = async () => {
  let body;
  const res = {
    status() { return this; },
    json(payload) { body = payload; return this; },
  };

  // The handler logs every footnote it links; keep the test output readable.
  const log = console.log;
  console.log = () => {};
  try {
    await translationController.getEnglishFinalityOfProphethood({ params: {}, query: {} }, res);
  } finally {
    console.log = log;
  }

  const { text } = body.sections[0];
  assert.ok(text.includes('data-footnote-id="5"'), 'footnote [5] split across blocks must be linked');
  assert.ok(text.includes('data-footnote-id="6"'), 'footnote[6] must stay linked');
  assert.strictEqual((text.match(/data-footnote-id=/g) || []).length, 2, 'each marker is linked exactly once');

  console.log('englishFinalityFootnotes.test.js: all assertions passed');
};

run().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
