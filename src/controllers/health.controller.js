const { checkDbConnection } = require('../config/db');
const ResponseView = require('../views/response.view');

class HealthController {
  static async check(req, res, next) {
    try {
      const dbStatus = await checkDbConnection();
      const status = dbStatus.connected ? 'healthy' : 'degraded';
      const statusCode = dbStatus.connected ? 200 : 503;

      return ResponseView.success(
        res,
        {
          status,
          service: 'coupon-redemption-service',
          timestamp: new Date().toISOString(),
          database: dbStatus
        },
        statusCode
      );
    } catch (err) {
      next(err);
    }
  }
}

module.exports = HealthController;
