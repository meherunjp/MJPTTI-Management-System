
import { loadState } from './_lib/state.js';
import { readSession, json } from './_lib/auth.js';

export async function onRequestGet({ request, env }) {
  try {
    // Verify the current login session
    const session = await readSession(request, env);

    if (!session) {
      return json(
        { error: 'Not authenticated.' },
        401
      );
    }

    // Load application state and database version
    const row = await env.DB
      .prepare(
        'SELECT data, version FROM app_state WHERE id = 1'
      )
      .first();

    if (!row) {
      return json(
        { error: 'Application state not found.' },
        500
      );
    }

    const state = await loadState(env);

    // Normalize session fields for the frontend
    const user = {
      id: session.id || session.sub || session.username || '',
      username: session.username || '',
      role: session.role || '',
      name: session.name || ''
    };

    // Return authenticated user and application data
    return json({
      ok: true,
      state,
      user,
      version: Number(row.version || 1)
    });

  } catch (error) {
    return json(
      {
        error: error?.message || 'Bootstrap failed.'
      },
      500
    );
  }
}
