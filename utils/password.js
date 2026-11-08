const bcrypt = require('bcrypt');
const cfg = require('../config/auth');

async function hashPassword(plain) {
  return bcrypt.hash(plain, cfg.bcryptRounds);
}

async function verifyPassword(plain, hash) {
  try {
    return await bcrypt.compare(plain, hash);
  } catch (_) {
    return false;
  }
}

function getRounds(hash) {
  return bcrypt.getRounds(hash);
}

module.exports = { hashPassword, verifyPassword, getRounds };
