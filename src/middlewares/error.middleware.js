const ResponseView = require('../views/response.view');

/**
 * Global application error handling middleware
 */
function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  console.error(`[Error] ${req.method} ${req.originalUrl}:`, err);

  // Handle JSON parse errors from express.json()
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return ResponseView.error(res, {
      error: 'INVALID_JSON',
      message: 'Malformed JSON payload provided',
      statusCode: 400
    });
  }

  // Handle MySQL duplicate key error (ER_DUP_ENTRY)
  if (err.code === 'ER_DUP_ENTRY') {
    return ResponseView.error(res, {
      error: 'DUPLICATE_ENTRY',
      message: 'A resource with this identifier already exists',
      statusCode: 409
    });
  }

  // Generic 500 Internal Server Error
  return ResponseView.error(res, {
    error: 'INTERNAL_SERVER_ERROR',
    message: process.env.NODE_ENV === 'production' ? 'An unexpected server error occurred' : err.message,
    statusCode: 500
  });
}

/**
 * 404 Route Not Found middleware
 */
function notFoundHandler(req, res) {
  return ResponseView.error(res, {
    error: 'NOT_FOUND',
    message: `Cannot ${req.method} ${req.originalUrl}`,
    statusCode: 404
  });
}

module.exports = {
  errorHandler,
  notFoundHandler
};
