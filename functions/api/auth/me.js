/**
 * GET /api/auth/me
 * 返回当前登录身份；学生会再校验一次白名单状态
 */
import { ok } from '../../_lib/util.js';
import { currentUser } from '../../_lib/auth.js';

export async function onRequestGet(context) {
  const u = await currentUser(context.request, context.env);
  if (!u) return ok({ logged_in: false });

  if (u.role === 'student') {
    const row = await context.env.DB
      .prepare('SELECT name, dept, active FROM students WHERE student_no = ?')
      .bind(u.studentNo)
      .first();
    if (!row || Number(row.active) !== 1) return ok({ logged_in: false, reason: '学号已不在名单内' });
    return ok({
      logged_in: true,
      role: 'student',
      student_no: u.studentNo,
      name: row.name,
      dept: row.dept || ''
    });
  }

  return ok({ logged_in: true, role: 'admin', name: u.name || '管理员' });
}
