/**
 * POST /api/admin/students/save
 * 单条新增 / 修改白名单
 * body: { id?, student_no, name, dept, active }
 */
import { ok, readJson, clean, toInt, ApiError, bjTime, clientIp } from '../../../_lib/util.js';
import { writeLog, ACTION } from '../../../_lib/log.js';

export async function onRequestPost(context) {
  const env = context.env;
  const admin = (context.data && context.data.admin) || { name: '管理员' };
  const body = await readJson(context.request);

  const id = toInt(body.id, 0);
  const no = clean(body.student_no, 40);
  const name = clean(body.name, 40);
  const dept = clean(body.dept, 60);
  const active = toInt(body.active, 1) === 1 ? 1 : 0;

  if (!/^[A-Za-z0-9_-]{4,40}$/.test(no)) throw new ApiError('学号格式不正确（4-40 位字母数字）', 400);
  if (!name) throw new ApiError('请填写姓名', 400);

  const now = Date.now();

  if (id) {
    const old = await env.DB.prepare('SELECT * FROM students WHERE id = ?').bind(id).first();
    if (!old) throw new ApiError('学生不存在', 404);

    const dup = await env.DB.prepare('SELECT id FROM students WHERE student_no = ? AND id <> ?')
      .bind(no, id).first();
    if (dup) throw new ApiError('该学号已存在', 409);

    await env.DB.prepare('UPDATE students SET student_no = ?, name = ?, dept = ?, active = ? WHERE id = ?')
      .bind(no, name, dept, active, id).run();

    if (old.student_no !== no || old.name !== name) {
      await env.DB.prepare('UPDATE records SET student_no = ?, student_name = ? WHERE student_no = ?')
        .bind(no, name, old.student_no).run();
    }

    await writeLog(env, {
      operator: admin.name || '管理员',
      role: 'admin',
      action: ACTION.STUDENT_UPDATE,
      targetType: 'student',
      targetId: id,
      oldValue: old.student_no + ' / ' + old.name + ' / ' + (old.dept || '-') + ' / ' + (Number(old.active) === 1 ? '启用' : '停用'),
      newValue: no + ' / ' + name + ' / ' + (dept || '-') + ' / ' + (active === 1 ? '启用' : '停用'),
      reason: clean(body.reason, 200),
      ip: clientIp(context.request)
    });

    return ok({ id: id });
  }

  const dup = await env.DB.prepare('SELECT id FROM students WHERE student_no = ?').bind(no).first();
  if (dup) throw new ApiError('该学号已在名单中', 409);

  const res = await env.DB.prepare(
    'INSERT INTO students (student_no, name, dept, active, created_ms, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(no, name, dept, active, now, bjTime(now)).run();

  const newId = (res.meta && res.meta.last_row_id) ? res.meta.last_row_id : 0;

  await writeLog(env, {
    operator: admin.name || '管理员',
    role: 'admin',
    action: ACTION.STUDENT_UPDATE,
    targetType: 'student',
    targetId: newId,
    oldValue: '',
    newValue: '新增白名单 ' + no + ' / ' + name,
    reason: clean(body.reason, 200),
    ip: clientIp(context.request)
  });

  return ok({ id: newId });
}
