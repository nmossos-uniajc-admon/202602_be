const express = require('express');
const controller = require('../controllers/userController');
const { authenticate, authorize, selfOrAdmin } = require('../middleware/auth');

const router = express.Router();

router.use(authenticate);

router.get('/', authorize('ADMIN'), controller.list);
router.post('/', authorize('ADMIN'), controller.create);

router.get('/:id', authorize('ADMIN', 'TRAINER', 'ATHLETE'), selfOrAdmin, controller.getById);
router.put('/:id', authorize('ADMIN', 'TRAINER', 'ATHLETE'), selfOrAdmin, controller.update);
router.delete('/:id', authorize('ADMIN'), controller.remove);

module.exports = router;
