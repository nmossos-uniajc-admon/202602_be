const crypto = require('crypto');

const userModel = require('../models/user');
const refreshTokenModel = require('../models/refreshToken');
const { hashPassword, verifyPassword } = require('../utils/password');
const {
  signAccessToken,
  signRefreshToken,
  hashToken,
  verifyRefreshToken,
  tokenExpiresInSeconds,
  refreshTokenExpiresAt,
} = require('../utils/tokens');
const { ApiError, sendSuccess } = require('../utils/http');
const authCfg = require('../config/auth');

let dummyHashPromise = null;
function getDummyHash() {
  if (!dummyHashPromise) dummyHashPromise = hashPassword('dummy-password-anti-timing');
  return dummyHashPromise;
}

function clientMeta(req) {
  return { ip: req.ip || null, userAgent: req.get('user-agent') || null };
}

async function issueSession(user, req) {
  const tokenId = crypto.randomUUID();
  const familyId = crypto.randomUUID();
  const refreshToken = signRefreshToken(user.id, familyId, tokenId);

  await refreshTokenModel.insert({
    id: tokenId,
    userId: user.id,
    tokenHash: hashToken(refreshToken),
    familyId,
    expiresAt: refreshTokenExpiresAt(),
    ...clientMeta(req),
  });

  const accessToken = signAccessToken(user);
  return {
    accessToken,
    refreshToken,
    tokenType: 'Bearer',
    expiresIn: tokenExpiresInSeconds(accessToken),
    user: userModel.sanitize(user),
  };
}

async function login(req, res) {
  const body = req.body || {};
  const errors = [];
  if (typeof body.email !== 'string' || body.email.trim() === '') {
    errors.push("El campo 'email' es obligatorio.");
  }
  if (typeof body.password !== 'string' || body.password === '') {
    errors.push("El campo 'password' es obligatorio.");
  }
  if (errors.length) {
    throw new ApiError(400, 'Datos de entrada inválidos.', errors);
  }

  const user = await userModel.findByEmailForAuth(body.email.trim());
  const passwordOk = await verifyPassword(
    body.password,
    user ? user.passwordHash : await getDummyHash()
  );

  if (!user || !passwordOk) {
    throw new ApiError(401, 'Credenciales inválidas.');
  }
  if (!user.isActive) {
    throw new ApiError(403, 'La cuenta está desactivada. Contacte al administrador.');
  }

  await userModel.touchLastLogin(user.id);
  user.lastLoginAt = new Date();

  const session = await issueSession(user, req);
  return sendSuccess(res, {
    status: 200,
    data: session,
    message: 'Sesión iniciada correctamente.',
  });
}

async function refresh(req, res) {
  const token = (req.body || {}).refreshToken;
  if (typeof token !== 'string' || token === '') {
    throw new ApiError(400, "Debe proporcionar el campo 'refreshToken'.");
  }

  let payload;
  try {
    payload = verifyRefreshToken(token);
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      throw new ApiError(401, 'El refresh token ha expirado. Inicie sesión nuevamente.');
    }
    throw new ApiError(401, 'Refresh token inválido.');
  }

  const row = await refreshTokenModel.findById(payload.jti);
  if (!row || row.token_hash !== hashToken(token)) {
    throw new ApiError(401, 'Refresh token inválido.');
  }

  if (row.revoked_at) {
    await refreshTokenModel.revokeFamily(row.family_id);
    throw new ApiError(
      401,
      'Refresh token reutilizado: por seguridad se revocaron todas las sesiones de esta familia. Inicie sesión nuevamente.'
    );
  }

  if (new Date(row.expires_at).getTime() <= Date.now()) {
    throw new ApiError(401, 'El refresh token ha expirado. Inicie sesión nuevamente.');
  }

  if (row.deleted_at || !row.is_active) {
    throw new ApiError(401, 'El usuario ya no existe o está inactivo.');
  }

  const user = await userModel.findActiveById(row.user_id);
  if (!user) {
    throw new ApiError(401, 'El usuario ya no existe o está inactivo.');
  }

  const newTokenId = crypto.randomUUID();
  const newRefreshToken = signRefreshToken(user.id, row.family_id, newTokenId);
  const rotated = await refreshTokenModel.rotate(row, {
    id: newTokenId,
    tokenHash: hashToken(newRefreshToken),
    expiresAt: refreshTokenExpiresAt(),
    ...clientMeta(req),
  });

  if (!rotated) {
    await refreshTokenModel.revokeFamily(row.family_id);
    throw new ApiError(
      401,
      'Refresh token reutilizado: por seguridad se revocaron todas las sesiones de esta familia. Inicie sesión nuevamente.'
    );
  }

  const accessToken = signAccessToken(user);
  return sendSuccess(res, {
    status: 200,
    data: {
      accessToken,
      refreshToken: newRefreshToken,
      tokenType: 'Bearer',
      expiresIn: tokenExpiresInSeconds(accessToken),
      user: userModel.sanitize(user),
    },
    message: 'Tokens renovados correctamente.',
  });
}

async function logout(req, res) {
  const token = (req.body || {}).refreshToken;
  if (typeof token === 'string' && token !== '') {
    try {
      const payload = verifyRefreshToken(token);
      const row = await refreshTokenModel.findById(payload.jti);
      if (row && row.token_hash === hashToken(token)) {
        await refreshTokenModel.revoke(row.id);
      }
    } catch (_) {
      /* Token inválido: logout idempotente, no se revela información */
    }
  }
  return sendSuccess(res, {
    status: 200,
    data: null,
    message: 'Sesión revocada correctamente.',
  });
}

async function me(req, res) {
  const user = await userModel.findActiveById(req.user.id);
  if (!user) {
    throw new ApiError(404, 'Usuario no encontrado.');
  }
  return sendSuccess(res, { status: 200, data: user });
}

async function changePassword(req, res) {
  const body = req.body || {};
  const errors = [];

  if (typeof body.currentPassword !== 'string' || body.currentPassword === '') {
    errors.push("El campo 'currentPassword' es obligatorio.");
  }
  if (typeof body.newPassword !== 'string') {
    errors.push("El campo 'newPassword' es obligatorio.");
  } else if (
    body.newPassword.length < authCfg.passwordMinLength ||
    Buffer.byteLength(body.newPassword, 'utf8') > 72
  ) {
    errors.push(
      `El campo 'newPassword' debe tener al menos ${authCfg.passwordMinLength} caracteres y máximo 72 bytes.`
    );
  }
  if (
    !errors.length &&
    typeof body.currentPassword === 'string' &&
    body.currentPassword === body.newPassword
  ) {
    errors.push('La nueva contraseña debe ser distinta de la actual.');
  }
  if (errors.length) {
    throw new ApiError(400, 'Datos de entrada inválidos.', errors);
  }

  const user = await userModel.findWithPasswordById(req.user.id);
  if (!user) {
    throw new ApiError(404, 'Usuario no encontrado.');
  }

  const currentOk = await verifyPassword(body.currentPassword, user.passwordHash);
  if (!currentOk) {
    throw new ApiError(401, 'La contraseña actual es incorrecta.');
  }

  const passwordHash = await hashPassword(body.newPassword);
  await userModel.update(user.id, { passwordHash });
  await refreshTokenModel.revokeAllForUser(user.id);

  return sendSuccess(res, {
    status: 200,
    data: null,
    message: 'Contraseña actualizada correctamente. Debe iniciar sesión nuevamente.',
  });
}

module.exports = { login, refresh, logout, me, changePassword };
