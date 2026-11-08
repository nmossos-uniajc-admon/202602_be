const userModel = require('../models/user');
const refreshTokenModel = require('../models/refreshToken');
const { hashPassword } = require('../utils/password');
const { ApiError, sendSuccess } = require('../utils/http');
const {
  parseUuid,
  parseId,
  parseBooleanQuery,
  parsePagination,
  isValidEmail,
  isValidBirthDate,
} = require('../utils/validate');
const authCfg = require('../config/auth');

const NAME_MAX = 100;
const PHONE_MAX = 30;
const AVATAR_URL_MAX = 2048;

const SELF_EDITABLE = ['firstName', 'lastName', 'phone', 'birthDate', 'avatarUrl'];
const ADMIN_ONLY = ['roleId', 'isActive'];

function has(body, key) {
  return Object.prototype.hasOwnProperty.call(body, key);
}

function validateProfileFields(body, data, errors) {
  for (const key of ['firstName', 'lastName']) {
    if (has(body, key)) {
      if (typeof body[key] !== 'string' || body[key].trim().length === 0 || body[key].trim().length > NAME_MAX) {
        errors.push(`El campo '${key}' debe ser un texto de 1 a ${NAME_MAX} caracteres.`);
      } else {
        data[key] = body[key].trim();
      }
    }
  }

  if (has(body, 'phone')) {
    if (body.phone === null) {
      data.phone = null;
    } else if (typeof body.phone !== 'string' || body.phone.trim().length > PHONE_MAX) {
      errors.push(`El campo 'phone' debe ser un texto de máximo ${PHONE_MAX} caracteres o null.`);
    } else {
      data.phone = body.phone.trim() || null;
    }
  }

  if (has(body, 'birthDate')) {
    if (body.birthDate === null) {
      data.birthDate = null;
    } else if (!isValidBirthDate(body.birthDate)) {
      errors.push("El campo 'birthDate' debe ser una fecha válida en formato YYYY-MM-DD, no futura.");
    } else {
      data.birthDate = body.birthDate;
    }
  }

  if (has(body, 'avatarUrl')) {
    if (body.avatarUrl === null) {
      data.avatarUrl = null;
    } else if (typeof body.avatarUrl !== 'string' || body.avatarUrl.length > AVATAR_URL_MAX) {
      errors.push(`El campo 'avatarUrl' debe ser un texto de máximo ${AVATAR_URL_MAX} caracteres o null.`);
    } else {
      data.avatarUrl = body.avatarUrl;
    }
  }
}

function validateCreatePayload(body) {
  const errors = [];
  const data = {};

  if (!has(body, 'email')) {
    errors.push("El campo 'email' es obligatorio.");
  } else if (!isValidEmail(body.email)) {
    errors.push("El campo 'email' debe ser un email válido (máx. 254 caracteres).");
  } else {
    data.email = body.email.trim().toLowerCase();
  }

  if (!has(body, 'password')) {
    errors.push("El campo 'password' es obligatorio.");
  } else if (
    typeof body.password !== 'string' ||
    body.password.length < authCfg.passwordMinLength ||
    Buffer.byteLength(body.password, 'utf8') > 72
  ) {
    errors.push(
      `El campo 'password' debe tener al menos ${authCfg.passwordMinLength} caracteres y máximo 72 bytes.`
    );
  } else {
    data.password = body.password;
  }

  for (const key of ['firstName', 'lastName']) {
    if (!has(body, key)) errors.push(`El campo '${key}' es obligatorio.`);
  }
  validateProfileFields(body, data, errors);

  if (!has(body, 'roleId')) {
    errors.push("El campo 'roleId' es obligatorio.");
  } else {
    try {
      data.roleId = parseId(body.roleId, 'roleId');
    } catch (err) {
      errors.push(err.message);
    }
  }

  if (has(body, 'isActive')) {
    if (typeof body.isActive !== 'boolean') {
      errors.push("El campo 'isActive' debe ser un booleano.");
    } else {
      data.isActive = body.isActive;
    }
  }

  if (errors.length) {
    throw new ApiError(400, 'Datos de entrada inválidos.', errors);
  }
  return data;
}

