const equipmentModel = require('../models/equipment');
const { ApiError, sendSuccess } = require('../utils/http');
const { parseId, parseBooleanQuery, parsePagination } = require('../utils/validate');

const NAME_MAX = 100;

function validatePayload(body, { partial = false } = {}) {
  const errors = [];
  const data = {};

  const hasName = Object.prototype.hasOwnProperty.call(body, 'name');
  const hasDescription = Object.prototype.hasOwnProperty.call(body, 'description');
  const hasIsActive = Object.prototype.hasOwnProperty.call(body, 'isActive');

  if (!partial && !hasName) {
    errors.push("El campo 'name' es obligatorio.");
  }

  if (hasName) {
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

  if (hasDescription) {
    if (body.description === null) {
      data.description = null;
    } else if (typeof body.description !== 'string') {
      errors.push("El campo 'description' debe ser un texto o null.");
    } else {
      data.description = body.description;
    }
  }

  if (hasIsActive) {
    if (typeof body.isActive !== 'boolean') {
      errors.push("El campo 'isActive' debe ser un booleano.");
    } else {
      data.isActive = body.isActive;
    }
  }

  if (partial && !hasName && !hasDescription && !hasIsActive) {
    errors.push('Debe proporcionar al menos un campo a actualizar.');
  }

  if (errors.length) {
    throw new ApiError(400, 'Datos de entrada inválidos.', errors);
  }

  return data;
}

async function list(req, res) {
  const isActive = parseBooleanQuery(req.query.is_active);
  const search = typeof req.query.search === 'string' ? req.query.search : undefined;
  const { limit, offset } = parsePagination(req.query);

  const result = await equipmentModel.findAll({ isActive, search, limit, offset });
  return sendSuccess(res, { status: 200, data: result });
}

async function getById(req, res) {
  const id = parseId(req.params.id);
  const equipment = await equipmentModel.findById(id);
  if (!equipment) {
    throw new ApiError(404, `No existe el equipo con id ${id}.`);
  }
  return sendSuccess(res, { status: 200, data: equipment });
}

async function create(req, res) {
  const data = validatePayload(req.body || {}, { partial: false });
  const equipment = await equipmentModel.create(data);
  return sendSuccess(res, {
    status: 201,
    data: equipment,
    message: 'Equipo creado correctamente.',
  });
}

async function update(req, res) {
  const id = parseId(req.params.id);

  const existing = await equipmentModel.findById(id);
  if (!existing) {
    throw new ApiError(404, `No existe el equipo con id ${id}.`);
  }

  const data = validatePayload(req.body || {}, { partial: true });
  const equipment = await equipmentModel.update(id, data);
  return sendSuccess(res, {
    status: 200,
    data: equipment,
    message: 'Equipo actualizado correctamente.',
  });
}

async function remove(req, res) {
  const id = parseId(req.params.id);

  const existing = await equipmentModel.findById(id);
  if (!existing) {
    throw new ApiError(404, `No existe el equipo con id ${id}.`);
  }

  try {
    await equipmentModel.remove(id);
  } catch (err) {
    if (err && err.code === '23503') {
      throw new ApiError(
        409,
        'No se puede eliminar: el equipo está en uso por algún ejercicio.',
        err.detail ? [err.detail] : undefined
      );
    }
    throw err;
  }
  return sendSuccess(res, {
    status: 200,
    data: null,
    message: 'Equipo eliminado correctamente.',
  });
}

module.exports = { list, getById, create, update, remove };
