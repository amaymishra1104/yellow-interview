const CouponModel = require('../models/coupon.model');
const ResponseView = require('../views/response.view');

class CouponController {
  /**
   * POST /coupons
   * Create / seed a new coupon
   */
  static async createCoupon(req, res, next) {
    try {
      const { code, max_redemptions, discount_percent, expires_at, type } = req.body;

      // Check if coupon code already exists
      const existing = await CouponModel.findByCode(code);
      if (existing) {
        return ResponseView.error(res, {
          error: 'COUPON_ALREADY_EXISTS',
          message: `Coupon with code '${code}' already exists`,
          statusCode: 409
        });
      }

      const newCoupon = await CouponModel.create({
        code,
        max_redemptions: parseInt(max_redemptions, 10),
        discount_percent: parseInt(discount_percent, 10),
        expires_at: new Date(expires_at).toISOString().slice(0, 19).replace('T', ' '),
        type
      });

      return ResponseView.success(res, ResponseView.couponDetail(newCoupon), 201);
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /coupons/:code
   * Fetch current live status of a coupon (always direct and consistent)
   */
  static async getCouponByCode(req, res, next) {
    try {
      const { code } = req.params;
      const coupon = await CouponModel.findByCode(code);

      if (!coupon) {
        return ResponseView.error(res, {
          error: 'UNKNOWN_COUPON',
          message: `Coupon with code '${code}' not found`,
          statusCode: 404
        });
      }

      return ResponseView.success(res, ResponseView.couponSummary(coupon), 200);
    } catch (err) {
      next(err);
    }
  }
}

module.exports = CouponController;
