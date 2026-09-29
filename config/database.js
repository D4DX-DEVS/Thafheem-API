require('dotenv').config();
const mysql = require('mysql2/promise');

console.log('📚 Initializing MySQL database connection...');

const isProd = process.env.NODE_ENV === 'production';
const defaultPort = isProd ? 3306 : 3307;

const resolvePort = () => {
  const candidates = [
    process.env.DB_PORT,
    process.env.MYSQL_PORT,
    process.env.MYSQL_TCP_PORT
  ].filter(Boolean);

  for (const candidate of candidates) {
    const numericPort = parseInt(candidate, 10);
    if (!Number.isNaN(numericPort)) {
      return numericPort;
    }
    console.warn(`⚠️  Invalid MySQL port provided ("${candidate}"). Falling back...`);
  }

  if (!candidates.length) {
    console.warn(`ℹ️  No DB port defined via env. Falling back to default ${defaultPort}.`);
  }

  return defaultPort;
};

// Validate required credentials are present
const missingVars = ['DB_USER', 'DB_PASSWORD', 'DB_NAME'].filter(k => !process.env[k]);
if (missingVars.length) {
  console.error(`❌ Missing required environment variables: ${missingVars.join(', ')}`);
  console.error('💡 Copy .env.example to .env and fill in the values.');
  process.exit(1);
}

// MySQL Connection Configuration (options passed to individual connections)
const connectionConfig = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: resolvePort(),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  connectTimeout: parseInt(process.env.DB_CONNECT_TIMEOUT) || 30000, // 30 seconds
  enableKeepAlive: true,
  keepAliveInitialDelay: 0
};

// MySQL Pool Configuration (pool-specific options, not passed to connections)
// Note: acquireTimeout removed - MySQL2 defaults to 60000ms (60 seconds)
// If you need custom timeout, it must be handled at application level
const poolOptions = {
  waitForConnections: true,
  connectionLimit: parseInt(process.env.DB_POOL_MAX) || 10,
  // queueLimit 0 means "queue forever". Under a burst (the per-verse
  // word-by-word calls are the usual source) every request past the 10
  // connections piled up holding memory until PM2's max-memory-restart killed
  // the process. A bounded queue sheds load as a 503 from Express instead,
  // which the client can retry; a dead process is not recoverable.
  queueLimit: parseInt(process.env.DB_QUEUE_LIMIT) || 50
};

// Merge connection and pool configurations
const poolConfig = {
  ...connectionConfig,
  ...poolOptions
};

// Create MySQL connection pool
const mysqlPool = mysql.createPool(poolConfig);
mysqlPool.meta = {
  host: poolConfig.host,
  port: poolConfig.port,
  database: poolConfig.database,
  user: poolConfig.user
};

// Test connection on startup
mysqlPool.getConnection()
  .then(connection => {
    console.log('✅ MySQL database connected successfully!');
    console.log(`📍 Database: ${poolConfig.database}`);
    console.log(`🔗 Host: ${poolConfig.host}:${poolConfig.port}`);
    console.log(`👤 User: ${poolConfig.user}`);
    console.log(`🔌 Pool: ${poolConfig.connectionLimit} max connections`);
    connection.release(); // Release the connection back to the pool
  })
  .catch(err => {
    console.error('❌ Error connecting to MySQL database:', err.message);
    console.error('💡 Make sure:');
    console.error('   1. MySQL server is running');
    console.error('   2. SSL tunnel is active (for dev: port 3307)');
    console.error('   3. Database credentials are correct');
    console.error('   4. Database exists: ' + poolConfig.database);
    // Deliberately no process.exit here. This is a connectivity probe, not a
    // config check — a MySQL blip during boot used to exit(1), and once PM2 hit
    // its restart cap the process stayed stopped and Apache served 503 until
    // someone noticed. The pool reconnects on its own, so stay up and serve
    // errors for the queries that fail. Missing credentials still exit above,
    // because that cannot fix itself.
    console.error('⚠️  Staying up; the pool will retry on the next query.');
  });

module.exports = mysqlPool;
