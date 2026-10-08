import { loadState, saveState } from './_lib/state.js';
import { readSession, json } from './_lib/auth.js';

export async function onRequestPost({ request, env }) {
  try {
    const user = await readSession(request, env);

    if (!user) {
      return json({ error: 'Not authenticated.' }, 401);
    }

    if (user.role !== 'admin') {
      return json({ error: 'Admin access required.' }, 403);
    }

    const body = await request.json();

    const state = await loadState(env);

    if (!Array.isArray(state.students)) {
      state.students = [];
    }

    const student = body?.student || body;

    if (!student || typeof student !== 'object') {
      return json({ error: 'Invalid student data.' }, 400);
    }

    if (!student.id) {
      return json({ error: 'Student ID is required.' }, 400);
    }

    const existingIndex = state.students.findIndex(
      s => String(s.id) === String(student.id)
    );

    if (existingIndex >= 0) {
      state.students[existingIndex] = {
        ...state.students[existingIndex],
        ...student
      };
    } else {
      state.students.push(student);
    }

    const saved = await saveState(env, state);

    return json({
      ok: true,
      student,
      state: saved
    });

  } catch (e) {
    return json({
      error: e.message || 'Admission save failed.'
    }, 500);
  }
}
