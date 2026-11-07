const pool = require('../config/db');

const DETAIL_SQL = `
  SELECT
    e.id,
    e.name,
    e.description,
    e.is_active,
    e.created_at,
    e.updated_at,
    e.deleted_at,
    json_build_object('id', et.id, 'name', et.name) AS exercise_type,
    CASE
      WHEN u.id IS NULL THEN NULL
      ELSE json_build_object('id', u.id, 'firstName', u.first_name, 'lastName', u.last_name, 'email', u.email)
    END AS created_by_user,
    COALESCE(eq.equipment, '[]'::json) AS equipment,
    COALESCE(tm.muscles, '[]'::json) AS target_muscles,
    COALESCE(sm.muscles, '[]'::json) AS secondary_muscles
  FROM gym.exercises e
  JOIN gym.exercise_types et ON et.id = e.exercise_type_id
  LEFT JOIN gym.users u ON u.id = e.created_by_user_id
  LEFT JOIN LATERAL (
    SELECT json_agg(json_build_object('id', q.id, 'name', q.name) ORDER BY q.id) AS equipment
    FROM gym.exercise_equipment ee
    JOIN gym.equipment q ON q.id = ee.equipment_id
    WHERE ee.exercise_id = e.id
  ) eq ON TRUE
  LEFT JOIN LATERAL (
    SELECT json_agg(json_build_object('id', m.id, 'name', m.name) ORDER BY m.id) AS muscles
    FROM gym.exercise_target_muscles t
    JOIN gym.muscles m ON m.id = t.muscle_id
    WHERE t.exercise_id = e.id
  ) tm ON TRUE
  LEFT JOIN LATERAL (
    SELECT json_agg(json_build_object('id', m.id, 'name', m.name) ORDER BY m.id) AS muscles
    FROM gym.exercise_secondary_muscles s
    JOIN gym.muscles m ON m.id = s.muscle_id
    WHERE s.exercise_id = e.id
  ) sm ON TRUE
  WHERE e.id = $1 AND e.deleted_at IS NULL
`;

