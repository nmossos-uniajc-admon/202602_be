require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const pool = require('../config/db');
const bcrypt = require('bcrypt');

const MIN_ROUNDS = 12;
const rounds = Math.max(MIN_ROUNDS, Number.parseInt(process.env.BCRYPT_SALT_ROUNDS || '12', 10) || MIN_ROUNDS);

(async () => {
  const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || '';
  const firstName = (process.env.ADMIN_FIRST_NAME || 'Admin').trim();
  const lastName = (process.env.ADMIN_LAST_NAME || 'Gym').trim();

  if (!email || !password) {
    console.error('Error: defina ADMIN_EMAIL y ADMIN_PASSWORD en .env');
    process.exit(1);
  }
  if (password.length < 8) {
    console.error('Error: ADMIN_PASSWORD debe tener al menos 8 caracteres.');
    process.exit(1);
  }

  const roleRes = await pool.query("SELECT id FROM gym.roles WHERE code = 'ADMIN'");
  if (roleRes.rowCount === 0) {
    console.error("Error: no existe el rol 'ADMIN' en gym.roles. Ejecute db/script.sql primero.");
    process.exit(1);
  }
  const roleId = roleRes.rows[0].id;

  const existing = await pool.query('SELECT id, deleted_at FROM gym.users WHERE email = $1', [email]);
  if (existing.rowCount > 0) {
    const u = existing.rows[0];
    console.log(
      u.deleted_at
        ? `El admin ${email} existe pero está borrado lógicamente (id=${u.id}).`
        : `El admin ${email} ya existe (id=${u.id}). Nada que hacer.`
    );
    process.exit(0);
  }

  const passwordHash = await bcrypt.hash(password, rounds);
  const ins = await pool.query(
    `INSERT INTO gym.users (email, password_hash, first_name, last_name, role_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, email`,
    [email, passwordHash, firstName, lastName, roleId]
  );

  console.log(
    `Admin creado: ${ins.rows[0].email} (id=${ins.rows[0].id}, rol=ADMIN, bcrypt rounds=${rounds})`
  );
  process.exit(0);
})().catch((e) => {
  console.error('Error:', e.message);
  process.exit(1);
});
