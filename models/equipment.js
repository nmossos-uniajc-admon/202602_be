const pool = require('../config/db');

const BASE_COLUMNS = 'id, name, description, is_active, created_at';

function mapRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    isActive: row.is_active,
    createdAt: row.created_at,
  };
}

async function findAll({ isActive, search, limit = 20, offset = 0 } = {}) {
  const where = [];
  const whereParams = [];

  if (typeof isActive === 'boolean') {
    whereParams.push(isActive);
    where.push(`is_active = $${whereParams.length}`);
  }

  if (search && search.trim() !== '') {
    whereParams.push(`%${search.trim()}%`);
    where.push(`name ILIKE $${whereParams.length}`);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const dataParams = [...whereParams, limit, offset];
  const limitParam = whereParams.length + 1;
  const offsetParam = whereParams.length + 2;

  const countSql = `SELECT COUNT(*)::int AS total FROM gym.equipment ${whereSql}`;
  const dataSql = `SELECT ${BASE_COLUMNS} FROM gym.equipment ${whereSql}
                   ORDER BY id
                   LIMIT $${limitParam} OFFSET $${offsetParam}`;

  const [countRes, dataRes] = await Promise.all([
    pool.query(countSql, whereParams),
    pool.query(dataSql, dataParams),
  ]);

  return {
    items: dataRes.rows.map(mapRow),
    total: countRes.rows[0].total,
    limit,
    offset,
  };
}

async function findById(id) {
  const result = await pool.query(
    `SELECT ${BASE_COLUMNS} FROM gym.equipment WHERE id = $1`,
    [id]
  );
  return mapRow(result.rows[0]);
}

async function findByName(name) {
  const result = await pool.query(
    `SELECT ${BASE_COLUMNS} FROM gym.equipment WHERE name = $1`,
    [name]
  );
  return mapRow(result.rows[0]);
}

async function create({ name, description = null, isActive = true }) {
  const result = await pool.query(
    `INSERT INTO gym.equipment (name, description, is_active)
     VALUES ($1, $2, $3)
     RETURNING ${BASE_COLUMNS}`,
    [name, description, isActive]
  );
  return mapRow(result.rows[0]);
}

async function update(id, fields) {
  const sets = [];
  const params = [];

  if (fields.name !== undefined) {
    params.push(fields.name);
    sets.push(`name = $${params.length}`);
  }
  if (fields.description !== undefined) {
    params.push(fields.description);
    sets.push(`description = $${params.length}`);
  }
  if (fields.isActive !== undefined) {
    params.push(fields.isActive);
    sets.push(`is_active = $${params.length}`);
  }

  if (sets.length === 0) return findById(id);

  params.push(id);
  const result = await pool.query(
    `UPDATE gym.equipment SET ${sets.join(', ')} WHERE id = $${params.length}
     RETURNING ${BASE_COLUMNS}`,
    params
  );
  return mapRow(result.rows[0]);
}

async function remove(id) {
  const result = await pool.query(
    `DELETE FROM gym.equipment WHERE id = $1 RETURNING id`,
    [id]
  );
  return result.rowCount > 0;
}

module.exports = {
  findAll,
  findById,
  findByName,
  create,
  update,
  remove,
};
