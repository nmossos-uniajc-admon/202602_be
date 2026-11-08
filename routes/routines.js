const express = require('express');
const controller = require('../controllers/routineController');
const structure = require('../controllers/routineStructureController');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();

router.use(authenticate);
router.use(authorize('TRAINER', 'ATHLETE'));

router.get('/', controller.list);
router.post('/', controller.create);
router.get('/:id', controller.getById);
router.put('/:id', controller.update);
router.delete('/:id', controller.remove);

router.post('/:routineId/days', structure.addDay);
router.put('/:routineId/days/:dayId', structure.updateDay);
router.delete('/:routineId/days/:dayId', structure.deleteDay);
router.post('/:routineId/days/:dayId/exercises', structure.addExercise);
router.put('/:routineId/days/:dayId/exercises/:exerciseId', structure.updateExercise);
router.delete('/:routineId/days/:dayId/exercises/:exerciseId', structure.deleteExercise);

module.exports = router;