function mapListRow(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    exerciseType: { id: row.exercise_type_id, name: row.exercise_type_name },
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapDetailRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    exerciseType: row.exercise_type,
    createdByUser: row.created_by_user,
    isActive: row.is_active,
    equipment: row.equipment,
    targetMuscles: row.target_muscles,
    secondaryMuscles: row.secondary_muscles,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function findAll({ search, isActive, typeId, equipmentId, muscleId, limit = 20, offset = 0 } = {}) {
  const where = ['e.deleted_at IS NULL'];
  const whereParams = [];

  if (typeof isActive === 'boolean') {
    whereParams.push(isActive);
    where.push(`e.is_active = $${whereParams.length}`);
  }
  if (typeId !== undefined) {
    whereParams.push(typeId);
    where.push(`e.exercise_type_id = $${whereParams.length}`);
  }
  if (search && search.trim() !== '') {
    whereParams.push(`%${search.trim()}%`);
    where.push(`e.name ILIKE $${whereParams.length}`);
  }
  if (equipmentId !== undefined) {
    whereParams.push(equipmentId);
    where.push(`EXISTS (
      SELECT 1 FROM gym.exercise_equipment ee
      WHERE ee.exercise_id = e.id AND ee.equipment_id = $${whereParams.length}
    )`);
  }
  if (muscleId !== undefined) {
    whereParams.push(muscleId);
    where.push(`(
      EXISTS (SELECT 1 FROM gym.exercise_target_muscles t
              WHERE t.exercise_id = e.id AND t.muscle_id = $${whereParams.length})
      OR
      EXISTS (SELECT 1 FROM gym.exercise_secondary_muscles s
              WHERE s.exercise_id = e.id AND s.muscle_id = $${whereParams.length})
    )`);
  }

  const whereSql = `WHERE ${where.join(' AND ')}`;
  const dataParams = [...whereParams, limit, offset];
  const limitParam = whereParams.length + 1;
  const offsetParam = whereParams.length + 2;

  const countSql = `SELECT COUNT(*)::int AS total FROM gym.exercises e ${whereSql}`;
  const dataSql = `
    SELECT e.id, e.name, e.description, e.exercise_type_id, et.name AS exercise_type_name,
           e.is_active, e.created_at, e.updated_at
    FROM gym.exercises e
    JOIN gym.exercise_types et ON et.id = e.exercise_type_id
    ${whereSql}
    ORDER BY e.name
    LIMIT $${limitParam} OFFSET $${offsetParam}
  `;

  const [countRes, dataRes] = await Promise.all([
    pool.query(countSql, whereParams),
    pool.query(dataSql, dataParams),
  ]);

  return {
    items: dataRes.rows.map(mapListRow),
    total: countRes.rows[0].total,
    limit,
    offset,
  };
}

async function findById(id) {
  const result = await pool.query(DETAIL_SQL, [id]);
  return mapDetailRow(result.rows[0]);
}

async function insertBatch(client, table, column, exerciseId, ids) {
  if (!ids || ids.length === 0) return;
  const values = ids.map((_, i) => `($1, $${i + 2})`).join(', ');
  await client.query(
    `INSERT INTO ${table} (exercise_id, ${column}) VALUES ${values}`,
    [exerciseId, ...ids]
  );
}

async function create(data) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const res = await client.query(
      `INSERT INTO gym.exercises (name, description, exercise_type_id, created_by_user_id, is_active)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [
        data.name,
        data.description ?? null,
        data.exerciseTypeId,
        data.createdByUserId ?? null,
        data.isActive ?? true,
      ]
    );
    const id = res.rows[0].id;

    await insertBatch(client, 'gym.exercise_equipment', 'equipment_id', id, data.equipmentIds);
    await insertBatch(client, 'gym.exercise_target_muscles', 'muscle_id', id, data.targetMuscleIds);
    await insertBatch(client, 'gym.exercise_secondary_muscles', 'muscle_id', id, data.secondaryMuscleIds);

    await client.query('COMMIT');
    return findById(id);
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
    throw err;
  } finally {
    client.release();
  }
}

async function update(id, fields) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const current = await client.query(
      'SELECT id FROM gym.exercises WHERE id = $1 AND deleted_at IS NULL',
      [id]
    );
    if (current.rowCount === 0) {
      await client.query('ROLLBACK');
      return null;
    }

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
    if (fields.exerciseTypeId !== undefined) {
      params.push(fields.exerciseTypeId);
      sets.push(`exercise_type_id = $${params.length}`);
    }
    if (fields.createdByUserId !== undefined) {
      params.push(fields.createdByUserId);
      sets.push(`created_by_user_id = $${params.length}`);
    }
    if (fields.isActive !== undefined) {
      params.push(fields.isActive);
      sets.push(`is_active = $${params.length}`);
    }

    if (sets.length > 0) {
      params.push(id);
      await client.query(
        `UPDATE gym.exercises SET ${sets.join(', ')} WHERE id = $${params.length}`,
        params
      );
    }

    const replaceTarget = fields.targetMuscleIds !== undefined;
    const replaceSecondary = fields.secondaryMuscleIds !== undefined;

    if (fields.equipmentIds !== undefined) {
      await client.query('DELETE FROM gym.exercise_equipment WHERE exercise_id = $1', [id]);
    }
    if (replaceTarget) {
      await client.query('DELETE FROM gym.exercise_target_muscles WHERE exercise_id = $1', [id]);
    }
    if (replaceSecondary) {
      await client.query('DELETE FROM gym.exercise_secondary_muscles WHERE exercise_id = $1', [id]);
    }

    await insertBatch(client, 'gym.exercise_equipment', 'equipment_id', id, fields.equipmentIds);
    await insertBatch(client, 'gym.exercise_target_muscles', 'muscle_id', id, fields.targetMuscleIds);
    await insertBatch(client, 'gym.exercise_secondary_muscles', 'muscle_id', id, fields.secondaryMuscleIds);

    await client.query('COMMIT');
    return findById(id);
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
    throw err;
  } finally {
    client.release();
  }
}

async function softDelete(id) {
  const result = await pool.query(
    `UPDATE gym.exercises SET deleted_at = now()
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING id`,
    [id]
  );
  return result.rowCount > 0;
}

async function findMissingEquipmentIds(ids) {
  if (!ids || ids.length === 0) return [];
  const res = await pool.query('SELECT id FROM gym.equipment WHERE id = ANY($1::smallint[])', [ids]);
  const found = new Set(res.rows.map((r) => r.id));
  return ids.filter((x) => !found.has(x));
}

async function findMissingMuscleIds(ids) {
  if (!ids || ids.length === 0) return [];
  const res = await pool.query('SELECT id FROM gym.muscles WHERE id = ANY($1::smallint[])', [ids]);
  const found = new Set(res.rows.map((r) => r.id));
  return ids.filter((x) => !found.has(x));
}

async function exerciseTypeExists(id) {
  const res = await pool.query('SELECT 1 FROM gym.exercise_types WHERE id = $1', [id]);
  return res.rowCount > 0;
}

async function userExists(id) {
  const res = await pool.query(
    'SELECT 1 FROM gym.users WHERE id = $1 AND deleted_at IS NULL',
    [id]
  );
  return res.rowCount > 0;
}

module.exports = {
  findAll,
  findById,
  create,
  update,
  softDelete,
  findMissingEquipmentIds,
  findMissingMuscleIds,
  exerciseTypeExists,
  userExists,
};
