const crypto = require('crypto');
const { getPool } = require('../config/db');
const RedemptionModel = require('../models/redemption.model');
const IdempotencyModel = require('../models/idempotency.model');
const ResponseView = require('../views/response.view');

class RedemptionController {
  /**
   * POST /redeem
   * Transactional, concurrency-safe redemption with idempotency protection
   */
  static async redeem(req, res, next) {
    const idempotencyKey = req.header('Idempotency-Key') || req.header('idempotency-key');
    const { code, customer_id, order_id } = req.body;

    // 1. Generate request hash for idempotency parameter validation
    const requestHash = crypto
      .createHash('sha256')
      .update(JSON.stringify({ code: code.trim(), customer_id: customer_id.trim(), order_id: order_id.trim() }))
      .digest('hex');

    // 2. Attempt to atomically claim the idempotency key
    const reservation = await IdempotencyModel.tryReserveKey(idempotencyKey, requestHash);

    if (!reservation.reserved) {
      // Key already exists in database
      const existing = await IdempotencyModel.getKeyRecord(idempotencyKey);

      if (!existing) {
        return ResponseView.error(res, {
          error: 'IDEMPOTENCY_CONFLICT',
          message: 'Conflict on idempotency key processing',
          statusCode: 409
        });
      }

      // Check for request parameter mismatch
      if (existing.request_hash !== requestHash) {
        return ResponseView.error(res, {
          error: 'IDEMPOTENCY_KEY_MISMATCH',
          message: 'Idempotency key was previously used with different request parameters',
          statusCode: 422
        });
      }

      // If previous request completed, replay cached response
      if (existing.status === 'COMPLETED') {
        const cachedBody = typeof existing.response_body === 'string'
          ? JSON.parse(existing.response_body)
          : existing.response_body;

        res.setHeader('X-Idempotency-Replay', 'true');
        // Return clear indication of idempotency replay
        return res.status(existing.response_status).json({
          ...cachedBody,
          idempotency_replay: true
        });
      }

      // If previous request is currently in-flight
      return ResponseView.error(res, {
        error: 'CONCURRENT_REQUEST_IN_PROGRESS',
        message: 'A request with this idempotency key is currently being processed',
        statusCode: 409
      });
    }

    // 3. Begin Transaction with Pessimistic Row Locking
    const pool = getPool();
    let connection;

    try {
      connection = await pool.getConnection();
      await connection.beginTransaction();

      // Lock the specific coupon row
      const selectCouponQuery = `
        SELECT id, code, max_redemptions, redeemed_count, discount_percent, expires_at, type,
               UTC_TIMESTAMP(3) AS current_db_time
        FROM coupons
        WHERE code = ?
        FOR UPDATE;
      `;
      const [coupons] = await connection.query(selectCouponQuery, [code.trim()]);
      const coupon = coupons[0];

      // Failure Mode 1: Unknown Coupon Code
      if (!coupon) {
        await connection.rollback();
        const errPayload = {
          success: false,
          error: 'UNKNOWN_COUPON',
          message: `Coupon with code '${code}' does not exist`
        };
        await IdempotencyModel.completeKey(idempotencyKey, 404, errPayload);
        return res.status(404).json(errPayload);
      }

      // Failure Mode 2: Expired Coupon (Atomic check against DB engine clock)
      const expiryTime = new Date(coupon.expires_at).getTime();
      const dbTime = new Date(coupon.current_db_time).getTime();
      if (expiryTime <= dbTime) {
        await connection.rollback();
        const errPayload = {
          success: false,
          error: 'COUPON_EXPIRED',
          message: 'Coupon has expired'
        };
        await IdempotencyModel.completeKey(idempotencyKey, 410, errPayload);
        return res.status(410).json(errPayload);
      }

      // Failure Mode 3: Global Quota Exhausted
      if (coupon.redeemed_count >= coupon.max_redemptions) {
        await connection.rollback();
        const errPayload = {
          success: false,
          error: 'MAX_REDEMPTIONS_REACHED',
          message: 'No redemptions left for this coupon'
        };
        await IdempotencyModel.completeKey(idempotencyKey, 409, errPayload);
        return res.status(409).json(errPayload);
      }

      // Failure Mode 4: Order ID Already Redeemed
      const [existingOrder] = await connection.query(
        'SELECT id, status FROM redemptions WHERE order_id = ? FOR UPDATE;',
        [order_id.trim()]
      );
      if (existingOrder && existingOrder.length > 0 && existingOrder[0].status === 'ACTIVE') {
        await connection.rollback();
        const errPayload = {
          success: false,
          error: 'ORDER_ALREADY_REDEEMED',
          message: `Order '${order_id}' has already redeemed a coupon`
        };
        await IdempotencyModel.completeKey(idempotencyKey, 409, errPayload);
        return res.status(409).json(errPayload);
      }

      // Failure Mode 5: Customer Limit Check for STANDARD coupons
      if (coupon.type === 'STANDARD') {
        const [existingCustomerRedemption] = await connection.query(
          'SELECT id FROM redemptions WHERE coupon_id = ? AND customer_id = ? AND status = "ACTIVE" LIMIT 1;',
          [coupon.id, customer_id.trim()]
        );
        if (existingCustomerRedemption && existingCustomerRedemption.length > 0) {
          await connection.rollback();
          const errPayload = {
            success: false,
            error: 'ALREADY_REDEEMED_BY_CUSTOMER',
            message: 'STANDARD coupon has already been redeemed by this customer'
          };
          await IdempotencyModel.completeKey(idempotencyKey, 409, errPayload);
          return res.status(409).json(errPayload);
        }
      }

      // --- Success Execution ---
      // 1. Increment redeemed_count
      await connection.query(
        'UPDATE coupons SET redeemed_count = redeemed_count + 1 WHERE id = ?;',
        [coupon.id]
      );

      // 2. Insert into redemptions audit table
      await connection.query(
        'INSERT INTO redemptions (coupon_id, customer_id, order_id, status) VALUES (?, ?, ?, "ACTIVE");',
        [coupon.id, customer_id.trim(), order_id.trim()]
      );

      // Commit the transaction
      await connection.commit();

      const newRedeemedCount = Number(coupon.redeemed_count) + 1;
      const remainingSlots = Math.max(0, Number(coupon.max_redemptions) - newRedeemedCount);

      const successPayload = {
        success: true,
        remaining: remainingSlots,
        redeemed_count: newRedeemedCount
      };

      // 3. Mark idempotency record as COMPLETED
      await IdempotencyModel.completeKey(idempotencyKey, 200, successPayload);

      return res.status(200).json(successPayload);
    } catch (err) {
      if (connection) {
        await connection.rollback();
      }
      // On unhandled server error, release idempotency key so client can retry
      await IdempotencyModel.removeKey(idempotencyKey);
      next(err);
    } finally {
      if (connection) {
        connection.release();
      }
    }
  }
}

module.exports = RedemptionController;
