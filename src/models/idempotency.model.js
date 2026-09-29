const { getPool } = require('../config/db');

class IdempotencyModel {
  /**
   * Attempt to atomically reserve an idempotency key
   * Returns true if reserved, false if already exists
   */
  static async tryReserveKey(key, requestHash) {
    const db = getPool();
    const query = `
      INSERT INTO idempotency_records (idempotency_key, request_hash, status)
      VALUES (?, ?, 'IN_PROGRESS');
    `;
    try {
      await db.query(query, [key, requestHash]);
      return { reserved: true };
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        return { reserved: false };
      }
      throw err;
    }
  }

  /**
   * Retrieve the idempotency record by key
   */
  static async getKeyRecord(key) {
    const db = getPool();
    const query = `
      SELECT idempotency_key, request_hash, status, response_status, response_body, created_at
      FROM idempotency_records
      WHERE idempotency_key = ?;
    `;
    const [rows] = await db.query(query, [key]);
    return rows[0] || null;
  }

  /**
   * Mark the idempotency record as COMPLETED with the given response payload
   */
  static async completeKey(key, responseStatus, responseBody) {
    const db = getPool();
    const query = `
      UPDATE idempotency_records
      SET status = 'COMPLETED',
          response_status = ?,
          response_body = ?
      WHERE idempotency_key = ?;
    `;
    await db.query(query, [responseStatus, JSON.stringify(responseBody), key]);
  }

  /**
   * Remove key on unhandled transient system error to allow retry
   */
  static async removeKey(key) {
    const db = getPool();
    const query = `
      DELETE FROM idempotency_records
      WHERE idempotency_key = ?;
    `;
    await db.query(query, [key]);
  }
}

module.exports = IdempotencyModel;
