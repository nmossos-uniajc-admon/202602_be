const pool = require('../config/db');

const EXERCISE_SELECT = `
  SELECT
    re.id,
    re.routine_day_id,
    re.exercise_id,
    re.work_type,
    re.order_index,
    re.notes,
    e.name AS exercise_name,
    e.description AS exercise_description,
    et.id AS type_id,
    et.name AS type_name,
    sd.sets AS st_sets,
    sd.reps AS st_reps,
    sd.suggested_weight AS st_weight,
    sd.weight_unit AS st_unit,
    sd.rest_seconds AS st_rest,
    idt.sets AS iso_sets,
    idt.hold_seconds AS iso_hold,
    idt.rest_seconds AS iso_rest,
    cd.duration_seconds AS ca_duration,
    cd.distance_meters AS ca_distance,
    cd.intensity AS ca_intensity,
    cd.method AS ca_method,
    cd.interval_series AS ca_series,
    cd.interval_work_seconds AS ca_work,
    cd.interval_rest_seconds AS ca_rest
  FROM gym.routine_exercises re
  JOIN gym.exercises e ON e.id = re.exercise_id
  JOIN gym.exercise_types et ON et.id = e.exercise_type_id
  LEFT JOIN gym.routine_strength_details sd ON sd.routine_exercise_id = re.id
  LEFT JOIN gym.routine_isometric_details idt ON idt.routine_exercise_id = re.id
  LEFT JOIN gym.routine_cardio_details cd ON cd.routine_exercise_id = re.id
`;

function num(value) {
  return value === null || value === undefined ? null : Number(value);
}

function mapExercise(row) {
  const base = {
    id: row.id,
    orderIndex: row.order_index,
    workType: row.work_type,
    notes: row.notes,
    exercise: {
      id: row.exercise_id,
      name: row.exercise_name,
      description: row.exercise_description,
      exerciseType: { id: row.type_id, name: row.type_name },
    },
  };

  if (row.work_type === 'STRENGTH') {
    base.details = {
      sets: row.st_sets,
      reps: row.st_reps,
      suggestedWeight: num(row.st_weight),
      weightUnit: row.st_unit,
      restSeconds: row.st_rest,
    };
  } else if (row.work_type === 'ISOMETRIC') {
    base.details = {
      sets: row.iso_sets,
      holdSeconds: row.iso_hold,
      restSeconds: row.iso_rest,
    };
  } else {
    base.details = {
      durationSeconds: row.ca_duration,
      distanceMeters: num(row.ca_distance),
      intensity: row.ca_intensity,
      method: row.ca_method,
      intervalSeries: row.ca_series,
      intervalWorkSeconds: row.ca_work,
      intervalRestSeconds: row.ca_rest,
    };
  }

  return base;
}

function mapDay(row, exercises) {
  return {
    id: row.id,
    dayNumber: row.day_number,
    name: row.name,
    description: row.description,
    exercises,
  };
}

async function findAll({ userId, search, isActive, isTemplate, limit = 20, offset = 0 }) {
  const where = ['r.deleted_at IS NULL', '(r.owner_user_id = $1 OR r.created_by_user_id = $1)'];
  const params = [userId];

  if (typeof isActive === 'boolean') {
    params.push(isActive);
    where.push(`r.is_active = $${params.length}`);
  }
  if (typeof isTemplate === 'boolean') {
    params.push(isTemplate);
    where.push(`r.is_template = $${params.length}`);
  }
  if (search && search.trim() !== '') {
    params.push(`%${search.trim()}%`);
    where.push(`r.name ILIKE $${params.length}`);
  }

  const whereSql = `WHERE ${where.join(' AND ')}`;
  const dataParams = [...params, limit, offset];

  const countSql = `SELECT COUNT(*)::int AS total FROM gym.routines r ${whereSql}`;
  const dataSql = `
    SELECT
      r.id, r.name, r.description, r.is_template, r.is_active, r.created_at, r.updated_at,
      json_build_object('id', o.id, 'firstName', o.first_name, 'lastName', o.last_name, 'email', o.email) AS owner_user,
      json_build_object('id', c.id, 'firstName', c.first_name, 'lastName', c.last_name, 'email', c.email) AS created_by_user,
      (SELECT count(*)::int FROM gym.routine_days d WHERE d.routine_id = r.id) AS day_count
    FROM gym.routines r
    JOIN gym.users o ON o.id = r.owner_user_id
    JOIN gym.users c ON c.id = r.created_by_user_id
    ${whereSql}
    ORDER BY r.created_at DESC
    LIMIT $${params.length + 1} OFFSET $${params.length + 2}
  `;

  const [countRes, dataRes] = await Promise.all([
    pool.query(countSql, params),
    pool.query(dataSql, dataParams),
  ]);

  return {
    items: dataRes.rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      isTemplate: row.is_template,
      isActive: row.is_active,
      ownerUser: row.owner_user,
      createdByUser: row.created_by_user,
      dayCount: row.day_count,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
    total: countRes.rows[0].total,
    limit,
    offset,
  };
}

