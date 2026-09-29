const { getPool } = require('../config/db');

class CouponModel {
  /**
   * Insert a new coupon into the database
   */
  static async create({ code, max_redemptions, discount_percent, expires_at, type }, client = null) {
    const db = client || getPool();
    const query = `
      INSERT INTO coupons (code, max_redemptions, discount_percent, expires_at, type)
      VALUES (?, ?, ?, ?, ?);
    `;
    const [result] = await db.query(query, [
      code,
      max_redemptions,
      discount_percent,
      expires_at,
      type
    ]);
    return {
      id: result.insertId,
      code,
      max_redemptions,
      redeemed_count: 0,
      discount_percent,
      expires_at,
      type
    };
  }

  /**
   * Find a coupon by its unique code
   */
  static async findByCode(code, client = null) {
    const db = client || getPool();
    const query = `
      SELECT id, code, max_redemptions, redeemed_count, discount_percent, expires_at, type, created_at, updated_at
      FROM coupons
      WHERE code = ?;
    `;
    const [rows] = await db.query(query, [code]);
    return rows[0] || null;
  }

  /**
   * Find a coupon by code with row lock (FOR UPDATE) inside an active transaction
   */
  static async findByCodeForUpdate(code, client) {
    if (!client) {
      throw new Error('A dedicated transaction connection is required for FOR UPDATE queries');
    }
    const query = `
      SELECT id, code, max_redemptions, redeemed_count, discount_percent, expires_at, type, created_at, updated_at
      FROM coupons
      WHERE code = ?
      FOR UPDATE;
    `;
    const [rows] = await client.query(query, [code]);
    return rows[0] || null;
  }
}

module.exports = CouponModel;