function validateUpdatePayload(body, { isAdmin }) {
  if (has(body, 'password')) {
    throw new ApiError(400, 'Datos de entrada inválidos.', [
      "El campo 'password' no se puede modificar con PUT; use POST /api/auth/change-password.",
    ]);
  }
  if (has(body, 'email')) {
    throw new ApiError(400, 'Datos de entrada inválidos.', [
      "El campo 'email' no se puede modificar.",
    ]);
  }
  if (!isAdmin && ADMIN_ONLY.some((key) => has(body, key))) {
    throw new ApiError(
      403,
      `Solo un administrador puede modificar los campos: ${ADMIN_ONLY.join(', ')}.`
    );
  }

  const errors = [];
  const data = {};

  validateProfileFields(body, data, errors);

  if (has(body, 'roleId')) {
    try {
      data.roleId = parseId(body.roleId, 'roleId');
    } catch (err) {
      errors.push(err.message);
    }
  }

  if (has(body, 'isActive')) {
    if (typeof body.isActive !== 'boolean') {
      errors.push("El campo 'isActive' debe ser un booleano.");
    } else {
      data.isActive = body.isActive;
    }
  }

  if (Object.keys(data).length === 0) {
    errors.push(`Debe proporcionar al menos un campo a actualizar (${[...SELF_EDITABLE, ...ADMIN_ONLY].join(', ')}).`);
  }

  if (errors.length) {
    throw new ApiError(400, 'Datos de entrada inválidos.', errors);
  }
  return data;
}

async function list(req, res) {
  const isActive = parseBooleanQuery(req.query.is_active);
  const search = typeof req.query.search === 'string' ? req.query.search : undefined;
  const roleId =
    req.query.role_id === undefined ? undefined : parseId(req.query.role_id, 'role_id');
  const { limit, offset } = parsePagination(req.query);

  const result = await userModel.findAll({ search, roleId, isActive, limit, offset });
  return sendSuccess(res, { status: 200, data: result });
}

async function getById(req, res) {
  const id = parseUuid(req.params.id);
  const user = await userModel.findById(id);
  if (!user) {
    throw new ApiError(404, `No existe el usuario con id ${id}.`);
  }
  return sendSuccess(res, { status: 200, data: user });
}

async function create(req, res) {
  const data = validateCreatePayload(req.body || {});

  if (!(await userModel.roleExists(data.roleId))) {
    throw new ApiError(400, 'Referencias inválidas.', [`El rol ${data.roleId} no existe.`]);
  }
  if (await userModel.emailExists(data.email)) {
    throw new ApiError(409, 'Ya existe un usuario activo con ese email.');
  }

  data.passwordHash = await hashPassword(data.password);
  delete data.password;

  const user = await userModel.create(data);
  return sendSuccess(res, {
    status: 201,
    data: user,
    message: 'Usuario creado correctamente.',
  });
}

async function update(req, res) {
  const id = parseUuid(req.params.id);
  const isAdmin = req.user.role === 'ADMIN';
  const data = validateUpdatePayload(req.body || {}, { isAdmin });

  const existing = await userModel.findById(id);
  if (!existing) {
    throw new ApiError(404, `No existe el usuario con id ${id}.`);
  }

  if (data.roleId !== undefined && !(await userModel.roleExists(data.roleId))) {
    throw new ApiError(400, 'Referencias inválidas.', [`El rol ${data.roleId} no existe.`]);
  }

  const user = await userModel.update(id, data);
  if (!user) {
    throw new ApiError(404, `No existe el usuario con id ${id}.`);
  }

  if (data.isActive === false) {
    await refreshTokenModel.revokeAllForUser(id);
  }

  return sendSuccess(res, {
    status: 200,
    data: user,
    message: 'Usuario actualizado correctamente.',
  });
}

async function remove(req, res) {
  const id = parseUuid(req.params.id);

  const existing = await userModel.findById(id);
  if (!existing) {
    throw new ApiError(404, `No existe el usuario con id ${id}.`);
  }

  const deleted = await userModel.softDelete(id);
  if (!deleted) {
    throw new ApiError(404, `No existe el usuario con id ${id}.`);
  }

  await refreshTokenModel.revokeAllForUser(id);

  return sendSuccess(res, {
    status: 200,
    data: null,
    message: 'Usuario eliminado correctamente.',
  });
}

module.exports = { list, getById, create, update, remove };