async function findById(id) {
  const res = await pool.query(
    `SELECT
       r.id, r.name, r.description, r.is_template, r.is_active, r.based_on_routine_id,
       r.created_at, r.updated_at,
       json_build_object('id', o.id, 'firstName', o.first_name, 'lastName', o.last_name, 'email', o.email) AS owner_user,
       json_build_object('id', c.id, 'firstName', c.first_name, 'lastName', c.last_name, 'email', c.email) AS created_by_user
     FROM gym.routines r
     JOIN gym.users o ON o.id = r.owner_user_id
     JOIN gym.users c ON c.id = r.created_by_user_id
     WHERE r.id = $1 AND r.deleted_at IS NULL`,
    [id]
  );
  if (!res.rows[0]) return null;
  const row = res.rows[0];

  const daysRes = await pool.query(
    `SELECT id, day_number, name, description
     FROM gym.routine_days
     WHERE routine_id = $1
     ORDER BY day_number`,
    [id]
  );

  const exRes = await pool.query(
    `${EXERCISE_SELECT}
     WHERE re.routine_day_id IN (SELECT id FROM gym.routine_days WHERE routine_id = $1)
     ORDER BY re.routine_day_id, re.order_index`,
    [id]
  );

  const byDay = new Map();
  for (const exerciseRow of exRes.rows) {
    if (!byDay.has(exerciseRow.routine_day_id)) byDay.set(exerciseRow.routine_day_id, []);
    byDay.get(exerciseRow.routine_day_id).push(mapExercise(exerciseRow));
  }

  return {
    id: row.id,
    name: row.name,
    description: row.description,
    isTemplate: row.is_template,
    isActive: row.is_active,
    basedOnRoutineId: row.based_on_routine_id,
    ownerUser: row.owner_user,
    createdByUser: row.created_by_user,
    days: daysRes.rows.map((day) => mapDay(day, byDay.get(day.id) || [])),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function getOwnership(id) {
  const res = await pool.query(
    `SELECT id, owner_user_id, created_by_user_id
     FROM gym.routines
     WHERE id = $1 AND deleted_at IS NULL`,
    [id]
  );
  return res.rows[0] || null;
}

async function findDayRaw(dayId) {
  const res = await pool.query(
    'SELECT id, routine_id, day_number, name, description FROM gym.routine_days WHERE id = $1',
    [dayId]
  );
  return res.rows[0] || null;
}

async function findExerciseRaw(exerciseRowId) {
  const res = await pool.query(
    `SELECT re.id, re.routine_day_id, re.work_type, re.exercise_id, re.order_index, re.notes, d.routine_id
     FROM gym.routine_exercises re
     JOIN gym.routine_days d ON d.id = re.routine_day_id
     WHERE re.id = $1`,
    [exerciseRowId]
  );
  return res.rows[0] || null;
}

async function getDayById(dayId) {
  const dayRes = await pool.query(
    'SELECT id, day_number, name, description FROM gym.routine_days WHERE id = $1',
    [dayId]
  );
  if (!dayRes.rows[0]) return null;
  const exRes = await pool.query(
    `${EXERCISE_SELECT} WHERE re.routine_day_id = $1 ORDER BY re.order_index`,
    [dayId]
  );
  return mapDay(dayRes.rows[0], exRes.rows.map(mapExercise));
}

async function getExerciseById(exerciseRowId) {
  const res = await pool.query(`${EXERCISE_SELECT} WHERE re.id = $1`, [exerciseRowId]);
  return res.rows[0] ? mapExercise(res.rows[0]) : null;
}

async function insertDetails(client, routineExerciseId, workType, details) {
  if (workType === 'STRENGTH') {
    await client.query(
      `INSERT INTO gym.routine_strength_details
         (routine_exercise_id, sets, reps, suggested_weight, weight_unit, rest_seconds)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        routineExerciseId,
        details.sets,
        details.reps,
        details.suggestedWeight,
        details.weightUnit,
        details.restSeconds,
      ]
    );
  } else if (workType === 'ISOMETRIC') {
    await client.query(
      `INSERT INTO gym.routine_isometric_details
         (routine_exercise_id, sets, hold_seconds, rest_seconds)
       VALUES ($1, $2, $3, $4)`,
      [routineExerciseId, details.sets, details.holdSeconds, details.restSeconds]
    );
  } else {
    await client.query(
      `INSERT INTO gym.routine_cardio_details
         (routine_exercise_id, duration_seconds, distance_meters, intensity, method,
          interval_series, interval_work_seconds, interval_rest_seconds)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        routineExerciseId,
        details.durationSeconds,
        details.distanceMeters,
        details.intensity,
        details.method,
        details.intervalSeries,
        details.intervalWorkSeconds,
        details.intervalRestSeconds,
      ]
    );
  }
}

async function insertStructure(client, routineId, days) {
  for (const day of days) {
    const dayRes = await client.query(
      `INSERT INTO gym.routine_days (routine_id, day_number, name, description)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [routineId, day.dayNumber, day.name, day.description ?? null]
    );
    const dayId = dayRes.rows[0].id;

    for (const exercise of day.exercises) {
      const exRes = await client.query(
        `INSERT INTO gym.routine_exercises (routine_day_id, exercise_id, work_type, order_index, notes)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [dayId, exercise.exerciseId, exercise.workType, exercise.orderIndex, exercise.notes ?? null]
      );
      await insertDetails(client, exRes.rows[0].id, exercise.workType, exercise.details);
    }
  }
}

