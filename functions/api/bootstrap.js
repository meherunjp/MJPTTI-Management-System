import { loadState } from './_lib/state.js';
import { readSession, json } from './_lib/auth.js';

export async function onRequestGet({ request, env }) {
  try {
    const user = await readSession(request, env);

    if (!user) {
      return json({ error: 'Not authenticated.' }, 401);
    }

    const row = await env.DB
      .prepare('SELECT data, version FROM app_state WHERE id=1')
      .first();

    if (!row) {
      return json({ error: 'Application state not found.' }, 500);
    }

    const state = await loadState(env);

    return json({
      state,
      user,
      version: Number(row.version || 1)
    });
  } catch (e) {
    return json({ error: e.message || 'Bootstrap failed.' }, 500);
  }
}
