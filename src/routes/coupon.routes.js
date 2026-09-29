const express = require('express');
const { body, param } = require('express-validator');
const CouponController = require('../controllers/coupon.controller');
const { handleValidationErrors } = require('../middlewares/validate.middleware');

const router = express.Router();

/**
 * Validation rules for POST /coupons
 */
const createCouponValidators = [
  body('code')
    .trim()
    .notEmpty()
    .withMessage('Coupon code is required')
    .isLength({ min: 1, max: 64 })
    .withMessage('Coupon code must be between 1 and 64 characters')
    .matches(/^[A-Za-z0-9_-]+$/)
    .withMessage('Coupon code can only contain alphanumeric characters, underscores, and dashes'),

  body('max_redemptions')
    .notEmpty()
    .withMessage('max_redemptions is required')
    .isInt({ min: 1 })
    .withMessage('max_redemptions must be an integer greater than or equal to 1'),

  body('discount_percent')
    .notEmpty()
    .withMessage('discount_percent is required')
    .isInt({ min: 1, max: 100 })
    .withMessage('discount_percent must be an integer between 1 and 100'),

  body('expires_at')
    .notEmpty()
    .withMessage('expires_at is required')
    .isISO8601()
    .withMessage('expires_at must be a valid ISO 8601 timestamp')
    .custom((value) => {
      const expirationDate = new Date(value);
      if (isNaN(expirationDate.getTime())) {
        throw new Error('Invalid date value');
      }
      return true;
    }),

  body('type')
    .notEmpty()
    .withMessage('type is required')
    .isIn(['STANDARD', 'STACKABLE'])
    .withMessage("type must be either 'STANDARD' or 'STACKABLE'"),

  handleValidationErrors
];

/**
 * Validation rules for GET /coupons/:code
 */
const getCouponValidators = [
  param('code')
    .trim()
    .notEmpty()
    .withMessage('Coupon code parameter is required')
    .isLength({ min: 1, max: 64 })
    .withMessage('Coupon code must be between 1 and 64 characters'),

  handleValidationErrors
];

// Mount endpoints
router.post('/coupons', createCouponValidators, CouponController.createCoupon);
router.get('/coupons/:code', getCouponValidators, CouponController.getCouponByCode);

module.exports = router;
