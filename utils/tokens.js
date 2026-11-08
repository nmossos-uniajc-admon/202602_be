const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const cfg = require('../config/auth');

function signAccessToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role.code, type: 'access' },
    cfg.accessTokenSecret,
    { expiresIn: cfg.accessTokenTtl, jwtid: crypto.randomUUID() }
  );
}

function signRefreshToken(userId, familyId, tokenId) {
  return jwt.sign(
    { sub: userId, familyId, type: 'refresh' },
    cfg.refreshTokenSecret,
    { expiresIn: `${cfg.refreshTokenTtlDays}d`, jwtid: tokenId }
  );
}

function refreshTokenExpiresAt() {
  return new Date(Date.now() + cfg.refreshTokenTtlDays * 24 * 60 * 60 * 1000);
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

function verifyAccessToken(token) {
  const payload = jwt.verify(token, cfg.accessTokenSecret);
  if (payload.type !== 'access') {
    const err = new Error('Tipo de token incorrecto.');
    err.name = 'JsonWebTokenError';
    throw err;
  }
  return payload;
}

function verifyRefreshToken(token) {
  const payload = jwt.verify(token, cfg.refreshTokenSecret);
  if (payload.type !== 'refresh') {
    const err = new Error('Tipo de token incorrecto.');
    err.name = 'JsonWebTokenError';
    throw err;
  }
  return payload;
}

function tokenExpiresInSeconds(token) {
  const payload = jwt.decode(token);
  return payload && payload.exp && payload.iat ? payload.exp - payload.iat : null;
}

module.exports = {
  signAccessToken,
  signRefreshToken,
  refreshTokenExpiresAt,
  hashToken,
  verifyAccessToken,
  verifyRefreshToken,
  tokenExpiresInSeconds,
};
