const routineModel = require('../models/routine');
const { ApiError, sendSuccess } = require('../utils/http');
const { parseUuid } = require('../utils/validate');
const { validateDayPayload, validateExercisePayload } = require('../utils/routinePayload');

function ownsRow(row, userId) {
  return row.owner_user_id === userId || row.created_by_user_id === userId;
}

async function assertRoutineAccess(routineId, userId) {
  const row = await routineModel.getOwnership(routineId);
  if (!row) {
    throw new ApiError(404, `No existe la rutina con id ${routineId}.`);
  }
  if (!ownsRow(row, userId)) {
    throw new ApiError(403, 'No tiene acceso a esta rutina.');
  }
  return row;
}

async function assertDayBelongsToRoutine(routineId, dayId) {
  const day = await routineModel.findDayRaw(dayId);
  if (!day || day.routine_id !== routineId) {
    throw new ApiError(404, `No existe el día ${dayId} en la rutina ${routineId}.`);
  }
  return day;
}

async function assertExerciseBelongsToDay(routineId, dayId, exerciseId) {
  const exercise = await routineModel.findExerciseRaw(exerciseId);
  if (!exercise || exercise.routine_id !== routineId || exercise.routine_day_id !== dayId) {
    throw new ApiError(404, `No existe el ejercicio ${exerciseId} en ese día de la rutina.`);
  }
  return exercise;
}

async function addDay(req, res) {
  const routineId = parseUuid(req.params.routineId, 'routineId');
  await assertRoutineAccess(routineId, req.user.id);

  const data = validateDayPayload(req.body || {}, { partial: false });
  try {
    const day = await routineModel.addDay(routineId, data);
    return sendSuccess(res, { status: 201, data: day, message: 'Día agregado correctamente.' });
  } catch (err) {
    if (err && err.code === '23505') {
      throw new ApiError(409, 'Ya existe un día con ese número en la rutina.');
    }
    throw err;
  }
}

async function updateDay(req, res) {
  const routineId = parseUuid(req.params.routineId, 'routineId');
  const dayId = parseUuid(req.params.dayId, 'dayId');
  await assertRoutineAccess(routineId, req.user.id);
  await assertDayBelongsToRoutine(routineId, dayId);

  const data = validateDayPayload(req.body || {}, { partial: true });
  if (Object.keys(data).length === 0) {
    throw new ApiError(400, 'Datos de entrada inválidos.', ['Debe proporcionar al menos un campo a actualizar.']);
  }

  try {
    const day = await routineModel.updateDay(dayId, data);
    return sendSuccess(res, { status: 200, data: day, message: 'Día actualizado correctamente.' });
  } catch (err) {
    if (err && err.code === '23505') {
      throw new ApiError(409, 'Ya existe un día con ese número en la rutina.');
    }
    throw err;
  }
}

async function deleteDay(req, res) {
  const routineId = parseUuid(req.params.routineId, 'routineId');
  const dayId = parseUuid(req.params.dayId, 'dayId');
  await assertRoutineAccess(routineId, req.user.id);
  await assertDayBelongsToRoutine(routineId, dayId);

  await routineModel.deleteDay(dayId);
  return sendSuccess(res, { status: 200, data: null, message: 'Día eliminado correctamente.' });
}

async function addExercise(req, res) {
  const routineId = parseUuid(req.params.routineId, 'routineId');
  const dayId = parseUuid(req.params.dayId, 'dayId');
  await assertRoutineAccess(routineId, req.user.id);
  await assertDayBelongsToRoutine(routineId, dayId);

  const data = validateExercisePayload(req.body || {}, { partial: false });
  if (!(await routineModel.exerciseExists(data.exerciseId))) {
    throw new ApiError(400, 'Referencias inválidas.', [
      `El ejercicio ${data.exerciseId} no existe o está borrado.`,
    ]);
  }

  try {
    const exercise = await routineModel.addExercise(dayId, data);
    return sendSuccess(res, { status: 201, data: exercise, message: 'Ejercicio agregado al día correctamente.' });
  } catch (err) {
    if (err && err.code === '23505') {
      throw new ApiError(409, 'Ya existe un ejercicio con ese orderIndex en el día.');
    }
    throw err;
  }
}

async function updateExercise(req, res) {
  const routineId = parseUuid(req.params.routineId, 'routineId');
  const dayId = parseUuid(req.params.dayId, 'dayId');
  const exerciseId = parseUuid(req.params.exerciseId, 'exerciseId');
  await assertRoutineAccess(routineId, req.user.id);
  const current = await assertExerciseBelongsToDay(routineId, dayId, exerciseId);

  const data = validateExercisePayload(req.body || {}, {
    partial: true,
    currentWorkType: current.work_type,
  });

  if (data.exerciseId !== undefined && !(await routineModel.exerciseExists(data.exerciseId))) {
    throw new ApiError(400, 'Referencias inválidas.', [
      `El ejercicio ${data.exerciseId} no existe o está borrado.`,
    ]);
  }

  try {
    const exercise = await routineModel.updateExercise(exerciseId, data);
    if (!exercise) {
      throw new ApiError(404, `No existe el ejercicio ${exerciseId} en ese día de la rutina.`);
    }
    return sendSuccess(res, { status: 200, data: exercise, message: 'Ejercicio actualizado correctamente.' });
  } catch (err) {
    if (err && err.code === '23505') {
      throw new ApiError(409, 'Ya existe un ejercicio con ese orderIndex en el día.');
    }
    throw err;
  }
}

async function deleteExercise(req, res) {
  const routineId = parseUuid(req.params.routineId, 'routineId');
  const dayId = parseUuid(req.params.dayId, 'dayId');
  const exerciseId = parseUuid(req.params.exerciseId, 'exerciseId');
  await assertRoutineAccess(routineId, req.user.id);
  await assertExerciseBelongsToDay(routineId, dayId, exerciseId);

  await routineModel.deleteExercise(exerciseId);
  return sendSuccess(res, { status: 200, data: null, message: 'Ejercicio eliminado del día correctamente.' });
}

module.exports = {
  addDay,
  updateDay,
  deleteDay,
  addExercise,
  updateExercise,
  deleteExercise,
};
