const { ApiError } = require('./http');

const SMALLINT_MAX = 32767;

function parseId(value, label = 'id') {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > SMALLINT_MAX) {
    throw new ApiError(400, `El parámetro '${label}' debe ser un entero entre 1 y ${SMALLINT_MAX}.`);
  }
  return n;
}

function parseBooleanQuery(value) {
  if (value === undefined) return undefined;
  const v = String(value).toLowerCase();
  if (v === 'true' || v === '1') return true;
  if (v === 'false' || v === '0') return false;
  return undefined;
}

function parsePagination(query, { defaultLimit = 20, maxLimit = 100 } = {}) {
  let limit = Number.parseInt(query.limit, 10);
  let offset = Number.parseInt(query.offset, 10);

  if (!Number.isInteger(limit) || limit < 1) limit = defaultLimit;
  if (limit > maxLimit) limit = maxLimit;
  if (!Number.isInteger(offset) || offset < 0) offset = 0;

  return { limit, offset };
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseUuid(value, label = 'id') {
  if (typeof value !== 'string' || !UUID_REGEX.test(value)) {
    throw new ApiError(400, `El parámetro '${label}' debe ser un UUID válido.`);
  }
  return value;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function isValidEmail(value, max = 254) {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.trim().length <= max &&
    EMAIL_REGEX.test(value.trim())
  );
}

function isValidBirthDate(value) {
  if (typeof value !== 'string' || !DATE_REGEX.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return false;
  if (date.getUTCFullYear() !== y || date.getUTCMonth() + 1 !== m || date.getUTCDate() !== d) {
    return false;
  }
  return date.getTime() <= Date.now();
}

function parseSmallintArray(value, label) {
  if (!Array.isArray(value)) {
    throw new ApiError(400, `El campo '${label}' debe ser un arreglo de enteros.`);
  }
  const seen = new Set();
  for (const item of value) {
    if (!Number.isInteger(item) || item < 1 || item > SMALLINT_MAX) {
      throw new ApiError(400, `El campo '${label}' contiene un valor inválido: ${JSON.stringify(item)}. Deben ser enteros entre 1 y ${SMALLINT_MAX}.`);
    }
    if (seen.has(item)) {
      throw new ApiError(400, `El campo '${label}' contiene ids duplicados: ${item}.`);
    }
    seen.add(item);
  }
  return value;
}

module.exports = {
  parseId,
  parseBooleanQuery,
  parsePagination,
  parseUuid,
  parseSmallintArray,
  isValidEmail,
  isValidBirthDate,
  SMALLINT_MAX,
};
