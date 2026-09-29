const { getPool } = require('../config/db');
const ResponseView = require('../views/response.view');

class OrderController {
  /**
   * POST /orders/:order_id/cancel
   * Reverses coupon redemption tied to the order and restores the redemption slot.
   * Strictly idempotent: second call is a no-op that does not double-decrement.
   */
  static async cancelOrderRedemption(req, res, next) {
    const { order_id } = req.params;
    const pool = getPool();
    let connection;

    try {
      connection = await pool.getConnection();
      await connection.beginTransaction();

      // Lock the redemption record for this order
      const selectQuery = `
        SELECT id, coupon_id, customer_id, order_id, status
        FROM redemptions
        WHERE order_id = ?
        FOR UPDATE;
      `;
      const [rows] = await connection.query(selectQuery, [order_id.trim()]);
      const redemption = rows[0];

      // Failure: No redemption exists for this order
      if (!redemption) {
        await connection.rollback();
        return ResponseView.error(res, {
          error: 'ORDER_NOT_FOUND',
          message: `No coupon redemption found for order '${order_id}'`,
          statusCode: 404
        });
      }

      // Idempotency: Already cancelled, return no-op 200 without refunding slot again
      if (redemption.status === 'CANCELLED') {
        await connection.rollback();
        return ResponseView.success(res, {
          success: true,
          message: 'Order redemption was already cancelled',
          slot_returned: false,
          already_cancelled: true
        }, 200);
      }

      // Reversal: Mark redemption as CANCELLED
      await connection.query(
        'UPDATE redemptions SET status = "CANCELLED" WHERE id = ?;',
        [redemption.id]
      );

      // Decrement redeemed_count on the coupon (safe floor at 0)
      await connection.query(
        'UPDATE coupons SET redeemed_count = GREATEST(0, CAST(redeemed_count AS SIGNED) - 1) WHERE id = ?;',
        [redemption.coupon_id]
      );

      // Fetch updated counts
      const [couponRows] = await connection.query(
        'SELECT redeemed_count, max_redemptions FROM coupons WHERE id = ?;',
        [redemption.coupon_id]
      );
      const updatedCoupon = couponRows[0];

      await connection.commit();

      const redeemedCount = Number(updatedCoupon.redeemed_count);
      const remainingSlots = Math.max(0, Number(updatedCoupon.max_redemptions) - redeemedCount);

      return ResponseView.success(res, {
        success: true,
        message: 'Order redemption cancelled successfully and slot returned',
        slot_returned: true,
        remaining: remainingSlots,
        redeemed_count: redeemedCount
      }, 200);
    } catch (err) {
      if (connection) {
        await connection.rollback();
      }
      next(err);
    } finally {
      if (connection) {
        connection.release();
      }
    }
  }
}

module.exports = OrderController;
