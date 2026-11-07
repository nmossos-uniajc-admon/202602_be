class ApiError extends Error {
  constructor(statusCode, message, errors = undefined) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    if (errors) this.errors = errors;
  }
}

function sendSuccess(res, { status = 200, data = null, message = undefined } = {}) {
  const body = { success: true, data };
  if (message !== undefined) body.message = message;
  return res.status(status).json(body);
}

const PG_UNIQUE_VIOLATION = '23505';
const PG_FOREIGN_KEY_VIOLATION = '23503';
const PG_RAISE_EXCEPTION = 'P0001';

function mapPgError(err) {
  if (err instanceof ApiError) return err;

  if (err && err.code === PG_UNIQUE_VIOLATION) {
    const detail = err.detail || 'Ya existe un registro con ese valor único.';
    return new ApiError(409, 'Conflicto de unicidad.', [detail]);
  }

  if (err && err.code === PG_FOREIGN_KEY_VIOLATION) {
    const detail = err.detail || 'El registro referencia o es referenciado por otra tabla.';
    return new ApiError(409, 'Violación de integridad referencial.', [detail]);
  }

  if (err && err.code === PG_RAISE_EXCEPTION) {
    return new ApiError(409, 'La operación viola una regla del negocio.', [err.message]);
  }

  return err;
}

module.exports = { ApiError, sendSuccess, mapPgError };
