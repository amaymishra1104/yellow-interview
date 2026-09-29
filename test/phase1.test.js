const assert = require('assert');
const http = require('http');
const app = require('../src/app');
const { getPool, closePool } = require('../src/config/db');

async function runPhase1Tests() {
  console.log('🧪 Starting Phase 1 Verification Tests...\n');

  let server;
  const PORT = 3999;
  const BASE_URL = `http://127.0.0.1:${PORT}`;

  try {
    // 1. Start test server
    await new Promise((resolve) => {
      server = app.listen(PORT, resolve);
    });
    console.log(`✓ Test server running on ${BASE_URL}`);

    // Test 1: GET /health
    console.log('\n--- Test 1: Healthcheck endpoint (GET /health) ---');
    const healthRes = await fetch(`${BASE_URL}/health`);
    const healthData = await healthRes.json();
    console.log('Health response status:', healthRes.status, healthData);
    assert.strictEqual(healthRes.status, 200, 'Healthcheck status should be 200');
    assert.strictEqual(healthData.status, 'healthy', 'Service should report healthy');
    assert.strictEqual(healthData.database.connected, true, 'Database should be connected');
    console.log('✓ Healthcheck endpoint passed.');

    // Test 2: Validation Failure on POST /coupons
    console.log('\n--- Test 2: Validation error handling on POST /coupons ---');
    const invalidCouponRes = await fetch(`${BASE_URL}/coupons`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: '', // invalid empty
        max_redemptions: -5, // invalid negative
        discount_percent: 150, // invalid > 100
        expires_at: 'not-a-date', // invalid date
        type: 'INVALID_TYPE' // invalid enum
      })
    });
    const invalidCouponData = await invalidCouponRes.json();
    console.log('Invalid coupon status:', invalidCouponRes.status, invalidCouponData);
    assert.strictEqual(invalidCouponRes.status, 400, 'Should return 400 for validation errors');
    assert.strictEqual(invalidCouponData.error, 'VALIDATION_ERROR', 'Error code should be VALIDATION_ERROR');
    assert.ok(invalidCouponData.details.length >= 4, 'Should contain detailed validation errors');
    console.log('✓ Validation error handling passed.');

    // Test 3: Successful creation of STANDARD coupon
    console.log('\n--- Test 3: Create valid STANDARD coupon (POST /coupons) ---');
    const testCode = `TEST_PHASE1_${Date.now()}`;
    const futureDate = new Date(Date.now() + 86400000 * 7).toISOString(); // 7 days in future
    const createRes = await fetch(`${BASE_URL}/coupons`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: testCode,
        max_redemptions: 15,
        discount_percent: 25,
        expires_at: futureDate,
        type: 'STANDARD'
      })
    });
    const createData = await createRes.json();
    console.log('Create coupon status:', createRes.status, createData);
    assert.strictEqual(createRes.status, 201, 'Should return 201 Created');
    assert.strictEqual(createData.code, testCode);
    assert.strictEqual(createData.max_redemptions, 15);
    assert.strictEqual(createData.redeemed_count, 0);
    assert.strictEqual(createData.remaining, 15);
    assert.strictEqual(createData.type, 'STANDARD');
    console.log('✓ Coupon creation passed.');

    // Test 4: Duplicate coupon creation rejection
    console.log('\n--- Test 4: Duplicate coupon rejection (POST /coupons) ---');
    const duplicateRes = await fetch(`${BASE_URL}/coupons`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: testCode,
        max_redemptions: 20,
        discount_percent: 30,
        expires_at: futureDate,
        type: 'STANDARD'
      })
    });
    const duplicateData = await duplicateRes.json();
    console.log('Duplicate status:', duplicateRes.status, duplicateData);
    assert.strictEqual(duplicateRes.status, 409, 'Should return 409 Conflict');
    assert.strictEqual(duplicateData.error, 'COUPON_ALREADY_EXISTS');
    console.log('✓ Duplicate coupon rejection passed.');

    // Test 5: GET /coupons/:code for existing coupon
    console.log('\n--- Test 5: Query coupon status (GET /coupons/:code) ---');
    const getRes = await fetch(`${BASE_URL}/coupons/${testCode}`);
    const getData = await getRes.json();
    console.log('Get coupon status:', getRes.status, getData);
    assert.strictEqual(getRes.status, 200, 'Should return 200 OK');
    assert.strictEqual(getData.redeemed_count, 0);
    assert.strictEqual(getData.remaining, 15);
    assert.strictEqual(getData.max_redemptions, 15);
    console.log('✓ Query coupon status passed.');

    // Test 6: GET /coupons/:code for non-existent coupon
    console.log('\n--- Test 6: Query non-existent coupon (GET /coupons/:code) ---');
    const notFoundRes = await fetch(`${BASE_URL}/coupons/NON_EXISTENT_CODE_999`);
    const notFoundData = await notFoundRes.json();
    console.log('Not found status:', notFoundRes.status, notFoundData);
    assert.strictEqual(notFoundRes.status, 404, 'Should return 404 Not Found');
    assert.strictEqual(notFoundData.error, 'UNKNOWN_COUPON');
    console.log('✓ Non-existent coupon 404 passed.');

    console.log('\n🎉 ALL PHASE 1 TESTS PASSED SUCCESSFULLY! 🎉\n');
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

runPhase1Tests();
