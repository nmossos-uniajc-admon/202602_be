const express = require('express');
const controller = require('../controllers/authController');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

router.post('/login', controller.login);
router.post('/refresh', controller.refresh);
router.post('/logout', controller.logout);
router.post('/change-password', authenticate, controller.changePassword);
router.get('/me', authenticate, controller.me);

module.exports = router;
