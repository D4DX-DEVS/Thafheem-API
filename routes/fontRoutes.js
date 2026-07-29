/**
 * fontRoutes.js
 * -------------
 * Serves the QCF V4 Tajweed page fonts (p1..p604.woff2) through our own origin.
 *
 * Why a proxy?  The fonts live on DigitalOcean Spaces, whose CDN does NOT send
 * `Access-Control-Allow-Origin`. Browsers require CORS headers for any font
 * loaded via @font-face, so the cross-origin requests were failing. This route
 * streams the (publicly readable) font from the CDN and adds the CORS + caching
 * headers the browser needs. No Spaces credentials are required.
 *
 * Mounted at app level as:  GET /fonts/tajweed/p:page.woff2
 */
const express = require('express');

const router = express.Router();

// Upstream = the DigitalOcean Spaces CDN where the fonts actually live.
// NOTE: do NOT use TAJWEED_FONT_CDN here — that variable holds the *public*
// URL of this very proxy (the API domain), which would make us fetch ourselves.
const SPACES_CDN = (process.env.DO_SPACES_CDN_ENDPOINT || 'https://d4dx-storage.blr1.cdn.digitaloceanspaces.com').replace(/\/+$/, '');
const SPACES_FOLDER = (process.env.DO_SPACES_FOLDER || 'THAFHEEM').replace(/^\/+|\/+$/g, '');
const CDN_BASE = `${SPACES_CDN}/${SPACES_FOLDER}/fonts/tajweed`;

router.get('/tajweed/p:page.woff2', async (req, res) => {
  const page = parseInt(req.params.page, 10);
  if (!Number.isInteger(page) || page < 1 || page > 604) {
    return res.status(400).json({ error: 'Invalid font page (1-604)' });
  }

  const upstream = `${CDN_BASE}/p${page}.woff2`;

  try {
    const cdnRes = await fetch(upstream);
    if (!cdnRes.ok || !cdnRes.body) {
      return res.status(cdnRes.status === 404 ? 404 : 502).json({
        error: 'Font not available',
        page,
      });
    }

    // Public static asset — safe to allow any origin and cache aggressively.
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'font/woff2');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    const len = cdnRes.headers.get('content-length');
    if (len) res.setHeader('Content-Length', len);

    const buf = Buffer.from(await cdnRes.arrayBuffer());
    return res.end(buf);
  } catch (err) {
    console.error(`❌ Tajweed font proxy error (p${page}):`, err.message);
    return res.status(502).json({ error: 'Font fetch failed', page });
  }
});

module.exports = router;
