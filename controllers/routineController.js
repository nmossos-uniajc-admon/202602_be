const routineModel = require('../models/routine');
const { ApiError, sendSuccess } = require('../utils/http');
const { parseUuid, parseBooleanQuery, parsePagination } = require('../utils/validate');
const {
  validateRoutineCreatePayload,
  validateRoutineUpdatePayload,
} = require('../utils/routinePayload');

function isOwnerOrCreator(routine, userId) {
  return routine.ownerUser.id === userId || routine.createdByUser.id === userId;
}

function ownsRow(row, userId) {
  return row.owner_user_id === userId || row.created_by_user_id === userId;
}

async function assertAccess(routineId, userId) {
  const row = await routineModel.getOwnership(routineId);
  if (!row) {
    throw new ApiError(404, `No existe la rutina con id ${routineId}.`);
  }
  if (!ownsRow(row, userId)) {
    throw new ApiError(403, 'No tiene acceso a esta rutina.');
  }
  return row;
}

async function assertExercisesExist(days) {
  const ids = [...new Set(days.flatMap((day) => day.exercises.map((ex) => ex.exerciseId)))];
  if (ids.length === 0) return;

  const missing = await routineModel.findMissingExerciseIds(ids);
  if (missing.length) {
    throw new ApiError(400, 'Referencias inválidas.', [
      `Ejercicios inexistentes o borrados: ${missing.join(', ')}.`,
    ]);
  }
}

async function list(req, res) {
  const search = typeof req.query.search === 'string' ? req.query.search : undefined;
  const isActive = parseBooleanQuery(req.query.is_active);
  const isTemplate = parseBooleanQuery(req.query.is_template);
  const { limit, offset } = parsePagination(req.query);

  const result = await routineModel.findAll({
    userId: req.user.id,
    search,
    isActive,
    isTemplate,
    limit,
    offset,
  });
  return sendSuccess(res, { status: 200, data: result });
}

async function getById(req, res) {
  const id = parseUuid(req.params.id);
  const routine = await routineModel.findById(id);
  if (!routine) {
    throw new ApiError(404, `No existe la rutina con id ${id}.`);
  }
  if (!isOwnerOrCreator(routine, req.user.id)) {
    throw new ApiError(403, 'No tiene acceso a esta rutina.');
  }
  return sendSuccess(res, { status: 200, data: routine });
}

async function create(req, res) {
  const data = validateRoutineCreatePayload(req.body || {});
  await assertExercisesExist(data.days);

  const routine = await routineModel.create(data, req.user.id);
  return sendSuccess(res, {
    status: 201,
    data: routine,
    message: 'Rutina creada correctamente.',
  });
}

async function update(req, res) {
  const id = parseUuid(req.params.id);
  await assertAccess(id, req.user.id);

  const data = validateRoutineUpdatePayload(req.body || {});
  if (data.days !== undefined) {
    await assertExercisesExist(data.days);
  }

  const routine = await routineModel.update(id, data);
  if (!routine) {
    throw new ApiError(404, `No existe la rutina con id ${id}.`);
  }
  return sendSuccess(res, {
    status: 200,
    data: routine,
    message: 'Rutina actualizada correctamente.',
  });
}

async function remove(req, res) {
  const id = parseUuid(req.params.id);
  await assertAccess(id, req.user.id);

  const deleted = await routineModel.softDelete(id);
  if (!deleted) {
    throw new ApiError(404, `No existe la rutina con id ${id}.`);
  }
  return sendSuccess(res, {
    status: 200,
    data: null,
    message: 'Rutina eliminada correctamente.',
  });
}

module.exports = { list, getById, create, update, remove };
