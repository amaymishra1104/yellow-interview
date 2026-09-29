# Coupon Redemption Service — Distributed Backend

A production-grade, transactionally consistent coupon redemption microservice built for high-concurrency e-commerce checkouts and flash sales.

Built with **Node.js**, **Express.js**, **express-validator**, and **MySQL 8.0 (InnoDB)**, containerized with **Docker & Docker Compose**.

All concurrency controls and ACID guarantees are enforced exclusively at the **database layer** using pessimistic row-level locking (`SELECT ... FOR UPDATE`), atomic transactions, and engine-level check constraints. **No in-memory locks** are used, ensuring 100% correctness across multiple distributed application nodes.

---

## 1. System Architecture & Multi-Node Topology

The environment spins up **two independent application containers** pointing to a shared MySQL 8.0 database:

```
                          ┌──────────────────────────┐
                          │   Client / Test Runner   │
                          └─────────────┬────────────┘
                                        │
                 ┌──────────────────────┴──────────────────────┐
                 │                                             │
                 ▼ (Port 3001)                                 ▼ (Port 3002)
       ┌───────────────────┐                         ┌───────────────────┐
       │   coupon_app_1    │                         │   coupon_app_2    │
       │ (Node.js Process) │                         │ (Node.js Process) │
       └─────────┬─────────┘                         └─────────┬─────────┘
                 │                                             │
                 └──────────────────────┬──────────────────────┘
                                        │
                                        ▼ (Port 3306)
                             ┌─────────────────────┐
                             │    coupon_mysql     │
                             │ (MySQL 8.0 InnoDB)  │
                             └─────────────────────┘
```

* **coupon_mysql** (`localhost:3306`): Runs MySQL 8.0 with InnoDB engine and automatic schema initialization via [`schema.sql`](schema.sql).
* **coupon_app_1** (`localhost:3001`): Standalone Node.js instance #1.
* **coupon_app_2** (`localhost:3002`): Standalone Node.js instance #2.

---

## 2. Quick Setup & Docker Compose Commands

