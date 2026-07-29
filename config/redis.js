const redis = require('redis');

// TODO: Enable Redis caching later when needed
// Set REDIS_ENABLED=true in .env to enable Redis caching
const REDIS_ENABLED = process.env.REDIS_ENABLED === 'true';

if (!REDIS_ENABLED) {
  console.log('ℹ️  Redis caching is disabled (set REDIS_ENABLED=true to enable)');
  // Export a mock client that always returns false for isReady
  const mockClient = {
    isReady: false,
    connect: () => Promise.resolve(),
    get: () => Promise.resolve(null),
    setEx: () => Promise.resolve(),
    quit: () => Promise.resolve(),
    on: () => {},
    scan: () => Promise.resolve({ cursor: 0, keys: [] }),
    del: () => Promise.resolve(0)
  };
  module.exports = mockClient;
} else {
  console.log('🔴 Connecting to Redis...');

  // Track connection state to reduce log noise
  let connectionAttempted = false;
  let lastErrorTime = 0;
  const ERROR_LOG_INTERVAL = 10000; // Only log errors every 10 seconds

  // Create Redis client with modern API (v4+)
  // Support both local Redis and Redis Cloud (with TLS)
  const redisConfig = {
    username: process.env.REDIS_USERNAME || 'default',
    password: process.env.REDIS_PASSWORD || undefined,
    socket: {
      host: process.env.REDIS_HOST || '127.0.0.1',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      reconnectStrategy: (retries) => {
        // Stop trying after 3 attempts to reduce noise
        if (retries > 3) {
          if (!connectionAttempted) {
            console.log('⚠️  Redis not available - API will work without caching');
            connectionAttempted = true;
          }
          return false; // Stop reconnecting
        }
        return Math.min(retries * 100, 1000);
      }
    },
    // Redis Cloud database number is just an identifier, not a selectable DB index
    // Don't set database property for Redis Cloud
  };

  // Enable TLS for Redis Cloud only if explicitly enabled
  // Note: Some Redis Cloud ports (like 16496) don't use TLS
  // Set REDIS_TLS=true in .env if your Redis Cloud instance requires TLS
  if (process.env.REDIS_TLS === 'true') {
    redisConfig.socket.tls = true;
    redisConfig.socket.rejectUnauthorized = false;
    redisConfig.socket.keepAlive = true;
  }

  const redisClient = redis.createClient(redisConfig);

  // Connection event handlers
  redisClient.on('connect', () => {
    console.log('✅ Redis connected successfully!');
    connectionAttempted = false; // Reset on successful connection
  });

  redisClient.on('ready', () => {
    console.log('✅ Redis is ready to accept commands');
  });

  redisClient.on('error', (err) => {
    // Only log errors occasionally to reduce noise
    const now = Date.now();
    if (now - lastErrorTime > ERROR_LOG_INTERVAL) {
      console.error('❌ Redis error:', err.message);
      lastErrorTime = now;
    }
    // Don't crash the app if Redis fails - graceful degradation
  });

  redisClient.on('reconnecting', () => {
    // Silent reconnection (too noisy otherwise)
  });

  // Connect to Redis (non-blocking)
  redisClient.connect().catch((err) => {
    if (!connectionAttempted) {
      console.error('❌ Failed to connect to Redis:', err.message);
      console.log('⚠️  API will continue without caching');
      connectionAttempted = true;
    }
  });

  module.exports = redisClient;
}

