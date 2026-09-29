const express = require('express');
const healthRoutes = require('./health.routes');
const couponRoutes = require('./coupon.routes');
const redemptionRoutes = require('./redemption.routes');
const orderRoutes = require('./order.routes');

const router = express.Router();

router.use('/', healthRoutes);
router.use('/', couponRoutes);
router.use('/', redemptionRoutes);
router.use('/', orderRoutes);

module.exports = router;
