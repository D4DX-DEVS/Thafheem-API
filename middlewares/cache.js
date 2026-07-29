const redisClient = require('../config/redis');

/**
 * Cache middleware - checks Redis before hitting database
 * TODO: Enable Redis caching later when needed
 * Set REDIS_ENABLED=true in .env to enable caching
 * 
 * @param {number} duration - Cache duration in seconds (default: 1 hour)
 * @returns {Function} Express middleware
 */
const cacheMiddleware = (duration = 3600) => {
  return async (req, res, next) => {
    // Skip cache if Redis is disabled or not ready (graceful degradation)
    if (!redisClient.isReady) {
      return next();
    }

    // Create cache key from request URL
    // Normalize query params to ensure consistent caching
    const url = new URL(req.originalUrl, `http://${req.headers.host}`);
    const cacheKey = `thafheem:${url.pathname}${url.search}`;

    try {
      // Try to get data from Redis
      const cachedData = await redisClient.get(cacheKey);
      
      if (cachedData) {
        console.log(`✅ Cache HIT: ${cacheKey}`);
        return res.json(JSON.parse(cachedData));
      }

      console.log(`❌ Cache MISS: ${cacheKey}`);
      
      // Store original res.json function
      const originalJson = res.json.bind(res);
      
      // Override res.json to cache the response
      res.json = (data) => {
        // Cache the response in background (don't block response)
        if (redisClient.isReady) {
          redisClient.setEx(cacheKey, duration, JSON.stringify(data))
            .catch((err) => {
              console.error('Redis cache set error:', err.message);
            });
        }
        return originalJson(data);
      };
      
      next();
    } catch (error) {
      console.error('Redis cache error:', error.message);
      // Continue without cache on error (graceful degradation)
      next();
    }
  };
};

/**
 * Clear cache for specific pattern
 * @param {string} pattern - Redis key pattern (e.g., 'thafheem:/api/english/*')
 */
const clearCache = async (pattern) => {
  if (!redisClient.isReady) {
    console.log('⚠️  Redis not ready, cannot clear cache');
    return;
  }

  try {
    // Use SCAN instead of KEYS for better performance (non-blocking)
    const keys = [];
    let cursor = 0;
    
    do {
      const result = await redisClient.scan(cursor, {
        MATCH: pattern,
        COUNT: 100
      });
      cursor = result.cursor;
      keys.push(...result.keys);
    } while (cursor !== 0);

    if (keys.length > 0) {
      await redisClient.del(keys);
      console.log(`🗑️  Cleared ${keys.length} cache entries matching: ${pattern}`);
    } else {
      console.log(`ℹ️  No cache entries found matching: ${pattern}`);
    }
  } catch (error) {
    console.error('Error clearing cache:', error.message);
  }
};

module.exports = {
  cacheMiddleware,
  clearCache
};



