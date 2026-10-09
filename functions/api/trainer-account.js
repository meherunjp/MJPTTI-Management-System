
import { readSession, json, hashPassword } from './_lib/auth.js';
import { loadState } from './_lib/state.js';

function generateTempPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$';
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, b => chars[b % chars.length]).join('');
}

export async function onRequestPost({ request, env }) {
  try {
    // Only an authenticated admin can create or reset accounts.
    const session = await readSession(request, env);

    if (!session || session.role !== 'admin') {
      return json({ error: 'Admin access required.' }, 403);
    }

    if (!env.DB) {
      return json({ error: 'D1 database binding DB is missing.' }, 503);
    }

    const body = await request.json();
    const action = String(body?.action || '');
    const requestedId = String(body?.trainerId || '').trim();

    if (!['create', 'reset'].includes(action) || !requestedId) {
      return json({
        error: 'Provide action=create/reset and trainerId.'
      }, 400);
    }

    const state = await loadState(env);
    const trainer = (state.teachers || []).find(t =>
      String(t?.id || '').trim().toLowerCase() === requestedId.toLowerCase()
    );

    if (!trainer) {
      return json({
        error: 'Trainer not found in the Admin Panel.'
      }, 404);
    }

    const internalId = String(trainer.id).trim();
    const code = internalId.replace(/^mjptti-/i, '');
    const username = `mjptti-${code}`;

    const existing = await env.DB.prepare(`
      SELECT id, username
      FROM users
      WHERE (id = ? OR username = ?)
        AND role = 'trainer'
      LIMIT 1
    `).bind(internalId, username).first();

    if (action === 'create' && existing) {
      return json({
        error: 'Trainer account already exists. Use action=reset.'
      }, 409);
    }

    if (existing && existing.id !== internalId) {
      return json({
        error: 'Account ID conflict. Check the users table before proceeding.'
      }, 409);
    }

    const password = generateTempPassword();
    const passwordHash = await hashPassword(password);
    const name = String(trainer.name || internalId);

    if (existing) {
      await env.DB.prepare(`
        UPDATE users
        SET username = ?,
            name = ?,
            password_hash = ?,
            active = 1,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND role = 'trainer'
      `).bind(username, name, passwordHash, internalId).run();
    } else {
      await env.DB.prepare(`
        INSERT INTO users
          (id, username, role, name, password_hash, active)
        VALUES (?, ?, 'trainer', ?, ?, 1)
      `).bind(internalId, username, name, passwordHash).run();
    }

    // Plaintext password is returned only for this admin request.
    // It is never stored as plaintext in D1.
    return json({
      ok: true,
      action,
      trainerId: internalId,
      username,
      temporaryPassword: password,
      message: 'Save this password securely. It will not be shown again.'
    });
  } catch (error) {
    return json({
      error: error?.message || 'Trainer account operation failed.'
    }, 500);
  }
}
