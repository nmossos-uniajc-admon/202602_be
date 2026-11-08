const { ApiError } = require('../utils/http');
const { verifyAccessToken } = require('../utils/tokens');
const userModel = require('../models/user');

async function authenticate(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const [scheme, token] = header.split(' ');

    if (!token || scheme.toLowerCase() !== 'bearer') {
      throw new ApiError(401, 'No se proporcionó un token de acceso. Use el header Authorization: Bearer <token>.');
    }

    let payload;
    try {
      payload = verifyAccessToken(token);
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        throw new ApiError(401, 'El token de acceso ha expirado. Use POST /api/auth/refresh.');
      }
      throw new ApiError(401, 'Token de acceso inválido.');
    }

    const user = await userModel.findActiveById(payload.sub);
    if (!user) {
      throw new ApiError(401, 'El usuario del token ya no existe o está inactivo.');
    }

    req.user = { id: user.id, role: user.role.code };
    next();
  } catch (err) {
    next(err);
  }
}

function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return next(new ApiError(401, 'No autenticado.'));
    }
    if (!roles.includes(req.user.role)) {
      return next(new ApiError(403, `Esta operación requiere uno de los roles: ${roles.join(', ')}.`));
    }
    next();
  };
}

function selfOrAdmin(req, res, next) {
  const target = String(req.params.id || '').toLowerCase();
  if (req.user && (req.user.role === 'ADMIN' || req.user.id === target)) {
    return next();
  }
  next(new ApiError(403, 'Solo puede operar sobre su propio usuario.'));
}

module.exports = { authenticate, authorize, selfOrAdmin };
