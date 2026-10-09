
import { readSession, json, hashPassword } from './_lib/auth.js';
import { loadState } from './_lib/state.js';

function makeTemporaryPassword() {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#';
  return Array.from(bytes, b => chars[b % chars.length]).join('');
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env.DB) {
      return json({ error: 'D1 database is not configured.' }, 503);
    }

    const user = await readSession(request, env);

    if (!user || user.role !== 'admin') {
      return json({ error: 'Admin access required.' }, 403);
    }

    const body = await request.json();
    const teacherId = String(body?.teacherId || '').trim();

    if (!teacherId) {
      return json({ error: 'Trainer ID is required.' }, 400);
    }

    const state = await loadState(env);
    const trainer = (state.teachers || []).find(
      t => String(t.id || '').trim() === teacherId
    );

    if (!trainer) {
      return json({ error: 'Trainer not found in Admin Panel.' }, 404);
    }

    const trainerLoginId = `mjptti-${teacherId}`;
    const temporaryPassword = makeTemporaryPassword();
    const passwordHash = await hashPassword(temporaryPassword);

    await env.DB.prepare(`
      INSERT INTO users
        (id, username, role, name, password_hash, active)
      VALUES (?, ?, 'trainer', ?, ?, 1)
      ON CONFLICT(id) DO UPDATE SET
        username = excluded.username,
        name = excluded.name,
        password_hash = excluded.password_hash,
        active = 1,
        updated_at = CURRENT_TIMESTAMP
    `).bind(
      trainerLoginId,
      trainerLoginId,
      String(trainer.name || trainerLoginId),
      passwordHash
    ).run();

    return json({
      ok: true,
      trainerId: trainerLoginId,
      name: String(trainer.name || ''),
      temporaryPassword
    });
  } catch (e) {
    return json({ error: e.message || 'Trainer reset failed.' }, 500);
  }
}
