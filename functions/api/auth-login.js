import {
  hashPassword,
  verifyPassword,
  createSession,
  sessionCookie,
  json
} from './_lib/auth.js';

import { loadState } from './_lib/state.js';


// ============================================================
// CREATE / SYNC USERS
// ============================================================

async function ensureSeedUsers(env, state) {

  // ==========================================================
  // ADMIN USER
  // ==========================================================

  const adminPassword =
    env.MJPTTI_ADMIN_PASSWORD || '';

  if (adminPassword) {

    const adminUser =
      String(
        state.settings?.adminUsername || 'admin'
      ).trim() || 'admin';

    const exists =
      await env.DB
        .prepare(
          "SELECT id FROM users WHERE role='admin' LIMIT 1"
        )
        .first();

    if (!exists) {

      await env.DB
        .prepare(`
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
              'admin',
              ?,
              ?,
              1
            )
          ON CONFLICT(id) DO NOTHING
        `)
        .bind(
          'ADMIN',
          adminUser,
          'Administrator',
          await hashPassword(adminPassword)
        )
        .run();
    }
  }


  // ==========================================================
  // TRAINER USERS
  // ==========================================================

  const trainerPassword =
    env.MJPTTI_INITIAL_TRAINER_PASSWORD || '';

  if (trainerPassword) {

    for (const t of state.teachers || []) {

      if (!t?.id) continue;

      const trainerId =
        String(t.id).trim();

      const exists =
        await env.DB
          .prepare(
            "SELECT id FROM users WHERE id=? AND role='trainer' LIMIT 1"
          )
          .bind(trainerId)
          .first();

      if (!exists) {

        await env.DB
          .prepare(`
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
                'trainer',
                ?,
                ?,
                1
              )
            ON CONFLICT(id) DO NOTHING
          `)
          .bind(
            trainerId,
            trainerId,
            String(t.name || trainerId),
            await hashPassword(trainerPassword)
          )
          .run();
      }
    }
  }


  // ==========================================================
  // STUDENT USERS
  //
  // Student ID:
  // MJPTTI-B09-001
  //
  // Student Username:
  // MJPTTI-B09-001
  //
  // Student Password:
  // MJ@ + phone last 6 digits
  //
  // Example:
  // 018985987548
  // Password = MJ@987548
  // ==========================================================

  for (const s of state.students || []) {

    if (!s?.id) continue;

    const studentId =
      String(s.id).trim();

    const username =
      String(
        s.username || studentId
      ).trim();

    const phone =
      String(
        s.phone || ''
      ).replace(/\D/g, '');

    // Phone number must have at least 6 digits
    if (phone.length < 6) continue;

    // Generate password automatically
    const studentPassword =
      `MJ@${phone.slice(-6)}`;

    // Hash password
    const passwordHash =
      await hashPassword(
        studentPassword
      );

    // ========================================================
    // CREATE OR UPDATE STUDENT ACCOUNT
    // ========================================================

    await env.DB
      .prepare(`
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
          username=excluded.username,
          name=excluded.name,
          password_hash=excluded.password_hash,
          active=1,
          updated_at=CURRENT_TIMESTAMP
      `)
      .bind(
        studentId,
        username,
        String(
          s.name || studentId
        ),
        passwordHash
      )
      .run();
  }
}


// ============================================================
// RECONCILE NORMALIZED DATA
// ============================================================

