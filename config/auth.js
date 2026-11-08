const MIN_BCRYPT_ROUNDS = 12;

function requiredEnv(name) {
  const value = process.env[name];
  if (!value || String(value).trim() === '') {
    throw new Error(`Configuración faltante: defina la variable ${name} en .env`);
  }
  return String(value).trim();
}

function intEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) ? n : fallback;
}

module.exports = {
  accessTokenSecret: requiredEnv('JWT_ACCESS_SECRET'),
  refreshTokenSecret: requiredEnv('JWT_REFRESH_SECRET'),
  accessTokenTtl: (process.env.JWT_ACCESS_EXPIRES_IN || '').trim() || '15m',
  refreshTokenTtlDays: intEnv('REFRESH_TOKEN_TTL_DAYS', 7),
  bcryptRounds: Math.max(MIN_BCRYPT_ROUNDS, intEnv('BCRYPT_SALT_ROUNDS', MIN_BCRYPT_ROUNDS)),
  passwordMinLength: Math.max(8, intEnv('PASSWORD_MIN_LENGTH', 8)),
  MIN_BCRYPT_ROUNDS,
};
