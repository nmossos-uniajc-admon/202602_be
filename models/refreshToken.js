const pool = require('../config/db');

async function insert({ id, userId, tokenHash, familyId, expiresAt, ip, userAgent }) {
  await pool.query(
    `INSERT INTO gym.refresh_tokens
       (id, user_id, token_hash, family_id, expires_at, created_by_ip, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, userId, tokenHash, familyId, expiresAt, ip || null, userAgent || null]
  );
}

async function findById(id) {
  const res = await pool.query(
    `SELECT rt.id, rt.user_id, rt.token_hash, rt.family_id, rt.expires_at,
            rt.revoked_at, rt.replaced_by_token_id,
            u.is_active, u.deleted_at
     FROM gym.refresh_tokens rt
     JOIN gym.users u ON u.id = rt.user_id
     WHERE rt.id = $1`,
    [id]
  );
  return res.rows[0] || null;
}

async function revoke(id) {
  const res = await pool.query(
    `UPDATE gym.refresh_tokens SET revoked_at = now()
     WHERE id = $1 AND revoked_at IS NULL
     RETURNING id`,
    [id]
  );
  return res.rowCount > 0;
}

async function revokeFamily(familyId) {
  const res = await pool.query(
    `UPDATE gym.refresh_tokens SET revoked_at = now()
     WHERE family_id = $1 AND revoked_at IS NULL
     RETURNING id`,
    [familyId]
  );
  return res.rowCount;
}

async function revokeAllForUser(userId) {
  const res = await pool.query(
    `UPDATE gym.refresh_tokens SET revoked_at = now()
     WHERE user_id = $1 AND revoked_at IS NULL
     RETURNING id`,
    [userId]
  );
  return res.rowCount;
}

async function rotate(oldRow, { id, tokenHash, expiresAt, ip, userAgent }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `INSERT INTO gym.refresh_tokens
         (id, user_id, token_hash, family_id, expires_at, created_by_ip, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, oldRow.user_id, tokenHash, oldRow.family_id, expiresAt, ip || null, userAgent || null]
    );

    const upd = await client.query(
      `UPDATE gym.refresh_tokens
       SET revoked_at = now(), replaced_by_token_id = $2
       WHERE id = $1 AND revoked_at IS NULL
       RETURNING id`,
      [oldRow.id, id]
    );
    if (upd.rowCount === 0) {
      await client.query('ROLLBACK');
      return false;
    }

    await client.query('COMMIT');
    return true;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { insert, findById, revoke, revokeFamily, revokeAllForUser, rotate };
