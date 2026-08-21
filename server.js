const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env'), override: true });
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./config/swagger');
const apiRoutes = require('./routes/apiRoutes');
const documentationController = require('./controllers/documentationController');
const errorHandler = require('./middlewares/errorHandler');
const logger = require('./middlewares/logger');
const mysqlPool = require('./config/database');
const redisClient = require('./config/redis');
const gracefulShutdown = require('./utils/gracefulShutdown');

const { readLimiter } = require('./middlewares/security');

const app = express();
// Behind Nginx/Netlify/Render — needed so rate limits key on the real client IP.
app.set('trust proxy', 1);
const PORT = process.env.PORT || 5000;

console.log('🚀 Starting Thafheem API Server...');

// Tajweed page fonts (public static assets) — mounted BEFORE the credentialed
// CORS middleware so they are served with `Access-Control-Allow-Origin: *`,
// which is required for cross-origin @font-face loading.
const fontRoutes = require('./routes/fontRoutes');
app.use('/fonts', fontRoutes);

// Security headers. CSP off: it breaks Swagger UI at /doc; API serves JSON only.
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' } // fonts served cross-origin
}));

// CORS Configuration - Allow multiple origins
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:5175',
  'http://localhost:4173',
  'https://thafheem.net',
  'https://www.thafheem.net',
  'https://thafheemul-quran.netlify.app',
  process.env.FRONTEND_URL
].filter(Boolean); // Remove undefined values

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps, Postman, or curl requests)
    if (!origin) return callback(null, true);
    
    // Allow all origins in development, specific origins in production
    if (process.env.NODE_ENV === 'development') {
      return callback(null, true);
    }
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.warn(`⚠️  CORS blocked request from origin: ${origin}`);
      // In production, reject unknown origins for security
      callback(new Error(`Not allowed by CORS: ${origin}`));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  credentials: true,
  optionsSuccessStatus: 200
}));

app.use(compression());
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));

// Request logging (only in development)
if (process.env.NODE_ENV === 'development') {
  app.use(logger);
}

// Main health check route
app.get('/health', async (req, res) => {
  const response = {
    status: 'OK',
    message: 'Thafheem API is running',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'production',
    database: {
      status: 'unknown'
    },
    cache: {
      status: 'unknown'
    }
  };

  try {
    await mysqlPool.query('SELECT 1');
    response.database = { status: 'connected' };
  } catch (error) {
    console.error('❌ Database health check failed:', error.message);
    response.status = 'DEGRADED';
    response.database = { status: 'error' };
  }

  // Check Redis cache status (optional - doesn't affect overall health)
  // TODO: Enable Redis caching later when needed (set REDIS_ENABLED=true)
  try {
    if (process.env.REDIS_ENABLED === 'true' && redisClient.isReady) {
      await redisClient.ping();
      response.cache = {
        status: 'connected',
        type: 'redis'
      };
    } else {
      response.cache = {
        status: 'disabled',
        type: 'redis',
        message: process.env.REDIS_ENABLED === 'true' 
          ? 'Redis not available (API will work without cache)'
          : 'Redis caching is disabled (set REDIS_ENABLED=true to enable)'
      };
    }
  } catch (error) {
    response.cache = {
      status: 'error',
      type: 'redis'
    };
  }

  return res.json(response);
});

// API documentation routes
app.get('/', (req, res) => {
  res.json({
    name: 'Thafheem Quran API',
    version: '1.0.0',
    description: 'Backend API for Thafheem Quran Web Application',
    documentation: {
      full: '/doc',
      quick: '/doc/quick',
      health: '/health'
    },
    endpoints: {
      health: 'GET /health',
      translation: 'GET /api/:language/translation/:surah/:ayah',
      surah: 'GET /api/:language/surah/:surah',
      interpretation: 'GET /api/:language/interpretation/:surah/:ayah',
      wordByWord: 'GET /api/:language/word-by-word/:surah/:ayah',
      note: 'GET /api/notes/:noteId',
      urduFootnote: 'GET /api/urdu/footnote/:footnoteId',
      englishFootnote: 'GET /api/english/footnote/:footnoteId',
      languageHealth: 'GET /api/:language/health'
    },
    supportedLanguages: ['bangla', 'hindi', 'tamil', 'urdu', 'english'],
    examples: {
      banglaTranslation: '/api/bangla/translation/1/1',
      hindiInterpretation: '/api/hindi/interpretation/2/5',
      tamilSurah: '/api/tamil/surah/1',
      urduWordByWord: '/api/urdu/word-by-word/1/1',
      note: '/api/notes/1',
      englishFootnote: '/api/english/footnote/176997'
    }
  });
});

// Swagger API Documentation
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: 'Thafheem API Documentation',
  customfavIcon: '/favicon.ico',
}));

// Swagger JSON endpoint
app.get('/api-docs.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.send(swaggerSpec);
});

// Comprehensive API documentation (legacy)
app.get('/doc', documentationController.getDocumentation);

// Quick reference guide (legacy)
app.get('/doc/quick', documentationController.getQuickReference);

// API Routes - Unified routes with language parameter
app.use('/api', readLimiter, apiRoutes);
// Versioned routes (v1) for frontend compatibility
app.use('/api/v1', readLimiter, apiRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ 
    error: 'Not Found',
    message: `Cannot ${req.method} ${req.url}`,
    hint: 'Visit GET / for API documentation'
  });
});

// Global error handler
app.use(errorHandler);

// Start server
const server = app.listen(PORT, () => {
  console.log('');
  console.log('✅ Thafheem API Server is running!');
  console.log(`📍 Server URL: http://localhost:${PORT}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'production'}`);
  console.log(`📚 Database Path: ${process.env.DB_PATH || './db'}`);
  console.log('');
  console.log('📖 Swagger API Docs: http://localhost:' + PORT + '/api-docs');
  console.log('📄 Swagger JSON: http://localhost:' + PORT + '/api-docs.json');
  console.log('📖 Legacy Docs: http://localhost:' + PORT + '/doc');
  console.log('📋 Quick Reference: http://localhost:' + PORT + '/doc/quick');
  console.log('❤️  Health Check: http://localhost:' + PORT + '/health');
  console.log('');
    console.log('Available Endpoints:');
    console.log('  GET /api/:language/translation/:surah/:ayah');
    console.log('  GET /api/:language/surah/:surah');
    console.log('  GET /api/:language/interpretation/:surah/:ayah');
    console.log('  GET /api/:language/word-by-word/:surah/:ayah');
    console.log('  GET /api/notes/:noteId');
    console.log('  GET /api/urdu/footnote/:footnoteId');
    console.log('  GET /api/english/footnote/:footnoteId');
    console.log('  GET /api/thajweedrules/:ruleNo');
    console.log('  GET /api/tajweedrules/:ruleNo');
    console.log('');
    console.log('Supported Languages: bangla, hindi, tamil, urdu, english');
    console.log('');
});

// Initialize graceful shutdown handler
gracefulShutdown.init({
  server,
  mysqlPool,
  redisClient
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Promise Rejection:', reason);
  console.error('   Promise:', promise);
  // Trigger graceful shutdown on critical errors
  process.exit(1);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  // Trigger graceful shutdown
  process.exit(1);
});


