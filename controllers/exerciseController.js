const exerciseModel = require('../models/exercise');
const { ApiError, sendSuccess } = require('../utils/http');
const {
  parseUuid,
  parseSmallintArray,
  parseId,
  parseBooleanQuery,
  parsePagination,
} = require('../utils/validate');

const NAME_MAX = 150;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function has(body, key) {
  return Object.prototype.hasOwnProperty.call(body, key);
}

function validatePayload(body, { partial = false } = {}) {
  const errors = [];
  const data = {};

  if (!partial && !has(body, 'name')) {
    errors.push("El campo 'name' es obligatorio.");
  }
  if (has(body, 'name')) {
    if (typeof body.name !== 'string') {
      errors.push("El campo 'name' debe ser un texto.");
    } else {
      const name = body.name.trim();
      if (name.length === 0) {
        errors.push("El campo 'name' no puede estar vacío.");
      } else if (name.length > NAME_MAX) {
        errors.push(`El campo 'name' no puede superar los ${NAME_MAX} caracteres.`);
      } else {
        data.name = name;
      }
    }
  }

  if (has(body, 'description')) {
    if (body.description === null) {
      data.description = null;
    } else if (typeof body.description !== 'string') {
      errors.push("El campo 'description' debe ser un texto o null.");
    } else {
      data.description = body.description;
    }
  }

  if (!partial && !has(body, 'exerciseTypeId')) {
    errors.push("El campo 'exerciseTypeId' es obligatorio.");
  }
  if (has(body, 'exerciseTypeId')) {
    try {
      data.exerciseTypeId = parseId(body.exerciseTypeId, 'exerciseTypeId');
    } catch (err) {
      errors.push(err.message);
    }
  }

  if (has(body, 'createdByUserId')) {
    if (body.createdByUserId === null) {
      data.createdByUserId = null;
    } else if (typeof body.createdByUserId !== 'string' || !UUID_REGEX.test(body.createdByUserId)) {
      errors.push("El campo 'createdByUserId' debe ser un UUID válido o null.");
    } else {
      data.createdByUserId = body.createdByUserId;
    }
  }

  if (has(body, 'isActive')) {
    if (typeof body.isActive !== 'boolean') {
      errors.push("El campo 'isActive' debe ser un booleano.");
    } else {
      data.isActive = body.isActive;
    }
  }

  for (const key of ['equipmentIds', 'targetMuscleIds', 'secondaryMuscleIds']) {
    if (has(body, key)) {
      try {
        data[key] = parseSmallintArray(body[key], key);
      } catch (err) {
        errors.push(err.message);
      }
    }
  }

  if (partial && Object.keys(data).length === 0) {
    errors.push('Debe proporcionar al menos un campo a actualizar.');
  }

  if (errors.length) {
    throw new ApiError(400, 'Datos de entrada inválidos.', errors);
  }

  return data;
}

function findMuscleOverlap(targetIds, secondaryIds) {
  const secondary = new Set(secondaryIds);
  return targetIds.filter((id) => secondary.has(id));
}

function assertNoMuscleOverlap(targetIds, secondaryIds) {
  const overlap = findMuscleOverlap(targetIds, secondaryIds);
  if (overlap.length > 0) {
    throw new ApiError(
      400,
      'Un músculo no puede ser objetivo y secundario a la vez en el mismo ejercicio.',
      [`Músculos duplicados entre objetivo y secundario: ${overlap.join(', ')}.`]
    );
  }
}

