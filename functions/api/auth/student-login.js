/**
 * POST /api/auth/student-login
 * 学生登录：仅输入学号，学号必须在白名单内
 * body: { student_no }
 */
import { ok, readJson, clean, ApiError } from '../../_lib/util.js';
import { signToken, studentTtl } from '../../_lib/auth.js';

export async function onRequestPost(context) {
  const env = context.env;
  const body = await readJson(context.request);
  const no = clean(body.student_no, 40);

  if (!no) throw new ApiError('请输入学号', 400);
  if (!/^[A-Za-z0-9_-]{4,40}$/.test(no)) throw new ApiError('学号格式不正确', 400);

  const row = await env.DB
    .prepare('SELECT student_no, name, dept, active FROM students WHERE student_no = ?')
    .bind(no)
    .first();

  if (!row) throw new ApiError('该学号不在勤工助学名单内，无法登录', 403);
  if (Number(row.active) !== 1) throw new ApiError('该学号已被停用，请联系管理员', 403);

  const token = await signToken(env, { r: 'student', s: row.student_no, n: row.name }, studentTtl());

  return ok({
    token: token,
    role: 'student',
    student_no: row.student_no,
    name: row.name,
    dept: row.dept || ''
  });
}
