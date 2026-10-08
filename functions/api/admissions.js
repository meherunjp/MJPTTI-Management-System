import { loadState, saveState } from './_lib/state.js';
import { readSession, json } from './_lib/auth.js';

export async function onRequestPost({ request, env }) {
  try {
    const user = await readSession(request, env);

    if (!user) {
      return json({ error: 'Not authenticated.' }, 401);
    }

    const body = await request.json();
    const state = await loadState(env);

    if (!Array.isArray(state.students)) {
      state.students = [];
    }

    const incoming = body?.student || body;

    if (!incoming || typeof incoming !== 'object') {
      return json({ error: 'Invalid student data.' }, 400);
    }

    // Frontend may send the student ID under different names.
    const studentId =
      incoming.id ||
      incoming.studentId ||
      incoming.student_id ||
      incoming.sid ||
      null;

    const student = {
      ...incoming,
      id: studentId || `ST-${Date.now()}`
    };

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