async function assertReferencesExist(data) {
  const missing = [];
  const checks = [];

  if (data.exerciseTypeId !== undefined) {
    checks.push(
      exerciseModel.exerciseTypeExists(data.exerciseTypeId).then((ok) => {
        if (!ok) missing.push(`El tipo de ejercicio ${data.exerciseTypeId} no existe.`);
      })
    );
  }
  if (data.equipmentIds !== undefined) {
    checks.push(
      exerciseModel.findMissingEquipmentIds(data.equipmentIds).then((ids) => {
        if (ids.length) missing.push(`Equipamiento inexistente: ${ids.join(', ')}.`);
      })
    );
  }
  const muscleIds = [
    ...(data.targetMuscleIds || []),
    ...(data.secondaryMuscleIds || []),
  ];
  if (muscleIds.length) {
    checks.push(
      exerciseModel.findMissingMuscleIds(muscleIds).then((ids) => {
        if (ids.length) missing.push(`Músculos inexistentes: ${ids.join(', ')}.`);
      })
    );
  }
  if (data.createdByUserId) {
    checks.push(
      exerciseModel.userExists(data.createdByUserId).then((ok) => {
        if (!ok) missing.push(`El usuario ${data.createdByUserId} no existe.`);
      })
    );
  }

  await Promise.all(checks);

  if (missing.length) {
    throw new ApiError(400, 'Referencias inválidas.', missing);
  }
}

async function list(req, res) {
  const isActive = parseBooleanQuery(req.query.is_active);
  const search = typeof req.query.search === 'string' ? req.query.search : undefined;
  const typeId = req.query.exercise_type_id === undefined
    ? undefined
    : parseId(req.query.exercise_type_id, 'exercise_type_id');
  const equipmentId = req.query.equipment_id === undefined
    ? undefined
    : parseId(req.query.equipment_id, 'equipment_id');
  const muscleId = req.query.muscle_id === undefined
    ? undefined
    : parseId(req.query.muscle_id, 'muscle_id');
  const { limit, offset } = parsePagination(req.query);

  const result = await exerciseModel.findAll({
    search,
    isActive,
    typeId,
    equipmentId,
    muscleId,
    limit,
    offset,
  });
  return sendSuccess(res, { status: 200, data: result });
}

async function getById(req, res) {
  const id = parseUuid(req.params.id);
  const exercise = await exerciseModel.findById(id);
  if (!exercise) {
    throw new ApiError(404, `No existe el ejercicio con id ${id}.`);
  }
  return sendSuccess(res, { status: 200, data: exercise });
}

async function create(req, res) {
  const data = validatePayload(req.body || {}, { partial: false });

  assertNoMuscleOverlap(data.targetMuscleIds || [], data.secondaryMuscleIds || []);
  await assertReferencesExist(data);

  const exercise = await exerciseModel.create(data);
  return sendSuccess(res, {
    status: 201,
    data: exercise,
    message: 'Ejercicio creado correctamente.',
  });
}

async function update(req, res) {
  const id = parseUuid(req.params.id);

  const existing = await exerciseModel.findById(id);
  if (!existing) {
    throw new ApiError(404, `No existe el ejercicio con id ${id}.`);
  }

  const data = validatePayload(req.body || {}, { partial: true });

  const effectiveTargets = data.targetMuscleIds !== undefined
    ? data.targetMuscleIds
    : existing.targetMuscles.map((m) => m.id);
  const effectiveSecondaries = data.secondaryMuscleIds !== undefined
    ? data.secondaryMuscleIds
    : existing.secondaryMuscles.map((m) => m.id);
  assertNoMuscleOverlap(effectiveTargets, effectiveSecondaries);

  await assertReferencesExist(data);

  const exercise = await exerciseModel.update(id, data);
  if (!exercise) {
    throw new ApiError(404, `No existe el ejercicio con id ${id}.`);
  }
  return sendSuccess(res, {
    status: 200,
    data: exercise,
    message: 'Ejercicio actualizado correctamente.',
  });
}

async function remove(req, res) {
  const id = parseUuid(req.params.id);

  const deleted = await exerciseModel.softDelete(id);
  if (!deleted) {
    throw new ApiError(404, `No existe el ejercicio con id ${id}.`);
  }
  return sendSuccess(res, {
    status: 200,
    data: null,
    message: 'Ejercicio eliminado correctamente.',
  });
}

module.exports = { list, getById, create, update, remove };