async function reconcileNormalized(
  env,
  state
) {

  const students =
    Array.isArray(state.students)
      ? state.students
      : [];

  const payments =
    Array.isArray(state.payments)
      ? state.payments
      : [];

  const studentIds =
    new Set();


  // ==========================================================
  // STUDENTS TABLE
  // ==========================================================

  for (
    let i = 0;
    i < students.length;
    i += 50
  ) {

    const rows =
      students
        .slice(i, i + 50)
        .filter(
          s => s?.id
        )
        .map(s => {

          studentIds.add(
            String(s.id)
          );

          return env.DB
            .prepare(`
              INSERT INTO students
                (
                  id,
                  name,
                  namebn,
                  course,
                  batch,
                  dob,
                  phone,
                  photo,
                  status
                )
              VALUES
                (?, ?, ?, ?, ?, ?, ?, ?, ?)

              ON CONFLICT(id) DO UPDATE SET
                name=excluded.name,
                namebn=excluded.namebn,
                course=excluded.course,
                batch=excluded.batch,
                dob=excluded.dob,
                phone=excluded.phone,
                photo=excluded.photo,
                status=excluded.status,
                updated_at=CURRENT_TIMESTAMP
            `)
            .bind(
              String(s.id),
              String(s.name || ''),
              String(s.namebn || ''),
              String(s.course || ''),
              String(s.batch || ''),
              String(s.dob || ''),
              String(s.phone || ''),
              String(s.photo || ''),
              String(s.status || 'Active')
            );
        });

    if (rows.length) {
      await env.DB.batch(rows);
    }
  }


  // ==========================================================
  // PAYMENTS TABLE
  // ==========================================================

  for (
    let i = 0;
    i < payments.length;
    i += 50
  ) {

    const rows =
      payments
        .slice(i, i + 50)
        .filter(
          p =>
            p &&
            (
              p.receipt ||
              p.receiptNumber
            ) &&
            studentIds.has(
              String(
                p.student ||
                p.student_id ||
                ''
              )
            ) &&
            Number(
              p.amount || 0
            ) > 0
        )
        .map(p =>
          env.DB
            .prepare(`
              INSERT INTO payments
                (
                  receipt,
                  student_id,
                  amount,
                  date,
                  method,
                  reference,
                  note,
                  installment,
                  next_due,
                  created_at
                )
              VALUES
                (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)

              ON CONFLICT(receipt) DO UPDATE SET
                student_id=excluded.student_id,
                amount=excluded.amount,
                date=excluded.date,
                method=excluded.method,
                reference=excluded.reference,
                note=excluded.note,
                installment=excluded.installment,
                next_due=excluded.next_due
            `)
            .bind(
              String(
                p.receipt ||
                p.receiptNumber
              ),
              String(
                p.student ||
                p.student_id
              ),
              Number(
                p.amount || 0
              ),
              String(
                p.date ||
                new Date()
                  .toISOString()
                  .slice(0, 10)
              ),
              String(
                p.method || 'Cash'
              ),
              String(
                p.reference || ''
              ),
              String(
                p.note || ''
              ),
              Number(
                p.installment || 1
              ),
              p.nextDue || null,
              p.createdAt ||
                new Date().toISOString()
            )
        );

    if (rows.length) {
      await env.DB.batch(rows);
    }
  }
}


// ============================================================
// LOGIN API
// ============================================================

export async function onRequestPost({
  request,
  env
}) {

  // ==========================================================
  // CHECK D1
  // ==========================================================

  if (!env.DB) {

    return json(
      {
        error:
          'D1 database binding DB is not configured.'
      },
      503
    );
  }


  // ==========================================================
  // CHECK AUTH SECRET
  // ==========================================================

  if (!env.MJPTTI_AUTH_SECRET) {

    return json(
      {
        error:
          'MJPTTI_AUTH_SECRET is not configured.'
      },
      503
    );
  }


  // ==========================================================
  // READ REQUEST
  // ==========================================================

  let body;

  try {

    body =
      await request.json();

  } catch {

    return json(
      {
        error:
          'Invalid JSON.'
      },
      400
    );
  }


  // ==========================================================
  // LOGIN DATA
  // ==========================================================

  const username =
    String(
      body?.username || ''
    ).trim();

  const password =
    String(
      body?.password || ''
    );

  const role =
    String(
      body?.role || ''
    );


  // ==========================================================
  // VALIDATE
  // ==========================================================

  if (
    !username ||
    !password ||
    ![
      'admin',
      'trainer',
      'student'
    ].includes(role)
  ) {

    return json(
      {
        error:
          'Invalid login request.'
      },
      400
    );
  }


  // ==========================================================
  // LOAD STATE
  // ==========================================================

  const state =
    await loadState(env);


  // ==========================================================
  // CREATE / UPDATE USERS
  // ==========================================================

  await ensureSeedUsers(
    env,
    state
  );


  // ==========================================================
  // SYNC NORMALIZED DATA
  // ==========================================================

  if (role === 'admin') {

    await reconcileNormalized(
      env,
      state
    );
  }


  // ==========================================================
  // FIND USER
  // ==========================================================

  const user =
    await env.DB
      .prepare(`
        SELECT
          id,
          username,
          role,
          name,
          password_hash,
          active
        FROM users
        WHERE username=?
          AND role=?
        LIMIT 1
      `)
      .bind(
        username,
        role
      )
      .first();


  // ==========================================================
  // VERIFY LOGIN
  // ==========================================================

  if (
    !user ||
    !user.active ||
    !(
      await verifyPassword(
        password,
        user.password_hash
      )
    )
  ) {

    return json(
      {
        error:
          'Login তথ্য সঠিক নয়।'
      },
      401
    );
  }


  // ==========================================================
  // CREATE SESSION
  // ==========================================================

  const token =
    await createSession(
      user,
      env.MJPTTI_AUTH_SECRET
    );


  // ==========================================================
  // SUCCESS
  // ==========================================================

  return new Response(
    JSON.stringify({

      ok: true,

      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        name: user.name
      }

    }),
    {
      status: 200,

      headers: {

        'content-type':
          'application/json; charset=utf-8',

        'cache-control':
          'no-store',

        'Set-Cookie':
          sessionCookie(token)
      }
    }
  );
}
