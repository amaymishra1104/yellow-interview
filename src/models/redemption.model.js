const { getPool } = require('../config/db');

class RedemptionModel {
  /**
   * Find an active redemption for a specific customer and coupon
   */
  static async findActiveByCustomerAndCoupon(couponId, customerId, client = null) {
    const db = client || getPool();
    const query = `
      SELECT id, coupon_id, customer_id, order_id, status, created_at
      FROM redemptions
      WHERE coupon_id = ? AND customer_id = ? AND status = 'ACTIVE'
      LIMIT 1;
    `;
    const [rows] = await db.query(query, [couponId, customerId]);
    return rows[0] || null;
  }

  /**
   * Find a redemption by order_id with row lock (FOR UPDATE)
   */
  static async findByOrderIdForUpdate(orderId, client) {
    if (!client) {
      throw new Error('A dedicated transaction connection is required for FOR UPDATE queries');
    }
    const query = `
      SELECT id, coupon_id, customer_id, order_id, status, created_at
      FROM redemptions
      WHERE order_id = ?
      FOR UPDATE;
    `;
    const [rows] = await client.query(query, [orderId]);
    return rows[0] || null;
  }

  /**
   * Find any redemption by order_id
   */
  static async findByOrderId(orderId, client = null) {
    const db = client || getPool();
    const query = `
      SELECT id, coupon_id, customer_id, order_id, status, created_at
      FROM redemptions
      WHERE order_id = ?;
    `;
    const [rows] = await db.query(query, [orderId]);
    return rows[0] || null;
  }

  /**
   * Insert a new redemption record inside a transaction
   */
  static async create({ couponId, customerId, orderId }, client) {
    const query = `
      INSERT INTO redemptions (coupon_id, customer_id, order_id, status)
      VALUES (?, ?, ?, 'ACTIVE');
    `;
    const [result] = await client.query(query, [couponId, customerId, orderId]);
    return {
      id: result.insertId,
      coupon_id: couponId,
      customer_id: customerId,
      order_id: orderId,
      status: 'ACTIVE'
    };
  }

  /**
   * Mark a redemption as CANCELLED inside a transaction
   */
  static async cancel(id, client) {
    const query = `
      UPDATE redemptions
      SET status = 'CANCELLED'
      WHERE id = ?;
    `;
    await client.query(query, [id]);
  }
}

module.exports = RedemptionModel;