async function create(data, userId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const res = await client.query(
      `INSERT INTO gym.routines
         (owner_user_id, created_by_user_id, based_on_routine_id, name, description, is_template, is_active)
       VALUES ($1, $1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        userId,
        data.basedOnRoutineId ?? null,
        data.name,
        data.description ?? null,
        data.isTemplate ?? false,
        data.isActive ?? true,
      ]
    );
    const routineId = res.rows[0].id;

    await insertStructure(client, routineId, data.days || []);
    await client.query('COMMIT');
    return findById(routineId);
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
    throw err;
  } finally {
    client.release();
  }
}

async function update(id, data) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const sets = [];
    const params = [];
    if (data.name !== undefined) {
      params.push(data.name);
      sets.push(`name = $${params.length}`);
    }
    if (data.description !== undefined) {
      params.push(data.description);
      sets.push(`description = $${params.length}`);
    }
    if (data.isTemplate !== undefined) {
      params.push(data.isTemplate);
      sets.push(`is_template = $${params.length}`);
    }
    if (data.isActive !== undefined) {
      params.push(data.isActive);
      sets.push(`is_active = $${params.length}`);
    }
    if (data.basedOnRoutineId !== undefined) {
      params.push(data.basedOnRoutineId);
      sets.push(`based_on_routine_id = $${params.length}`);
    }

    if (sets.length > 0) {
      params.push(id);
      await client.query(
        `UPDATE gym.routines SET ${sets.join(', ')}
         WHERE id = $${params.length} AND deleted_at IS NULL`,
        params
      );
    }

    if (data.days !== undefined) {
      await client.query('DELETE FROM gym.routine_days WHERE routine_id = $1', [id]);
      await insertStructure(client, id, data.days);
    }

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
  const res = await pool.query(
    `UPDATE gym.routines SET deleted_at = now()
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING id`,
    [id]
  );
  return res.rowCount > 0;
}

async function addDay(routineId, data) {
  const res = await pool.query(
    `INSERT INTO gym.routine_days (routine_id, day_number, name, description)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [routineId, data.dayNumber, data.name, data.description ?? null]
  );
  return getDayById(res.rows[0].id);
}

