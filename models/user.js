const pool = require('../config/db');

const PUBLIC_SELECT = `
  u.id, u.email, u.first_name, u.last_name, u.phone,
  u.birth_date::text AS birth_date,
  u.is_active, u.avatar_url, u.last_login_at, u.password_changed_at,
  u.created_at, u.updated_at,
  json_build_object('id', r.id, 'code', r.code, 'name', r.name) AS role
`;

const FROM_JOIN = `
  FROM gym.users u
  JOIN gym.roles r ON r.id = u.role_id
`;

function mapRow(row) {
  if (!row) return null;
  const user = {
    id: row.id,
    email: row.email,
    firstName: row.first_name,
    lastName: row.last_name,
    phone: row.phone,
    birthDate: row.birth_date,
    role: row.role,
    isActive: row.is_active,
    avatarUrl: row.avatar_url,
    lastLoginAt: row.last_login_at,
    passwordChangedAt: row.password_changed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (row.password_hash !== undefined) user.passwordHash = row.password_hash;
  return user;
}

function sanitize(user) {
  if (!user) return null;
  const { passwordHash, ...rest } = user;
  return rest;
}

async function findAll({ search, roleId, isActive, limit = 20, offset = 0 } = {}) {
  const where = ['u.deleted_at IS NULL'];
  const whereParams = [];

  if (typeof isActive === 'boolean') {
    whereParams.push(isActive);
    where.push(`u.is_active = $${whereParams.length}`);
  }
  if (roleId !== undefined) {
    whereParams.push(roleId);
    where.push(`u.role_id = $${whereParams.length}`);
  }
  if (search && search.trim() !== '') {
    whereParams.push(`%${search.trim()}%`);
    const n = whereParams.length;
    where.push(`(u.email ILIKE $${n} OR u.first_name ILIKE $${n} OR u.last_name ILIKE $${n})`);
  }

  const whereSql = `WHERE ${where.join(' AND ')}`;
  const dataParams = [...whereParams, limit, offset];
  const limitParam = whereParams.length + 1;
  const offsetParam = whereParams.length + 2;

  const countSql = `SELECT COUNT(*)::int AS total FROM gym.users u ${whereSql}`;
  const dataSql = `
    SELECT ${PUBLIC_SELECT}
    ${FROM_JOIN}
    ${whereSql}
    ORDER BY u.first_name, u.last_name
    LIMIT $${limitParam} OFFSET $${offsetParam}
  `;

  const [countRes, dataRes] = await Promise.all([
    pool.query(countSql, whereParams),
    pool.query(dataSql, dataParams),
  ]);

  return {
    items: dataRes.rows.map((row) => sanitize(mapRow(row))),
    total: countRes.rows[0].total,
    limit,
    offset,
  };
}

async function findById(id) {
  const res = await pool.query(
    `SELECT ${PUBLIC_SELECT} ${FROM_JOIN} WHERE u.id = $1 AND u.deleted_at IS NULL`,
    [id]
  );
  return sanitize(mapRow(res.rows[0]));
}

async function findActiveById(id) {
  const res = await pool.query(
    `SELECT ${PUBLIC_SELECT} ${FROM_JOIN}
     WHERE u.id = $1 AND u.deleted_at IS NULL AND u.is_active`,
    [id]
  );
  return sanitize(mapRow(res.rows[0]));
}

async function findByEmailForAuth(email) {
  const res = await pool.query(
    `SELECT ${PUBLIC_SELECT}, u.password_hash ${FROM_JOIN}
     WHERE u.email = $1 AND u.deleted_at IS NULL`,
    [email]
  );
  return mapRow(res.rows[0]);
}

async function findWithPasswordById(id) {
  const res = await pool.query(
    `SELECT ${PUBLIC_SELECT}, u.password_hash ${FROM_JOIN}
     WHERE u.id = $1 AND u.deleted_at IS NULL`,
    [id]
  );
  return mapRow(res.rows[0]);
}

async function emailExists(email) {
  const res = await pool.query(
    'SELECT 1 FROM gym.users WHERE email = $1 AND deleted_at IS NULL',
    [email]
  );
  return res.rowCount > 0;
}

async function roleExists(roleId) {
  const res = await pool.query('SELECT 1 FROM gym.roles WHERE id = $1', [roleId]);
  return res.rowCount > 0;
}

async function create(data) {
  const res = await pool.query(
    `INSERT INTO gym.users
       (email, password_hash, first_name, last_name, phone, birth_date, role_id, is_active, avatar_url)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id`,
    [
      data.email,
      data.passwordHash,
      data.firstName,
      data.lastName,
      data.phone ?? null,
      data.birthDate ?? null,
      data.roleId,
      data.isActive ?? true,
      data.avatarUrl ?? null,
    ]
  );
  return findById(res.rows[0].id);
}

async function update(id, fields) {
  const sets = [];
  const params = [];

  if (fields.firstName !== undefined) {
    params.push(fields.firstName);
    sets.push(`first_name = $${params.length}`);
  }
  if (fields.lastName !== undefined) {
    params.push(fields.lastName);
    sets.push(`last_name = $${params.length}`);
  }
  if (fields.phone !== undefined) {
    params.push(fields.phone);
    sets.push(`phone = $${params.length}`);
  }
  if (fields.birthDate !== undefined) {
    params.push(fields.birthDate);
    sets.push(`birth_date = $${params.length}`);
  }
  if (fields.avatarUrl !== undefined) {
    params.push(fields.avatarUrl);
    sets.push(`avatar_url = $${params.length}`);
  }
  if (fields.roleId !== undefined) {
    params.push(fields.roleId);
    sets.push(`role_id = $${params.length}`);
  }
  if (fields.isActive !== undefined) {
    params.push(fields.isActive);
    sets.push(`is_active = $${params.length}`);
  }
  if (fields.passwordHash !== undefined) {
    params.push(fields.passwordHash);
    sets.push(`password_hash = $${params.length}`);
    sets.push('password_changed_at = now()');
  }

  if (sets.length === 0) return findById(id);

  params.push(id);
  const res = await pool.query(
    `UPDATE gym.users SET ${sets.join(', ')}
     WHERE id = $${params.length} AND deleted_at IS NULL
     RETURNING id`,
    params
  );
  if (res.rowCount === 0) return null;
  return findById(id);
}

async function softDelete(id) {
  const res = await pool.query(
    `UPDATE gym.users SET deleted_at = now()
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING id`,
    [id]
  );
  return res.rowCount > 0;
}

async function touchLastLogin(id) {
  await pool.query('UPDATE gym.users SET last_login_at = now() WHERE id = $1', [id]);
}

module.exports = {
  findAll,
  findById,
  findActiveById,
  findByEmailForAuth,
  findWithPasswordById,
  emailExists,
  roleExists,
  create,
  update,
  softDelete,
  touchLastLogin,
  sanitize,
};
