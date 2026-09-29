-- Schema definition for Coupon Redemption Service
-- Hand-crafted MySQL 8.0 DDL (InnoDB)

CREATE DATABASE IF NOT EXISTS coupon_db;
USE coupon_db;

-- 1. Coupons Table
-- Holds global coupon rules, limits, and live redemption counts
CREATE TABLE IF NOT EXISTS coupons (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    code VARCHAR(64) NOT NULL UNIQUE,
    max_redemptions INT UNSIGNED NOT NULL,
    redeemed_count INT UNSIGNED NOT NULL DEFAULT 0,
    discount_percent TINYINT UNSIGNED NOT NULL,
    expires_at DATETIME(3) NOT NULL,
    type ENUM('STANDARD', 'STACKABLE') NOT NULL,
    created_at TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP(3),
    updated_at TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    CONSTRAINT chk_redeemed_count_max CHECK (redeemed_count <= max_redemptions),
    CONSTRAINT chk_redeemed_count_min CHECK (redeemed_count >= 0),
    CONSTRAINT chk_discount_range CHECK (discount_percent > 0 AND discount_percent <= 100),
    INDEX idx_coupons_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Redemptions Table
-- Audit record of every completed redemption and its order association
CREATE TABLE IF NOT EXISTS redemptions (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    coupon_id BIGINT NOT NULL,
    customer_id VARCHAR(64) NOT NULL,
    order_id VARCHAR(64) NOT NULL,
    status ENUM('ACTIVE', 'CANCELLED') NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP(3),
    updated_at TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    CONSTRAINT fk_redemptions_coupon FOREIGN KEY (coupon_id) REFERENCES coupons(id) ON DELETE RESTRICT,
    CONSTRAINT uq_active_order UNIQUE (order_id),
    INDEX idx_coupon_customer_status (coupon_id, customer_id, status),
    INDEX idx_order_id (order_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Idempotency Records Table
-- Protects against duplicate submissions using an atomic lock-and-replay lifecycle
CREATE TABLE IF NOT EXISTS idempotency_records (
    idempotency_key VARCHAR(128) PRIMARY KEY,
    request_hash VARCHAR(64) NOT NULL,
    status ENUM('IN_PROGRESS', 'COMPLETED') NOT NULL DEFAULT 'IN_PROGRESS',
    response_status INT NULL,
    response_body JSON NULL,
    created_at TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP(3),
    updated_at TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