async function updateDay(dayId, data) {
  const sets = [];
  const params = [];
  if (data.dayNumber !== undefined) {
    params.push(data.dayNumber);
    sets.push(`day_number = $${params.length}`);
  }
  if (data.name !== undefined) {
    params.push(data.name);
    sets.push(`name = $${params.length}`);
  }
  if (data.description !== undefined) {
    params.push(data.description);
    sets.push(`description = $${params.length}`);
  }
  if (sets.length === 0) return getDayById(dayId);

  params.push(dayId);
  await pool.query(
    `UPDATE gym.routine_days SET ${sets.join(', ')} WHERE id = $${params.length}`,
    params
  );
  return getDayById(dayId);
}

async function deleteDay(dayId) {
  const res = await pool.query('DELETE FROM gym.routine_days WHERE id = $1 RETURNING id', [dayId]);
  return res.rowCount > 0;
}

async function addExercise(dayId, data) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const res = await client.query(
      `INSERT INTO gym.routine_exercises (routine_day_id, exercise_id, work_type, order_index, notes)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [dayId, data.exerciseId, data.workType, data.orderIndex, data.notes ?? null]
    );
    const exerciseRowId = res.rows[0].id;
    await insertDetails(client, exerciseRowId, data.workType, data.details);
    await client.query('COMMIT');
    return getExerciseById(exerciseRowId);
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
    throw err;
  } finally {
    client.release();
  }
}

async function updateExercise(exerciseRowId, data) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const current = await client.query(
      'SELECT work_type FROM gym.routine_exercises WHERE id = $1',
      [exerciseRowId]
    );
    if (current.rows.length === 0) {
      await client.query('ROLLBACK');
      return null;
    }
    const effectiveWorkType = data.workType ?? current.rows[0].work_type;

    const sets = [];
    const params = [];
    if (data.exerciseId !== undefined) {
      params.push(data.exerciseId);
      sets.push(`exercise_id = $${params.length}`);
    }
    if (data.workType !== undefined) {
      params.push(data.workType);
      sets.push(`work_type = $${params.length}`);
    }
    if (data.orderIndex !== undefined) {
      params.push(data.orderIndex);
      sets.push(`order_index = $${params.length}`);
    }
    if (data.notes !== undefined) {
      params.push(data.notes);
      sets.push(`notes = $${params.length}`);
    }

    if (sets.length > 0) {
      params.push(exerciseRowId);
      await client.query(
        `UPDATE gym.routine_exercises SET ${sets.join(', ')} WHERE id = $${params.length}`,
        params
      );
    }

    if (data.details !== undefined) {
      await client.query('DELETE FROM gym.routine_strength_details WHERE routine_exercise_id = $1', [exerciseRowId]);
      await client.query('DELETE FROM gym.routine_isometric_details WHERE routine_exercise_id = $1', [exerciseRowId]);
      await client.query('DELETE FROM gym.routine_cardio_details WHERE routine_exercise_id = $1', [exerciseRowId]);
      await insertDetails(client, exerciseRowId, effectiveWorkType, data.details);
    }

    await client.query('COMMIT');
    return getExerciseById(exerciseRowId);
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
    throw err;
  } finally {
    client.release();
  }
}

async function deleteExercise(exerciseRowId) {
  const res = await pool.query(
    'DELETE FROM gym.routine_exercises WHERE id = $1 RETURNING id',
    [exerciseRowId]
  );
  return res.rowCount > 0;
}

async function findMissingExerciseIds(ids) {
  if (!ids || ids.length === 0) return [];
  const res = await pool.query(
    'SELECT id FROM gym.exercises WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL',
    [ids]
  );
  const found = new Set(res.rows.map((r) => r.id));
  return ids.filter((id) => !found.has(id));
}

async function exerciseExists(id) {
  const res = await pool.query(
    'SELECT 1 FROM gym.exercises WHERE id = $1 AND deleted_at IS NULL',
    [id]
  );
  return res.rowCount > 0;
}

module.exports = {
  findAll,
  findById,
  getOwnership,
  findDayRaw,
  findExerciseRaw,
  getDayById,
  getExerciseById,
  create,
  update,
  softDelete,
  addDay,
  updateDay,
  deleteDay,
  addExercise,
  updateExercise,
  deleteExercise,
  findMissingExerciseIds,
  exerciseExists,
};
