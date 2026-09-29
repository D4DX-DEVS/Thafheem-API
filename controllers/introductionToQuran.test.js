// Guards the audio_url on the Malayalam "Introduction to Quran" sections. The web
// page plays audio_url directly, so it must carry the stored audioUrl for every
// section that has one (section 1 has a recording but an empty transcript).
// Run: node controllers/introductionToQuran.test.js
const assert = require('assert');

const AUDIO = 'https://thafheem.net/audio/library';

// Stub the pool before the controller requires it, so this test needs no DB.
const dbPath = require.resolve('./../config/database');
const rows = [
  { aid: 1, title: 'കുറിപ്പ്', matter: 'note', audioText: '', audioUrl: `${AUDIO}/qp_1.mp3` },
  { aid: 2, title: 'മുഖവുര', matter: 'intro', audioText: 'transcript', audioUrl: `${AUDIO}/qp_2.ogg` },
  { aid: 3, title: 'ഗ്രന്ഥം', matter: 'book', audioText: 'transcript', audioUrl: '' },
  { aid: 4, title: 'അടിസ്ഥാനം', matter: 'base', audioText: 'transcript', audioUrl: null },
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

  await translationController.getMalayalamIntroductionToQuran({ params: {}, query: {} }, res);

  assert.strictEqual(body.count, 4);
  const audio = body.sections.map((s) => s.audio_url);
  assert.deepStrictEqual(audio, [`${AUDIO}/qp_1.mp3`, `${AUDIO}/qp_2.ogg`, null, null],
    'audio_url carries the stored audioUrl, and null when the row has none');

  console.log('introductionToQuran.test.js: all assertions passed');
};

run().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
