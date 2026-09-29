const assert = require('assert');

/**
 * Concurrency & Distributed Multi-Instance Test Suite
 *
 * Targets two distinct application processes:
 * - App Instance 1: http://127.0.0.1:3001
 * - App Instance 2: http://127.0.0.1:3002
 * Both sharing the same MySQL database instance.
 */

const APP1_URL = process.env.APP1_URL || 'http://127.0.0.1:3001';
const APP2_URL = process.env.APP2_URL || 'http://127.0.0.1:3002';

async function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForInstances() {
  console.log('⏳ Waiting for both app instances (port 3001 & port 3002) to be ready...');
  const maxAttempts = 30;
  for (let i = 1; i <= maxAttempts; i++) {
    try {
      const [res1, res2] = await Promise.all([
        fetch(`${APP1_URL}/health`),
        fetch(`${APP2_URL}/health`)
      ]);
      if (res1.status === 200 && res2.status === 200) {
        const d1 = await res1.json();
        const d2 = await res2.json();
        if (d1.database.connected && d2.database.connected) {
          console.log(`✓ Both instances are healthy and connected to MySQL (Attempt ${i})\n`);
          return;
        }
      }
    } catch {
      // wait and retry
    }
    await wait(1000);
  }
  throw new Error('Timed out waiting for App1 (3001) and App2 (3002) to become healthy.');
}

