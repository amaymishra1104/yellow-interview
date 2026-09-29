const express = require('express');
const { param } = require('express-validator');
const OrderController = require('../controllers/order.controller');
const { handleValidationErrors } = require('../middlewares/validate.middleware');

const router = express.Router();

/**
 * Validation rules for POST /orders/:order_id/cancel
 */
const cancelOrderValidators = [
  param('order_id')
    .trim()
    .notEmpty()
    .withMessage('order_id parameter is required')
    .isLength({ min: 1, max: 64 })
    .withMessage('order_id must be between 1 and 64 characters'),

  handleValidationErrors
];

router.post('/orders/:order_id/cancel', cancelOrderValidators, OrderController.cancelOrderRedemption);

module.exports = router;
