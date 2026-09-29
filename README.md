# Coupon Redemption Service — High-Concurrency Backend

A transactional, distributed coupon redemption engine designed for e-commerce checkouts during high-throughput flash-sale events. Built with **Node.js**, **Express**, **express-validator**, and **MySQL 8.0 (InnoDB)**.

All concurrency control and ACID guarantees live entirely at the **database layer** using pessimistic row-level locking (`SELECT ... FOR UPDATE`), transaction isolation, and atomic constraints. **No in-memory locks** are used, ensuring 100% correctness across horizontally scaled application instances.

---

## 1. Architectural Highlights & Concurrency Model

### Why In-Memory Locks Fail
When multiple application instances (e.g. containers, serverless instances, or separate node processes) serve checkout traffic, an in-memory lock (such as a Node.js mutex, semaphore, or JS variable) only synchronizes threads within that single process. Requests routed to a second instance run in parallel without synchronization, causing double-spending and over-allocation.

### How This Service Guarantees Multi-Process Correctness
* **Pessimistic Row Locking (`SELECT ... FOR UPDATE`):**
  When `POST /redeem` is called, a transaction begins and acquires an exclusive row lock on the coupon row. All concurrent transactions across all app instances trying to redeem the same coupon code are forced into a serialized queue by the MySQL InnoDB lock manager.
* **Deterministic Server Expiry:**
  The expiration condition is evaluated inside the locked transaction using `UTC_TIMESTAMP(3)` from the database server engine, completely eliminating clock drift between different app servers.
* **Hardware/Schema-Level Invariant Enforcement:**
  The MySQL schema enforces `CONSTRAINT chk_redeemed_count_max CHECK (redeemed_count <= max_redemptions)` and `CONSTRAINT chk_redeemed_count_min CHECK (redeemed_count >= 0)` as engine-level safety barriers.
* **Atomic Idempotency Engine:**
  Callers provide an `Idempotency-Key` header on `POST /redeem`. The engine atomically reserves the key in an `idempotency_records` table (`IN_PROGRESS`). Upon transaction commit, the response payload is cached (`COMPLETED`). Retried network requests return the cached response with `idempotency_replay: true` and header `X-Idempotency-Replay: true` without consuming additional slots.
* **Idempotent Order Cancellation:**
  `POST /orders/:order_id/cancel` locks the redemption row by `order_id`. If `ACTIVE`, it sets status to `CANCELLED` and returns the slot (`redeemed_count` decrements). If already `CANCELLED`, it immediately returns a no-op `200 OK` (`slot_returned: false, already_cancelled: true`), preventing multiple slot refunds.

---

## 2. Quick Start with Docker Compose

The environment runs **MySQL 8.0** alongside **two independent application instances** pointing to the same database:

* **MySQL Database**: port `3306`
* **App Instance 1**: port `3001`
* **App Instance 2**: port `3002`

### Start All Services
```bash
docker compose up -d --build
```

### Verify Service Health
```bash
# Check App Instance 1
curl http://localhost:3001/health

# Check App Instance 2
curl http://localhost:3002/health
```

Both endpoints will return:
```json
{
  "status": "healthy",
  "service": "coupon-redemption-service",
  "database": {
    "connected": true,
    "db_time": "2026-09-29 08:32:20"
  }
}
```

---

## 3. Running the Concurrency Test Suite

The automated concurrency test suite (**`test/concurrency.test.js`**) validates the core rules under multi-process execution by firing requests against **both `http://localhost:3001` and `http://localhost:3002` simultaneously**:

```bash
npm run test:concurrency
```

### What the Concurrency Test Proves:
1. **Flash-Sale Burst Test:**
   - Creates a coupon with `max_redemptions = 10`.
   - Fires **50 simultaneous checkout requests** interleaved across port `3001` and `3002`.
   - **Verification:** Exactly **10 requests succeed (`200 OK`)** and **40 requests are rejected (`409 MAX_REDEMPTIONS_REACHED`)**. Live count inspection confirms `redeemed_count == 10` and `remaining == 0`.
2. **Distributed Idempotency Test:**
   - Fires requests with identical `Idempotency-Key` to App1 and App2.
   - **Verification:** The coupon is charged **only once**. The retry receives the cached response with `idempotency_replay: true`.
3. **Distributed Double-Cancellation Test:**
   - Dispatches concurrent cancellation calls for the same order across both app instances.
   - **Verification:** The slot is returned **exactly once** (`redeemed_count` decrements by 1, never 2). The second call returns `already_cancelled: true`.
4. **STANDARD Coupon Customer Collision:**
   - Simultaneously sends two redemptions for the same customer to App1 and App2.
   - **Verification:** Exactly 1 succeeds, and the other fails with `409 ALREADY_REDEEMED_BY_CUSTOMER`.

---

## 4. API Reference & Failure Modes

| Method | Endpoint | Headers | Description |
|---|---|---|---|
| `GET` | `/health` | — | Healthcheck and DB clock synchronization status |
| `POST` | `/coupons` | `Content-Type: application/json` | Seed a new coupon (`STANDARD` or `STACKABLE`) |
| `GET` | `/coupons/:code` | — | Real-time, strictly consistent redemption stats |
| `POST` | `/redeem` | `Idempotency-Key: <key>`, `Content-Type: application/json` | Transactional redemption |
| `POST` | `/orders/:order_id/cancel` | — | Idempotent slot return for an order |

### Standardized Error Codes

* `404 UNKNOWN_COUPON`: Coupon code does not exist.
* `410 COUPON_EXPIRED`: Coupon has passed its `expires_at` timestamp.
* `409 MAX_REDEMPTIONS_REACHED`: All available redemptions globally exhausted.
* `409 ALREADY_REDEEMED_BY_CUSTOMER`: Customer already redeemed this `STANDARD` coupon.
* `409 ORDER_ALREADY_REDEEMED`: Order ID has already redeemed a coupon.
* `422 IDEMPOTENCY_KEY_MISMATCH`: Same idempotency key reused with altered payload.
* `404 ORDER_NOT_FOUND`: Cancellation requested for an unrecorded order.

---

## 5. Postman Collection

A ready-to-import Postman Collection v2.1 is available at [`postman_collection.json`](postman_collection.json).  
Import it into Postman to test all endpoints, edge cases, and responses with pre-configured bodies.