### Prerequisites
* [Docker Desktop](https://www.docker.com/products/docker-desktop/) (v20+ with Docker Compose v2+)
* [Node.js](https://nodejs.org/) (v18+ recommended if running tests or local scripts)

---

### Step 1: Start All Services via Docker Compose
Run the following command in the project root to build the images, initialize MySQL, and launch both app instances:

```bash
docker compose up -d --build
```

### Step 2: Check Container Status & Health
```bash
docker compose ps
```
You should see all three containers running:
* `coupon_mysql` — Status: `Up (healthy)` on port `3306`
* `coupon_app_1` — Status: `Up` on port `3001->3000`
* `coupon_app_2` — Status: `Up` on port `3002->3000`

### Step 3: Verify Healthcheck Endpoints
Verify both instances are reachable and connected to MySQL:
```bash
# Check App Instance 1
curl http://localhost:3001/health

# Check App Instance 2
curl http://localhost:3002/health
```

Expected Response (`200 OK`):
```json
{
  "status": "healthy",
  "service": "coupon-redemption-service",
  "timestamp": "2026-09-29T09:06:15.000Z",
  "database": {
    "connected": true,
    "db_time": "2026-09-29 09:06:15"
  }
}
```

---

### Other Useful Docker Compose Commands

```bash
# View live tail logs from all containers
docker compose logs -f

# View logs for a specific instance
docker compose logs -f app1
docker compose logs -f app2

# Restart application instances
docker compose restart app1 app2

# Stop all containers (preserve database volume)
docker compose down

# Stop and wipe database volume (clean slate)
docker compose down -v
```

---

## 3. How Each Candidate Brief Rule Was Verified

All rules were validated against **both `app1` (port 3001) and `app2` (port 3002)** running simultaneously against the same MySQL database.

### Rule 1: No Over-Redemption Beyond `max_redemptions` Under Burst Concurrency
* **Mechanism:** Transaction begins with `SELECT ... FROM coupons WHERE code = ? FOR UPDATE`. This serializes all simultaneous checkout requests at the database engine level. Schema check `chk_redeemed_count_max` guarantees invariant $redeemed\_count \le max\_redemptions$.
* **Verification Test:** 
  * Created coupon `FLASH_50` with `max_redemptions: 10`.
  * Fired **50 simultaneous checkout requests** interleaved across port 3001 and 3002.
  * **Result:** Exactly **10 requests succeeded (`200 OK`)**, and exactly **40 requests were rejected (`409 MAX_REDEMPTIONS_REACHED`)**.
  * Final counts verified on both nodes: `redeemed_count = 10`, `remaining = 0`.

### Rule 2: Single Use per Customer for `STANDARD` Coupons
* **Mechanism:** Queries `redemptions` table within the locked transaction: `SELECT id FROM redemptions WHERE coupon_id = ? AND customer_id = ? AND status = 'ACTIVE'`.
* **Verification Test:** 
  * The same customer submitted two redemptions for different orders simultaneously to `app1` and `app2`.
  * **Result:** Exactly 1 succeeded with `200 OK`, and the concurrent attempt was rejected with `409 ALREADY_REDEEMED_BY_CUSTOMER`.

### Rule 3: `STACKABLE` Coupons Allow Multiple Uses per Customer
* **Mechanism:** For `type = 'STACKABLE'`, customer-level checks are skipped while respecting global `max_redemptions`.
* **Verification Test:** 
  * Customer redeemed the same stackable coupon twice across two separate orders successfully.
  * A third order exceeding `max_redemptions` was rejected with `409 MAX_REDEMPTIONS_REACHED`.

### Rule 4: Atomic Expiry Instant Consistency
* **Mechanism:** The expiration timestamp is compared against the database engine's clock `UTC_TIMESTAMP(3)` inside the locked row check (`expires_at <= current_db_time`), eliminating cross-node clock drift.
* **Verification Test:** 
  * Expired coupons rejected immediately with `410 COUPON_EXPIRED`.
  * Simultaneous requests at boundary resolve consistently.

### Rule 5: Idempotent Order Cancellation (`POST /orders/:order_id/cancel`)
* **Mechanism:** Reversal locks the redemption row by `order_id` (`FOR UPDATE`). If `ACTIVE`, marks status `'CANCELLED'` and decrements `coupons.redeemed_count`. If already `'CANCELLED'`, returns a no-op `200 OK` (`slot_returned: false, already_cancelled: true`).
* **Verification Test:** 
  * Fired two simultaneous cancellation calls for the same order—one to `app1` and one to `app2`.
  * **Result:** Exactly one call returned `slot_returned: true` (slot count decremented by 1). The second call returned `slot_returned: false, already_cancelled: true`. The slot was **never double-refunded**.

### Rule 6: Network Retry Idempotency (`Idempotency-Key` Header)
* **Mechanism:** Callers send an `Idempotency-Key`. The key is atomically claimed in `idempotency_records` (`IN_PROGRESS`). Upon commit, the response payload is cached (`COMPLETED`).
* **Verification Test:** 
  * Retrying a redemption with the same key and payload returned the cached response with `idempotency_replay: true` and header `X-Idempotency-Replay: true`. The coupon was charged **only once**.
  * Reusing the same key with an altered payload returned `422 IDEMPOTENCY_KEY_MISMATCH`.

### Rule 7: Real-Time Consistent State (`GET /coupons/:code`)
* **Mechanism:** Direct indexed read against MySQL InnoDB table, avoiding eventual consistency or stale cache lag.
* **Verification Test:** Returns `{ redeemed_count, remaining, max_redemptions }` matching live database state immediately after each transaction.

---

## 4. Running the Automated Test Suites

Ensure Docker containers are running (`docker compose up -d`), then run the test suites:

### 1. Multi-Instance Concurrency Test Suite (Primary)
Tests 50 simultaneous checkouts, distributed idempotency retry, and concurrent duplicate cancellations across `app1:3001` and `app2:3002`:
```bash
npm run test:concurrency
```

### 2. Transactional Edge Cases & Business Rules Suite
Tests customer limits, stackable coupons, expiration deadlines, and order reversals:
```bash
npm run test:phase2
```

### 3. Schema & Validation Suite
Tests request validation, missing parameter rejection, and coupon seeding:
```bash
npm run test:phase1
```

---

## 5. API Reference & Postman Collection

An importable Postman Collection v2.1 is available at:  
👉 **[`postman_collection.json`](postman_collection.json)** *(Import via Postman -> File -> Import)*

### API Endpoints

| Method | Endpoint | Headers | Description |
|---|---|---|---|
| `GET` | `/health` | — | Node & MySQL connectivity healthcheck |
| `POST` | `/coupons` | `Content-Type: application/json` | Seed a new coupon |
| `GET` | `/coupons/:code` | — | Real-time coupon status and remaining slots |
| `POST` | `/redeem` | `Idempotency-Key: <key>`, `Content-Type: application/json` | Concurrency-safe coupon redemption |
| `POST` | `/orders/:order_id/cancel` | — | Idempotent slot return for an order |

---

### Sample cURL Commands

#### 1. Seed a Coupon
```bash
curl -X POST http://localhost:3001/coupons \
  -H "Content-Type: application/json" \
  -d '{
    "code": "FLASHSALE50",
    "max_redemptions": 10,
    "discount_percent": 50,
    "expires_at": "2026-12-31T23:59:59.000Z",
    "type": "STANDARD"
  }'
```

#### 2. Redeem a Coupon
```bash
curl -X POST http://localhost:3001/redeem \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: req-alpha-1001" \
  -d '{
    "code": "FLASHSALE50",
    "customer_id": "cust_123",
    "order_id": "ord_9999"
  }'
```

#### 3. Inspect Coupon Status
```bash
curl http://localhost:3001/coupons/FLASHSALE50
```

#### 4. Cancel an Order (Return Slot)
```bash
curl -X POST http://localhost:3001/orders/ord_9999/cancel
```

---

## 6. Local Development (Without Docker Compose for App)

If you prefer to run the Node.js server locally on host port 3000 while MySQL runs in Docker:

```bash
# 1. Start MySQL container only
docker compose up -d mysql

# 2. Run database migration
npm run migrate

# 3. Start local development server
npm run dev
```
Local service will run on `http://localhost:3000`.
