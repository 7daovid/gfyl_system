/**
 * POST /api/admin/students/delete
 * 移出白名单：已有填报记录的学生只做停用（保留历史数据可追溯）
 * body: { id, reason }
 */
import { ok, readJson, toInt, clean, ApiError, clientIp } from '../../../_lib/util.js';
import { writeLog, ACTION } from '../../../_lib/log.js';

export async function onRequestPost(context) {
  const env = context.env;
  const admin = (context.data && context.data.admin) || { name: '管理员' };
  const body = await readJson(context.request);
  const id = toInt(body.id, 0);
  const reason = clean(body.reason, 200);

  if (!id) throw new ApiError('缺少 id', 400);

  const old = await env.DB.prepare('SELECT * FROM students WHERE id = ?').bind(id).first();
  if (!old) throw new ApiError('学生不存在', 404);

  const used = await env.DB.prepare('SELECT COUNT(*) AS c FROM records WHERE student_no = ?')
    .bind(old.student_no).first();
  const usedCount = toInt(used && used.c, 0);

  let mode;
  if (usedCount > 0) {
    await env.DB.prepare('UPDATE students SET active = 0 WHERE id = ?').bind(id).run();
    mode = '停用（已有 ' + usedCount + ' 条填报记录，保留历史）';
  } else {
    await env.DB.prepare('DELETE FROM students WHERE id = ?').bind(id).run();
    mode = '彻底移除（无填报记录）';
  }

  await writeLog(env, {
    operator: admin.name || '管理员',
    role: 'admin',
    action: ACTION.STUDENT_DELETE,
    targetType: 'student',
    targetId: id,
    oldValue: old.student_no + ' / ' + old.name,
    newValue: mode,
    reason: reason,
    ip: clientIp(context.request)
  });

  return ok({ id: id, mode: mode });
}
