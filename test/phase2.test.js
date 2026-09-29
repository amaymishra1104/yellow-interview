const assert = require('assert');
const app = require('../src/app');
const { closePool } = require('../src/config/db');

async function runPhase2Tests() {
  console.log('🧪 Starting Phase 2 (Transaction & Business Rules) Verification Tests...\n');

  let server;
  const PORT = 3998;
  const BASE_URL = `http://127.0.0.1:${PORT}`;

  try {
    await new Promise((resolve) => {
      server = app.listen(PORT, resolve);
    });
    console.log(`✓ Test server running on ${BASE_URL}\n`);

    const now = Date.now();
    const futureDate = new Date(now + 86400000 * 5).toISOString();
    const pastDate = new Date(now - 86400000).toISOString(); // 1 day in past

    // Helper to seed coupon
    async function seedCoupon(payload) {
      const res = await fetch(`${BASE_URL}/coupons`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      return { status: res.status, body: await res.json() };
    }

    // Helper to redeem coupon
    async function redeemCoupon(idempotencyKey, payload) {
      const headers = { 'Content-Type': 'application/json' };
      if (idempotencyKey !== null) {
        headers['Idempotency-Key'] = idempotencyKey;
      }
      const res = await fetch(`${BASE_URL}/redeem`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      });
      return {
        status: res.status,
        headers: res.headers,
        body: await res.json()
      };
    }

    // Helper to cancel order
    async function cancelOrder(orderId) {
      const res = await fetch(`${BASE_URL}/orders/${orderId}/cancel`, {
        method: 'POST'
      });
      return { status: res.status, body: await res.json() };
    }

    // Helper to get coupon
    async function getCoupon(code) {
      const res = await fetch(`${BASE_URL}/coupons/${code}`);
      return { status: res.status, body: await res.json() };
    }

    // --- TEST 1: Missing Idempotency-Key Header ---
    console.log('--- Test 1: Missing Idempotency-Key Header ---');
    const missingKeyRes = await redeemCoupon(null, {
      code: 'TEST',
      customer_id: 'cust_1',
      order_id: 'ord_1'
    });
    assert.strictEqual(missingKeyRes.status, 400);
    assert.strictEqual(missingKeyRes.body.error, 'VALIDATION_ERROR');
    console.log('✓ Rejection of missing Idempotency-Key passed.');

    // --- TEST 2: Successful Redemption of STANDARD Coupon ---
    console.log('\n--- Test 2: Successful Redemption of STANDARD Coupon ---');
    const stdCode = `STD_${now}`;
    await seedCoupon({
      code: stdCode,
      max_redemptions: 2,
      discount_percent: 10,
      expires_at: futureDate,
      type: 'STANDARD'
    });

    const redeem1 = await redeemCoupon(`KEY_1_${now}`, {
      code: stdCode,
      customer_id: 'cust_101',
      order_id: 'order_101'
    });
    assert.strictEqual(redeem1.status, 200);
    assert.strictEqual(redeem1.body.success, true);
    assert.strictEqual(redeem1.body.remaining, 1);
    assert.strictEqual(redeem1.body.redeemed_count, 1);
    console.log('✓ Successful redemption passed.');

    // --- TEST 3: Idempotency Replay (Network Retry) ---
    console.log('\n--- Test 3: Idempotency Replay (Exact Retry) ---');
    const replayRes = await redeemCoupon(`KEY_1_${now}`, {
      code: stdCode,
      customer_id: 'cust_101',
      order_id: 'order_101'
    });
    assert.strictEqual(replayRes.status, 200);
    assert.strictEqual(replayRes.body.success, true);
    assert.strictEqual(replayRes.body.idempotency_replay, true);
    assert.strictEqual(replayRes.headers.get('x-idempotency-replay'), 'true');

    // Verify database count was NOT double-incremented
    const checkCoupon1 = await getCoupon(stdCode);
    assert.strictEqual(checkCoupon1.body.redeemed_count, 1);
    assert.strictEqual(checkCoupon1.body.remaining, 1);
    console.log('✓ Idempotency replay returned cached result without double-redeeming.');

    // --- TEST 4: Idempotency Key Mismatch ---
    console.log('\n--- Test 4: Idempotency Key with Altered Parameters ---');
    const mismatchRes = await redeemCoupon(`KEY_1_${now}`, {
      code: stdCode,
      customer_id: 'cust_DIFFERENT',
      order_id: 'order_DIFFERENT'
    });
    assert.strictEqual(mismatchRes.status, 422);
    assert.strictEqual(mismatchRes.body.error, 'IDEMPOTENCY_KEY_MISMATCH');
    console.log('✓ Idempotency parameter mismatch rejected with 422.');

    // --- TEST 5: STANDARD Coupon Single-Customer Limit ---
    console.log('\n--- Test 5: STANDARD Coupon Single-Customer Limit ---');
    const secondCustAttempt = await redeemCoupon(`KEY_2_${now}`, {
      code: stdCode,
      customer_id: 'cust_101', // same customer trying again
      order_id: 'order_102'
    });
    assert.strictEqual(secondCustAttempt.status, 409);
    assert.strictEqual(secondCustAttempt.body.error, 'ALREADY_REDEEMED_BY_CUSTOMER');
    console.log('✓ Per-customer limit for STANDARD coupon enforced.');

    // --- TEST 6: STACKABLE Coupon (Allows Multiple Redemptions per Customer) ---
    console.log('\n--- Test 6: STACKABLE Coupon Multiple Redemptions per Customer ---');
    const stkCode = `STK_${now}`;
    await seedCoupon({
      code: stkCode,
      max_redemptions: 2,
      discount_percent: 15,
      expires_at: futureDate,
      type: 'STACKABLE'
    });

    // Same customer first redemption
    const stkRedeem1 = await redeemCoupon(`KEY_STK_1_${now}`, {
      code: stkCode,
      customer_id: 'cust_200',
      order_id: 'order_201'
    });
    assert.strictEqual(stkRedeem1.status, 200);

    // Same customer second redemption (allowed for STACKABLE)
    const stkRedeem2 = await redeemCoupon(`KEY_STK_2_${now}`, {
      code: stkCode,
      customer_id: 'cust_200',
      order_id: 'order_202'
    });
    assert.strictEqual(stkRedeem2.status, 200);
    assert.strictEqual(stkRedeem2.body.remaining, 0);
    assert.strictEqual(stkRedeem2.body.redeemed_count, 2);

    // Third redemption fails because max_redemptions (2) reached
    const stkRedeem3 = await redeemCoupon(`KEY_STK_3_${now}`, {
      code: stkCode,
      customer_id: 'cust_201',
      order_id: 'order_203'
    });
    assert.strictEqual(stkRedeem3.status, 409);
    assert.strictEqual(stkRedeem3.body.error, 'MAX_REDEMPTIONS_REACHED');
    console.log('✓ STACKABLE coupon allowed multiple customer uses and respected max_redemptions.');

    // --- TEST 7: Expired Coupon Rejection ---
    console.log('\n--- Test 7: Expired Coupon Rejection ---');
    const expCode = `EXP_${now}`;
    await seedCoupon({
      code: expCode,
      max_redemptions: 5,
      discount_percent: 20,
      expires_at: pastDate,
      type: 'STANDARD'
    });

    const expRes = await redeemCoupon(`KEY_EXP_${now}`, {
      code: expCode,
      customer_id: 'cust_300',
      order_id: 'order_301'
    });
    assert.strictEqual(expRes.status, 410);
    assert.strictEqual(expRes.body.error, 'COUPON_EXPIRED');
    console.log('✓ Expired coupon correctly rejected with 410.');

    // --- TEST 8: Unknown Coupon Rejection ---
    console.log('\n--- Test 8: Unknown Coupon Rejection ---');
    const unknownRes = await redeemCoupon(`KEY_UNK_${now}`, {
      code: 'TOTALLY_UNKNOWN_CODE_9999',
      customer_id: 'cust_400',
      order_id: 'order_401'
    });
    assert.strictEqual(unknownRes.status, 404);
    assert.strictEqual(unknownRes.body.error, 'UNKNOWN_COUPON');
    console.log('✓ Unknown coupon rejected with 404.');

    // --- TEST 9: Order Cancellation and Slot Return ---
    console.log('\n--- Test 9: Order Cancellation and Slot Return ---');
    // Order 'order_101' was redeemed against stdCode (max: 2, redeemed: 1, remaining: 1)
    const cancelRes1 = await cancelOrder('order_101');
    assert.strictEqual(cancelRes1.status, 200);
    assert.strictEqual(cancelRes1.body.slot_returned, true);
    assert.strictEqual(cancelRes1.body.redeemed_count, 0);
    assert.strictEqual(cancelRes1.body.remaining, 2);

    const checkCouponAfterCancel = await getCoupon(stdCode);
    assert.strictEqual(checkCouponAfterCancel.body.redeemed_count, 0);
    assert.strictEqual(checkCouponAfterCancel.body.remaining, 2);
    console.log('✓ Order cancellation returned slot successfully.');

    // --- TEST 10: Duplicate Cancellation Idempotency ---
    console.log('\n--- Test 10: Duplicate Cancellation Idempotency (Second Call) ---');
    const cancelRes2 = await cancelOrder('order_101');
    assert.strictEqual(cancelRes2.status, 200);
    assert.strictEqual(cancelRes2.body.slot_returned, false);
    assert.strictEqual(cancelRes2.body.already_cancelled, true);

    // Verify slot was not returned twice
    const checkCouponAfterSecondCancel = await getCoupon(stdCode);
    assert.strictEqual(checkCouponAfterSecondCancel.body.redeemed_count, 0);
    assert.strictEqual(checkCouponAfterSecondCancel.body.remaining, 2);
    console.log('✓ Duplicate order cancellation is a safe no-op.');

    // --- TEST 11: Cancel Non-Existent Order ---
    console.log('\n--- Test 11: Cancel Non-Existent Order ---');
    const cancelNonExistent = await cancelOrder('NON_EXISTENT_ORDER_999');
    assert.strictEqual(cancelNonExistent.status, 404);
    assert.strictEqual(cancelNonExistent.body.error, 'ORDER_NOT_FOUND');
    console.log('✓ Non-existent order cancellation returned 404.');

    console.log('\n🎉 ALL PHASE 2 TESTS PASSED PERFECTLY! 🎉\n');
  } catch (err) {
    console.error('\n❌ Test suite failed:', err);
    process.exitCode = 1;
  } finally {
    if (server) {
      server.close();
    }
    await closePool();
  }
}

runPhase2Tests();
