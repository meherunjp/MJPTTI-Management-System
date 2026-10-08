import { loadState, saveState } from './_lib/state.js';
import { readSession, json, hashPassword } from './_lib/auth.js';

function batchNumber(batch) {
  const text = String(batch || '').trim();
  const match = text.match(/(\d+)/);
  return match ? String(Number(match[1])).padStart(2, '0') : '00';
}

function generateStudentId(state, batch) {
  const b = batchNumber(batch);
  const prefix = `MJPTTI-B${b}-`;

  let max = 0;

  for (const s of state.students || []) {
    const id = String(s?.id || '');

    if (id.startsWith(prefix)) {
      const match = id.match(
        new RegExp(`^MJPTTI-B${b}-(\\d+)$`)
      );

      if (match) {
        max = Math.max(max, Number(match[1]) || 0);
      }
    }
  }

  return `${prefix}${String(max + 1).padStart(3, '0')}`;
}

function generateStudentPassword(phone) {
  const digits = String(phone || '').replace(/\D/g, '');

  if (digits.length < 6) {
    return '';
  }

  return `MJ@${digits.slice(-6)}`;
}

export async function onRequestPost({ request, env }) {
  try {
    const user = await readSession(request, env);

    if (!user) {
      return json({ error: 'Not authenticated.' }, 401);
    }

    if (!env.DB) {
      return json(
        { error: 'D1 database binding DB is not configured.' },
        503
      );
    }

    const body = await request.json();
    const state = await loadState(env);

    if (!Array.isArray(state.students)) {
      state.students = [];
    }

    if (!Array.isArray(state.payments)) {
      state.payments = [];
    }

    const incoming = body?.student || body;

    if (!incoming || typeof incoming !== 'object') {
      return json(
        { error: 'Invalid student data.' },
        400
      );
    }

    const name = String(incoming.name || '').trim();
    const course = String(incoming.course || '').trim();
    const batch = String(incoming.batch || '').trim();
    const phone = String(incoming.phone || '').trim();

    if (!name) {
      return json(
        { error: 'Student name is required.' },
        400
      );
    }

    if (!course) {
      return json(
        { error: 'Course is required.' },
        400
      );
    }

    if (!batch) {
      return json(
        { error: 'Batch is required.' },
        400
      );
    }

    if (!phone) {
      return json(
        { error: 'Student phone number is required.' },
        400
      );
    }

    const cleanPhone = phone.replace(/\D/g, '');

    if (cleanPhone.length < 6) {
      return json(
        { error: 'Phone number must contain at least 6 digits.' },
        400
      );
    }

    /*
     * ================================
     * BATCH-WISE STUDENT ID
     * Example:
     * MJPTTI-B10-001
     * MJPTTI-B10-002
     * MJPTTI-B11-001
     * ================================
     */

    const studentId = generateStudentId(state, batch);

    /*
     * ================================
     * AUTOMATIC LOGIN
     * Username = Student ID
     *
     * Password = MJ@ + last 6 digits
     * Example:
     * 01712345678
     * =>
     * MJ@345678
     * ================================
     */

    const username = studentId;
    const generatedPassword =
      generateStudentPassword(cleanPhone);

    if (!generatedPassword) {
      return json(
        { error: 'Unable to generate student password.' },
        400
      );
    }

    const student = {
      ...incoming,

      id: studentId,

      username,

      password: generatedPassword,

      batchCode: `B${batchNumber(batch)}`,

      status: incoming.status || 'Active',

      phone,

      createdAt:
        incoming.createdAt ||
        new Date().toISOString().slice(0, 10)
    };

    /*
     * ================================
     * INITIAL PAYMENT
     * ================================
     */

    const initialPayment =
      Number(body?.initialPayment || 0);

    const courseFee =
      Number(student.fee || 0);

    if (initialPayment < 0) {
      return json(
        { error: 'Initial payment cannot be negative.' },
        400
      );
    }

    if (initialPayment > courseFee) {
      return json(
        { error: 'Initial payment cannot exceed course fee.' },
        400
      );
    }

    student.paid = initialPayment;

    /*
     * ================================
     * NEXT PAYMENT DATE
     * ================================
     */

    if (!student.nextPaymentDate && initialPayment > 0) {
      const admissionDate =
        student.admission ||
        new Date().toISOString().slice(0, 10);

      const d = new Date(admissionDate);

      if (!Number.isNaN(d.getTime())) {
        d.setMonth(d.getMonth() + 1);
        student.nextPaymentDate =
          d.toISOString().slice(0, 10);
      }
    }

    /*
     * ================================
     * SAVE STUDENT
     * ================================
     */

    state.students.push(student);

    /*
     * ================================
     * SAVE INITIAL PAYMENT
     * ================================
     */

    if (initialPayment > 0) {
      const receipt =
        `MJPTTI-${Date.now()}`;

      state.payments.push({
        receipt,

        receiptNumber: receipt,

        student: student.id,

        amount: initialPayment,

        date:
          student.admission ||
          new Date().toISOString().slice(0, 10),

        method: 'Initial Admission',

        installment: 1,

        nextDue:
          student.nextPaymentDate || '',

        totalCourseFee: courseFee,

        totalPaidAfter: initialPayment,

        dueAfter:
          Math.max(
            0,
            courseFee - initialPayment
          ),

        createdAt:
          new Date().toISOString()
      });
    }

    /*
     * ================================
     * SAVE TO APP STATE
     * ================================
     */

    const saved =
      await saveState(env, state);

    /*
     * ================================
     * CREATE STUDENT LOGIN ACCOUNT
     * ================================
     */

    const passwordHash =
      await hashPassword(generatedPassword);

    await env.DB.prepare(`
      INSERT INTO users
        (
          id,
          username,
          role,
          name,
          password_hash,
          active
        )
      VALUES
        (
          ?,
          ?,
          'student',
          ?,
          ?,
          1
        )
      ON CONFLICT(id) DO UPDATE SET
        username = excluded.username,
        name = excluded.name,
        password_hash = excluded.password_hash,
        active = 1,
        updated_at = CURRENT_TIMESTAMP
    `)
      .bind(
        student.id,
        username,
        name,
        passwordHash
      )
      .run();

    /*
     * ================================
     * RESPONSE
     * ================================
     */

    return json({
      ok: true,

      student,

      generatedPassword,

      credentials: {
        studentId: student.id,
        username,
        password: generatedPassword
      },

      state: saved
    });

  } catch (e) {
    return json(
      {
        error:
          e.message ||
          'Admission save failed.'
      },
      500
    );
  }
}
