require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const pool = require('../config/db');
const bcrypt = require('bcrypt');
const routineModel = require('../models/routine');

const ROUTINE_NAME = 'Rutina de nivel básico';
const MIN_ROUNDS = 12;
const rounds = Math.max(MIN_ROUNDS, Number.parseInt(process.env.BCRYPT_SALT_ROUNDS || '12', 10) || MIN_ROUNDS);

const EXERCISES = [
  { key: 'warmupArticular', name: 'Calentamiento: movilidad articular', type: 'Cardio', description: 'Círculos de brazos y rotaciones de tronco (5 minutos).' },
  { key: 'warmupCaminata', name: 'Calentamiento: caminata suave o elevación de rodillas', type: 'Cardio', description: 'Caminata suave o elevación de rodillas en el lugar (5 minutos).' },
  { key: 'warmupGeneral', name: 'Calentamiento: movilidad general', type: 'Cardio', description: 'Movilidad general de articulaciones (5 minutos).' },
  { key: 'pressBanca', name: 'Press de banca con mancuernas', type: 'Fuerza', description: 'Press de banca con mancuernas en suelo o banco.' },
  { key: 'remoUnaMano', name: 'Remo con mancuerna a una mano', type: 'Fuerza', description: 'Remo a una mano apoyado en silla o banco.' },
  { key: 'pressMilitar', name: 'Press militar con mancuernas', type: 'Fuerza', description: 'Press militar sentado con espalda apoyada.' },
  { key: 'sentadilla', name: 'Sentadilla con peso corporal', type: 'Fuerza', description: 'Sentadilla con el propio peso corporal.' },
  { key: 'wallSit', name: 'Sentadilla estática contra la pared (Wall Sit)', type: 'Fuerza', description: 'Isométrico contra la pared con rodillas a 90 grados.' },
  { key: 'pesoMuertoRumano', name: 'Peso muerto rumano con mancuernas', type: 'Fuerza', description: 'Enfoque en glúteos y femorales, espalda recta.' },
  { key: 'elevacionTalones', name: 'Elevación de talones de pie con mancuernas', type: 'Fuerza', description: 'Elevación de talones con mancuernas a los lados.' },
  { key: 'zancadas', name: 'Zancadas estáticas con peso corporal', type: 'Fuerza', description: 'Zancadas estáticas (Lunges) con peso corporal.' },
  { key: 'flexiones', name: 'Flexiones de brazos con manos elevadas', type: 'Fuerza', description: 'Push-ups con manos elevadas en banco o pared.' },
  { key: 'elevacionesLaterales', name: 'Elevaciones laterales con mancuernas', type: 'Fuerza', description: 'Elevaciones laterales para hombros.' },
  { key: 'plancha', name: 'Plancha abdominal tradicional', type: 'Fuerza', description: 'Isométrico de plancha abdominal con peso corporal.' },
  { key: 'planchaLateral', name: 'Plancha lateral', type: 'Fuerza', description: 'Isométrico de plancha lateral, apoyando rodillas si es necesario.' },
  { key: 'puenteGluteos', name: 'Puente de glúteos', type: 'Fuerza', description: 'Puente de glúteos tumbado boca arriba.' },
  { key: 'remoInvertido', name: 'Remo invertido con mancuernas', type: 'Fuerza', description: 'Remo con ambos brazos y tronco inclinado 45 grados.' },
  { key: 'curlExtension', name: 'Curl de bíceps + extensión de tríceps con mancuerna', type: 'Fuerza', description: 'Curl de bíceps y extensión de tríceps con la misma mancuerna.' },
];

function cardio(exerciseId, orderIndex, notes) {
  return {
    exerciseId,
    workType: 'CARDIO',
    orderIndex,
    notes: notes ?? null,
    details: { durationSeconds: 300, method: 'CONTINUOUS', intensity: 'Baja' },
  };
}

function strength(exerciseId, orderIndex, { sets, reps, weight = null, rest, notes = null }) {
  return {
    exerciseId,
    workType: 'STRENGTH',
    orderIndex,
    notes,
    details: {
      sets,
      reps,
      suggestedWeight: weight,
      weightUnit: weight === null ? null : 'KG',
      restSeconds: rest,
    },
  };
}

function isometric(exerciseId, orderIndex, { sets, hold, rest, notes = null }) {
  return {
    exerciseId,
    workType: 'ISOMETRIC',
    orderIndex,
    notes,
    details: { sets, holdSeconds: hold, restSeconds: rest },
  };
}