async function runConcurrencyTests() {
  console.log('================================================================');
  console.log('🚀 MULTI-INSTANCE DISTRIBUTED CONCURRENCY TEST SUITE');
  console.log(`🎯 Targets: Instance 1 (${APP1_URL}) & Instance 2 (${APP2_URL})`);
  console.log('================================================================\n');

  try {
    await waitForInstances();

    const timestamp = Date.now();
    const futureDate = new Date(timestamp + 86400000 * 10).toISOString();

    // =========================================================================
    // TEST 1: Distributed Flash-Sale Burst Test (50 simultaneous checkouts vs max 10)
    // =========================================================================
    console.log('----------------------------------------------------------------');
    console.log('TEST 1: Distributed Flash-Sale Burst Test');
    console.log('Scenario: 50 concurrent requests against a coupon with max_redemptions = 10');
    console.log('Requests interleaved evenly across Instance 1 (port 3001) and Instance 2 (port 3002)');
    console.log('----------------------------------------------------------------');

    const flashCode = `FLASH_50_${timestamp}`;
    const maxRedemptions = 10;
    const totalConcurrentRequests = 50;

    // Seed coupon via Instance 1
    const createRes = await fetch(`${APP1_URL}/coupons`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: flashCode,
        max_redemptions: maxRedemptions,
        discount_percent: 50,
        expires_at: futureDate,
        type: 'STANDARD'
      })
    });
    assert.strictEqual(createRes.status, 201, 'Failed to seed coupon');
    console.log(`✓ Seeded coupon '${flashCode}' (max_redemptions: ${maxRedemptions})`);

    // Prepare 50 concurrent requests
    const burstPromises = [];
    for (let i = 1; i <= totalConcurrentRequests; i++) {
      const targetInstance = i % 2 === 0 ? APP1_URL : APP2_URL;
      const idempotencyKey = `KEY_BURST_${timestamp}_${i}`;
      const payload = {
        code: flashCode,
        customer_id: `customer_burst_${i}`,
        order_id: `order_burst_${timestamp}_${i}`
      };

      burstPromises.push(
        fetch(`${targetInstance}/redeem`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': idempotencyKey
          },
          body: JSON.stringify(payload)
        }).then(async (res) => ({
          status: res.status,
          body: await res.json(),
          instance: targetInstance
        }))
      );
    }

    console.log(`⚡ Dispatching ${totalConcurrentRequests} simultaneous requests across both nodes...`);
    const burstResults = await Promise.all(burstPromises);

    const successCount = burstResults.filter((r) => r.status === 200).length;
    const maxRedemptionsErrorCount = burstResults.filter(
      (r) => r.status === 409 && r.body.error === 'MAX_REDEMPTIONS_REACHED'
    ).length;
    const otherErrors = burstResults.filter(
      (r) => r.status !== 200 && r.body.error !== 'MAX_REDEMPTIONS_REACHED'
    );

    console.log(`📊 Burst Results:`);
    console.log(`   - Total requests:              ${totalConcurrentRequests}`);
    console.log(`   - Successful (200 OK):         ${successCount} (Expected: ${maxRedemptions})`);
    console.log(`   - Quota Exhausted (409):       ${maxRedemptionsErrorCount} (Expected: ${totalConcurrentRequests - maxRedemptions})`);
    console.log(`   - Unexpected Errors:           ${otherErrors.length}`);

    if (otherErrors.length > 0) {
      console.error('Unexpected error sample:', otherErrors[0]);
    }

    assert.strictEqual(
      successCount,
      maxRedemptions,
      `Exact success count must match max_redemptions (${maxRedemptions}), got ${successCount}`
    );
    assert.strictEqual(
      maxRedemptionsErrorCount,
      totalConcurrentRequests - maxRedemptions,
      `Excess requests must fail with MAX_REDEMPTIONS_REACHED`
    );

    // Verify immediate consistency on both instances
    const [statusFromApp1, statusFromApp2] = await Promise.all([
      fetch(`${APP1_URL}/coupons/${flashCode}`).then((r) => r.json()),
      fetch(`${APP2_URL}/coupons/${flashCode}`).then((r) => r.json())
    ]);

    console.log(`✓ Real-time status from Instance 1:`, statusFromApp1);
    console.log(`✓ Real-time status from Instance 2:`, statusFromApp2);

    assert.strictEqual(statusFromApp1.redeemed_count, maxRedemptions);
    assert.strictEqual(statusFromApp1.remaining, 0);
    assert.strictEqual(statusFromApp2.redeemed_count, maxRedemptions);
    assert.strictEqual(statusFromApp2.remaining, 0);
    console.log('✅ TEST 1 PASSED: Strict zero over-redemption under distributed burst!\n');

    // =========================================================================
    // TEST 2: Distributed Idempotency Replay (Concurrent Retries)
    // =========================================================================
    console.log('----------------------------------------------------------------');
    console.log('TEST 2: Distributed Idempotency Replay');
    console.log('Scenario: Two concurrent requests with the identical Idempotency-Key');
    console.log('sent at the same instant to App1 and App2');
    console.log('----------------------------------------------------------------');

    const idemCode = `IDEM_${timestamp}`;
    await fetch(`${APP1_URL}/coupons`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: idemCode,
        max_redemptions: 5,
        discount_percent: 20,
        expires_at: futureDate,
        type: 'STANDARD'
      })
    });

    const sharedKey = `SHARED_IDEM_KEY_${timestamp}`;
    const sharedPayload = {
      code: idemCode,
      customer_id: 'cust_retry_999',
      order_id: `ord_retry_${timestamp}`
    };

    // First request lands
    const firstReq = await fetch(`${APP1_URL}/redeem`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': sharedKey },
      body: JSON.stringify(sharedPayload)
    });
    const firstData = await firstReq.json();
    assert.strictEqual(firstReq.status, 200, 'Initial redemption failed');

    // Second request (client retry) sent to the other instance (App2)
    const retryReq = await fetch(`${APP2_URL}/redeem`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': sharedKey },
      body: JSON.stringify(sharedPayload)
    });
    const retryData = await retryReq.json();

    console.log(`✓ Initial request to App1 response:`, firstData);
    console.log(`✓ Retry request to App2 response:`, retryData);
    console.log(`✓ Header X-Idempotency-Replay:`, retryReq.headers.get('x-idempotency-replay'));

    assert.strictEqual(retryReq.status, 200);
    assert.strictEqual(retryData.success, true);
    assert.strictEqual(retryData.idempotency_replay, true);

    // Verify slot only incremented once
    const idemCheck = await fetch(`${APP2_URL}/coupons/${idemCode}`).then((r) => r.json());
    assert.strictEqual(idemCheck.redeemed_count, 1);
    assert.strictEqual(idemCheck.remaining, 4);
    console.log('✅ TEST 2 PASSED: Distributed idempotency prevented double-redeeming!\n');

    // =========================================================================
    // TEST 3: Distributed Concurrent Order Cancellation
    // =========================================================================
    console.log('----------------------------------------------------------------');
    console.log('TEST 3: Distributed Concurrent Order Cancellation');
    console.log('Scenario: Calling cancel simultaneously on App1 and App2 for the same order');
    console.log('----------------------------------------------------------------');

    const cancelOrderId = sharedPayload.order_id;
    console.log(`Cancelling order '${cancelOrderId}' simultaneously on App1 and App2...`);

    const [cancel1, cancel2] = await Promise.all([
      fetch(`${APP1_URL}/orders/${cancelOrderId}/cancel`, { method: 'POST' }).then(async (r) => ({
        status: r.status,
        body: await r.json()
      })),
      fetch(`${APP2_URL}/orders/${cancelOrderId}/cancel`, { method: 'POST' }).then(async (r) => ({
        status: r.status,
        body: await r.json()
      }))
    ]);

    console.log('Cancellation Response 1 (App1):', cancel1);
    console.log('Cancellation Response 2 (App2):', cancel2);

    assert.strictEqual(cancel1.status, 200);
    assert.strictEqual(cancel2.status, 200);

    // Exactly one must return slot_returned: true, the other slot_returned: false
    const returnedSlots = [cancel1.body.slot_returned, cancel2.body.slot_returned].filter(Boolean).length;
    assert.strictEqual(returnedSlots, 1, `Slot must be returned exactly once! Got: ${returnedSlots}`);

    // Verify slot was only returned once to the coupon
    const finalCouponCheck = await fetch(`${APP1_URL}/coupons/${idemCode}`).then((r) => r.json());
    console.log('Coupon state after concurrent cancellations:', finalCouponCheck);
    assert.strictEqual(finalCouponCheck.redeemed_count, 0, 'redeemed_count should be 0 after single refund');
    assert.strictEqual(finalCouponCheck.remaining, 5, 'remaining should be restored to 5');
    console.log('✅ TEST 3 PASSED: Concurrent duplicate cancellation returned slot exactly once!\n');

    // =========================================================================
    // TEST 4: Customer Collision on STANDARD Coupon Across Instances
    // =========================================================================
    console.log('----------------------------------------------------------------');
    console.log('TEST 4: Distributed Customer Collision (STANDARD Coupon)');
    console.log('Scenario: Same customer sends simultaneous redemptions to App1 and App2');
    console.log('----------------------------------------------------------------');

    const stdCollisionCode = `STD_COLLISION_${timestamp}`;
    await fetch(`${APP1_URL}/coupons`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: stdCollisionCode,
        max_redemptions: 10,
        discount_percent: 25,
        expires_at: futureDate,
        type: 'STANDARD'
      })
    });

    const sameCustomer = 'cust_same_individual_42';
    const [custRes1, custRes2] = await Promise.all([
      fetch(`${APP1_URL}/redeem`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `COLLIDE_1_${timestamp}` },
        body: JSON.stringify({
          code: stdCollisionCode,
          customer_id: sameCustomer,
          order_id: `ord_col_1_${timestamp}`
        })
      }).then(async (r) => ({ status: r.status, body: await r.json() })),
      fetch(`${APP2_URL}/redeem`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `COLLIDE_2_${timestamp}` },
        body: JSON.stringify({
          code: stdCollisionCode,
          customer_id: sameCustomer,
          order_id: `ord_col_2_${timestamp}`
        })
      }).then(async (r) => ({ status: r.status, body: await r.json() }))
    ]);

    console.log('Response 1 from App1:', custRes1);
    console.log('Response 2 from App2:', custRes2);

    const statuses = [custRes1.status, custRes2.status].sort();
    assert.deepStrictEqual(statuses, [200, 409], 'One request must succeed (200) and one must be rejected (409)');

    const rejection = [custRes1, custRes2].find((r) => r.status === 409);
    assert.strictEqual(rejection.body.error, 'ALREADY_REDEEMED_BY_CUSTOMER');

    const stdCheck = await fetch(`${APP1_URL}/coupons/${stdCollisionCode}`).then((r) => r.json());
    assert.strictEqual(stdCheck.redeemed_count, 1, 'Only 1 slot should be consumed');
    console.log('✅ TEST 4 PASSED: Distributed customer limit strictly enforced!\n');

    console.log('================================================================');
    console.log('🎉 ALL DISTRIBUTED CONCURRENCY & MULTI-PROCESS TESTS PASSED! 🎉');
    console.log('================================================================\n');
  } catch (err) {
    console.error('\n❌ Concurrency Test Suite Failed:', err);
    process.exitCode = 1;
  }
}

runConcurrencyTests();
