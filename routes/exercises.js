const express = require('express');
const controller = require('../controllers/exerciseController');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();

router.use(authenticate);

router.get('/', authorize('ADMIN', 'TRAINER', 'ATHLETE'), controller.list);
router.get('/:id', authorize('ADMIN', 'TRAINER', 'ATHLETE'), controller.getById);
router.post('/', authorize('ADMIN'), controller.create);
router.put('/:id', authorize('ADMIN'), controller.update);
router.delete('/:id', authorize('ADMIN'), controller.remove);

module.exports = router;
