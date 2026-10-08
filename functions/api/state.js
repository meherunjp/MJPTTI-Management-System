import { loadState, saveState } from './_lib/state.js';
import { readSession, json } from './_lib/auth.js';

export async function onRequestPost({ request, env }) {
  try {
    const user = await readSession(request, env);

    if (!user) {
      return json({ error: 'Not authenticated.' }, 401);
    }

    const body = await request.json();
    const incomingState = body?.state;
    const expectedVersion = Number(body?.version || 1);

    if (!incomingState || typeof incomingState !== 'object') {
      return json({ error: 'Invalid state.' }, 400);
    }

    const row = await env.DB
      .prepare('SELECT version FROM app_state WHERE id=1')
      .first();

    const currentVersion = Number(row?.version || 1);

    if (currentVersion !== expectedVersion) {
      return json({
        error: 'DATA_CONFLICT',
        version: currentVersion
      }, 409);
    }

    const saved = await saveState(env, incomingState);

    const updated = await env.DB
      .prepare('SELECT version FROM app_state WHERE id=1')
      .first();

    return json({
      ok: true,
      state: saved,
      version: Number(updated?.version || currentVersion + 1)
    });
  } catch (e) {
    return json({
      error: e.message || 'State save failed.'
    }, 500);
  }
}
