const { validationResult } = require('express-validator');
const ResponseView = require('../views/response.view');

/**
 * Middleware that inspects express-validator results and returns 400 on error
 */
function handleValidationErrors(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return ResponseView.error(res, {
      error: 'VALIDATION_ERROR',
      message: 'Invalid request parameters',
      details: errors.array().map((err) => ({
        field: err.path || err.param,
        message: err.msg,
        value: err.value
      })),
      statusCode: 400
    });
  }
  next();
}

module.exports = {
  handleValidationErrors
};