async function ensureExercise(ids, typeIds, def) {
  const found = await pool.query('SELECT id, deleted_at FROM gym.exercises WHERE name = $1', [def.name]);
  if (found.rowCount > 0) {
    const row = found.rows[0];
    if (row.deleted_at) {
      await pool.query('UPDATE gym.exercises SET deleted_at = NULL WHERE id = $1', [row.id]);
      console.log(`  Ejercicio reactivado: ${def.name}`);
    }
    ids[def.key] = row.id;
    return;
  }
  const ins = await pool.query(
    `INSERT INTO gym.exercises (name, description, exercise_type_id)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [def.name, def.description, typeIds[def.type]]
  );
  ids[def.key] = ins.rows[0].id;
  console.log(`  Ejercicio creado: ${def.name}`);
}

(async () => {
  const ownerEmail = (process.env.SEED_OWNER_EMAIL || 'trainer@gym.local').trim().toLowerCase();
  const ownerPassword = process.env.SEED_OWNER_PASSWORD || 'Trainer123!';
  if (ownerPassword.length < 8) {
    console.error('Error: SEED_OWNER_PASSWORD debe tener al menos 8 caracteres.');
    process.exit(1);
  }

  const roleRes = await pool.query("SELECT id FROM gym.roles WHERE code = 'TRAINER'");
  const typeRes = await pool.query('SELECT id, name FROM gym.exercise_types');
  if (roleRes.rowCount === 0 || typeRes.rowCount === 0) {
    console.error('Error: faltan roles o tipos de ejercicio. Ejecute db/script.sql primero.');
    process.exit(1);
  }
  const typeIds = {};
  for (const row of typeRes.rows) typeIds[row.name] = row.id;
  if (!typeIds.Cardio || !typeIds.Fuerza) {
    console.error("Error: se requieren los tipos de ejercicio 'Cardio' y 'Fuerza'.");
    process.exit(1);
  }

  // 1) Dueño (TRAINER)
  let ownerId;
  const ownerFound = await pool.query(
    'SELECT id FROM gym.users WHERE email = $1 AND deleted_at IS NULL',
    [ownerEmail]
  );
  if (ownerFound.rowCount > 0) {
    ownerId = ownerFound.rows[0].id;
    console.log(`Dueño existente: ${ownerEmail} (id=${ownerId})`);
  } else {
    const hash = await bcrypt.hash(ownerPassword, rounds);
    const ins = await pool.query(
      `INSERT INTO gym.users (email, password_hash, first_name, last_name, role_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [ownerEmail, hash, 'Seed', 'Trainer', roleRes.rows[0].id]
    );
    ownerId = ins.rows[0].id;
    console.log(`Dueño creado: ${ownerEmail} (id=${ownerId}, rol=TRAINER)`);
  }

  // 2) Ejercicios del catálogo
  const ids = {};
  console.log('Asegurando ejercicios del catálogo...');
  for (const def of EXERCISES) {
    await ensureExercise(ids, typeIds, def);
  }

  // 3) Evitar duplicar la rutina
  const exists = await pool.query(
    'SELECT id FROM gym.routines WHERE owner_user_id = $1 AND name = $2 AND deleted_at IS NULL',
    [ownerId, ROUTINE_NAME]
  );
  if (exists.rowCount > 0) {
    console.log(`La rutina "${ROUTINE_NAME}" ya existe para ${ownerEmail} (id=${exists.rows[0].id}). Nada que hacer.`);
    process.exit(0);
  }

  // 4) Estructura de la rutina
  const days = [
    {
      dayNumber: 1,
      name: 'Torso (Fuerza y Postura)',
      description: null,
      exercises: [
        cardio(ids.warmupArticular, 1, 'Círculos de brazos y rotaciones de tronco'),
        strength(ids.pressBanca, 2, { sets: 3, reps: 10, weight: 6, rest: 60 }),
        strength(ids.remoUnaMano, 3, { sets: 3, reps: 12, weight: 6, rest: 60, notes: 'por lado' }),
        strength(ids.pressMilitar, 4, { sets: 3, reps: 10, weight: 5, rest: 60 }),
        isometric(ids.plancha, 5, { sets: 3, hold: 30, rest: 45 }),
      ],
    },
    {
      dayNumber: 2,
      name: 'Piernas y Abdomen (Estabilidad y Fuerza)',
      description: null,
      exercises: [
        cardio(ids.warmupCaminata, 1, 'Caminata suave o elevación de rodillas'),
        strength(ids.sentadilla, 2, { sets: 3, reps: 12, rest: 90 }),
        isometric(ids.wallSit, 3, { sets: 3, hold: 30, rest: 60, notes: '30-45 segundos; rodillas a 90°' }),
        strength(ids.pesoMuertoRumano, 4, { sets: 3, reps: 10, weight: 6, rest: 90, notes: 'Espalda recta' }),
        strength(ids.elevacionTalones, 5, { sets: 3, reps: 15, weight: 3, rest: 45 }),
      ],
    },
    {
      dayNumber: 3,
      name: 'Cuerpo Completo (Enfoque Empuje)',
      description: null,
      exercises: [
        cardio(ids.warmupGeneral, 1, 'Movilidad general'),
        strength(ids.zancadas, 2, { sets: 3, reps: 10, rest: 60, notes: 'por pierna' }),
        strength(ids.flexiones, 3, { sets: 3, reps: 8, rest: 60, notes: '8-10 repeticiones; manos elevadas' }),
        strength(ids.elevacionesLaterales, 4, { sets: 3, reps: 12, weight: 3, rest: 45 }),
        isometric(ids.planchaLateral, 5, { sets: 2, hold: 20, rest: 45, notes: 'por lado' }),
      ],
    },
    {
      dayNumber: 4,
      name: 'Cuerpo Completo (Enfoque Tracción y Core)',
      description: null,
      exercises: [
        cardio(ids.warmupGeneral, 1, 'Movilidad general'),
        strength(ids.puenteGluteos, 2, { sets: 3, reps: 15, rest: 60, notes: 'Contraer glúteos 2 s arriba' }),
        strength(ids.remoInvertido, 3, { sets: 3, reps: 10, weight: 6, rest: 60, notes: 'Tronco inclinado 45°' }),
        strength(ids.curlExtension, 4, { sets: 3, reps: 12, weight: 3, rest: 60, notes: '12 por cada uno' }),
        isometric(ids.wallSit, 5, { sets: 2, hold: 40, rest: 60 }),
      ],
    },
  ];

  const routine = await routineModel.create(
    {
      name: ROUTINE_NAME,
      description: 'Rutina de 4 días para nivel principiante: fuerza, estabilidad y core.',
      isTemplate: false,
      isActive: true,
      days,
    },
    ownerId
  );

  console.log(`Rutina creada: "${routine.name}" (id=${routine.id}) para ${ownerEmail}.`);
  console.log(`  Días: ${routine.days.length} | Ejercicios totales: ${routine.days.reduce((n, d) => n + d.exercises.length, 0)}`);
  process.exit(0);
})().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
