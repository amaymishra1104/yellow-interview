/**
 * Standardized Response Presenter / View Layer
 */

class ResponseView {
  static success(res, data, statusCode = 200) {
    return res.status(statusCode).json(data);
  }

  static error(res, { error, message, details = null, statusCode = 400 }) {
    const payload = {
      success: false,
      error,
      message
    };
    if (details) {
      payload.details = details;
    }
    return res.status(statusCode).json(payload);
  }

  static couponDetail(coupon) {
    const maxRedemptions = Number(coupon.max_redemptions);
    const redeemedCount = Number(coupon.redeemed_count);
    return {
      code: coupon.code,
      redeemed_count: redeemedCount,
      remaining: Math.max(0, maxRedemptions - redeemedCount),
      max_redemptions: maxRedemptions,
      discount_percent: Number(coupon.discount_percent),
      expires_at: coupon.expires_at,
      type: coupon.type
    };
  }

  static couponSummary(coupon) {
    const maxRedemptions = Number(coupon.max_redemptions);
    const redeemedCount = Number(coupon.redeemed_count);
    return {
      redeemed_count: redeemedCount,
      remaining: Math.max(0, maxRedemptions - redeemedCount),
      max_redemptions: maxRedemptions
    };
  }
}

module.exports = ResponseView;
