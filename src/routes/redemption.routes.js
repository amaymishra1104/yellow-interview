const express = require('express');
const { body, header } = require('express-validator');
const RedemptionController = require('../controllers/redemption.controller');
const { handleValidationErrors } = require('../middlewares/validate.middleware');

const router = express.Router();

/**
 * Validation rules for POST /redeem
 */
const redeemValidators = [
  header('Idempotency-Key')
    .custom((val, { req }) => {
      // Allow case-insensitive idempotency key header
      const key = val || req.headers['idempotency-key'];
      if (!key || typeof key !== 'string' || key.trim() === '') {
        throw new Error('Idempotency-Key header is required');
      }
      if (key.length > 128) {
        throw new Error('Idempotency-Key must not exceed 128 characters');
      }
      return true;
    }),

  body('code')
    .trim()
    .notEmpty()
    .withMessage('Coupon code is required')
    .isLength({ min: 1, max: 64 })
    .withMessage('Coupon code must be between 1 and 64 characters'),

  body('customer_id')
    .trim()
    .notEmpty()
    .withMessage('customer_id is required')
    .isLength({ min: 1, max: 64 })
    .withMessage('customer_id must be between 1 and 64 characters'),

  body('order_id')
    .trim()
    .notEmpty()
    .withMessage('order_id is required')
    .isLength({ min: 1, max: 64 })
    .withMessage('order_id must be between 1 and 64 characters'),

  handleValidationErrors
];

router.post('/redeem', redeemValidators, RedemptionController.redeem);

module.exports = router;
