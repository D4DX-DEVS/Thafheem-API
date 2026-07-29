/**
 * Graceful Shutdown Manager
 * Handles coordinated cleanup of server resources on shutdown signals
 */

let isShuttingDown = false;

class GracefulShutdown {
  constructor() {
    this.server = null;
    this.mysqlPool = null;
    this.redisClient = null;
    this.mongoDisconnectFn = null;
    this.timeout = parseInt(process.env.SHUTDOWN_TIMEOUT) || 30000; // 30 seconds default
  }

  /**
   * Initialize shutdown manager with resources to clean up
   */
  init({ server, mysqlPool, redisClient, mongoDisconnectFn }) {
    this.server = server;
    this.mysqlPool = mysqlPool;
    this.redisClient = redisClient;
    this.mongoDisconnectFn = mongoDisconnectFn;

    // Register signal handlers
    process.on('SIGTERM', () => this.shutdown('SIGTERM'));
    process.on('SIGINT', () => this.shutdown('SIGINT'));
    process.on('SIGUSR2', () => this.shutdown('SIGUSR2')); // PM2 reload signal
  }

  /**
   * Perform graceful shutdown
   */
  async shutdown(signal) {
    // Prevent multiple simultaneous shutdowns
    if (isShuttingDown) {
      console.log(`⚠️  Shutdown already in progress, ignoring ${signal}`);
      return;
    }

    isShuttingDown = true;
    const shutdownStartTime = Date.now();
    console.log('');
    console.log(`⚠️  ${signal} signal received: initiating graceful shutdown...`);
    console.log(`⏱️  Timeout: ${this.timeout / 1000}s`);

    // Set timeout to force exit if shutdown takes too long
    const forceExitTimer = setTimeout(() => {
      const elapsed = Date.now() - shutdownStartTime;
      console.error(`❌ Graceful shutdown timeout exceeded (${elapsed}ms), forcing exit`);
      process.exit(1);
    }, this.timeout);

    try {
      // Step 1: Stop accepting new connections
      if (this.server) {
        await this.closeHttpServer();
      }

      // Step 2: Close Redis connection
      if (this.redisClient && this.redisClient.isReady) {
        await this.closeRedis();
      }

      // Step 3: Close MySQL connection pool
      if (this.mysqlPool) {
        await this.closeMysql();
      }

      // Step 4: Close MongoDB connection (if enabled)
      if (typeof this.mongoDisconnectFn === 'function') {
        await this.closeMongo();
      }

      const totalDuration = Date.now() - shutdownStartTime;
      console.log(`✅ Graceful shutdown completed successfully (total: ${totalDuration}ms)`);
      clearTimeout(forceExitTimer);
      process.exit(0);

    } catch (error) {
      const totalDuration = Date.now() - shutdownStartTime;
      console.error(`❌ Error during graceful shutdown (after ${totalDuration}ms):`, error.message);
      clearTimeout(forceExitTimer);
      process.exit(1);
    }
  }

  /**
   * Close HTTP server and wait for active connections
   */
  closeHttpServer() {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      console.log('🔌 Closing HTTP server (waiting for active requests)...');
      
      // Get active connection count if available (Node.js 18+)
      const getConnections = () => {
        return new Promise((res) => {
          if (typeof this.server.getConnections === 'function') {
            this.server.getConnections((err, count) => {
              res(err ? 0 : count);
            });
          } else {
            res(0);
          }
        });
      };
      
      getConnections().then(activeConnections => {
        if (activeConnections > 0) {
          console.log(`⏳ Waiting for ${activeConnections} active connection(s) to finish...`);
        }
        
        // Set a timeout to force close if shutdown takes too long
        // Use 80% of total shutdown timeout for HTTP server
        const httpTimeout = Math.floor(this.timeout * 0.8);
        const closeTimeout = setTimeout(() => {
          console.log(`⚠️  HTTP server close exceeded ${httpTimeout/1000}s, forcing closure...`);
          // Force close idle connections as last resort
          if (typeof this.server.closeIdleConnections === 'function') {
            this.server.closeIdleConnections();
          }
        }, httpTimeout);
        
        this.server.close((err) => {
          clearTimeout(closeTimeout);
          const duration = Date.now() - startTime;
          
          if (err) {
            console.error('❌ Error closing HTTP server:', err.message);
            reject(err);
          } else {
            console.log(`✅ HTTP server closed (took ${duration}ms)`);
            resolve();
          }
        });
      });
    });
  }

  /**
   * Close Redis connection
   */
  async closeRedis() {
    const startTime = Date.now();
    try {
      console.log('🔴 Closing Redis connection...');
      
      // Set timeout for Redis quit operation
      const quitPromise = this.redisClient.quit();
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Redis quit timeout')), 5000)
      );
      
      await Promise.race([quitPromise, timeoutPromise]);
      const duration = Date.now() - startTime;
      console.log(`✅ Redis connection closed (took ${duration}ms)`);
    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(`⚠️  Redis close warning (took ${duration}ms):`, error.message);
      // Force disconnect if quit fails
      try {
        await this.redisClient.disconnect();
      } catch (disconnectError) {
        console.error('⚠️  Redis force disconnect also failed:', disconnectError.message);
      }
      // Don't fail shutdown if Redis fails - graceful degradation
    }
  }

  /**
   * Close MySQL connection pool
   */
  async closeMysql() {
    const startTime = Date.now();
    try {
      console.log('📚 Closing MySQL connection pool...');
      
      // Set timeout for MySQL pool closure
      const endPromise = this.mysqlPool.end();
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('MySQL pool end timeout')), 10000)
      );
      
      await Promise.race([endPromise, timeoutPromise]);
      const duration = Date.now() - startTime;
      console.log(`✅ MySQL connection pool closed (took ${duration}ms)`);
    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(`❌ Error closing MySQL pool (took ${duration}ms):`, error.message);
      throw error;
    }
  }

  /**
   * Close MongoDB connection
   */
  async closeMongo() {
    const startTime = Date.now();
    try {
      console.log('🍃 Closing MongoDB connection...');
      await this.mongoDisconnectFn();
      const duration = Date.now() - startTime;
      console.log(`✅ MongoDB connection closed (took ${duration}ms)`);
    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(`⚠️  MongoDB close warning (took ${duration}ms):`, error.message);
      // Do not fail full shutdown on payment-module-only DB issues.
    }
  }
}

module.exports = new GracefulShutdown();

