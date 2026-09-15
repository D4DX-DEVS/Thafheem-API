const isDev = () => process.env.NODE_ENV === 'development';

// Global error handling middleware
const errorHandler = (err, req, res, next) => {
  console.error('❌ Error:', err.stack);

  const statusCode = err.statusCode || 500;

  // 5xx messages carry SQL/driver internals — log them, don't ship them.
  const message =
    statusCode >= 500 && !isDev()
      ? 'Internal Server Error'
      : err.message || 'Internal Server Error';

  res.status(statusCode).json({
    error: message,
    ...(isDev() && { stack: err.stack })
  });
};

module.exports = errorHandler;
