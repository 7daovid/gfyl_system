/**
 * POST /api/records/delete
 * 学生删除自己的填报（仅提交后 10 分钟内；默认已通过、管理员未调整工时的记录可撤回）
 * body: { id }
 */
import { ok, readJson, toInt, ApiError, envInt, minutesText, clientIp } from '../../_lib/util.js';
import { requireStudent } from '../../_lib/auth.js';
import { writeLog, ACTION } from '../../_lib/log.js';

export async function onRequestPost(context) {
  const env = context.env;
  const user = await requireStudent(context.request, env);

  const body = await readJson(context.request);
  const id = toInt(body.id, 0);
  if (!id) throw new ApiError('缺少记录 id', 400);

  const rec = await env.DB.prepare('SELECT * FROM records WHERE id = ?').bind(id).first();
  if (!rec) throw new ApiError('记录不存在', 404);
  if (rec.student_no !== user.studentNo) throw new ApiError('无权操作他人的记录', 403);
  if (rec.status === 'approved' && rec.approved_minutes !== null && rec.approved_minutes !== undefined
      && toInt(rec.approved_minutes, 0) !== toInt(rec.minutes, 0)) {
    throw new ApiError('该记录已被管理员调整过工时，如需删除请联系管理员', 400);
  }

  const win = envInt(env, 'EDIT_WINDOW_MINUTES', 10);
  if (Date.now() - toInt(rec.created_ms, 0) > win * 60000) {
    throw new ApiError('已超过 ' + win + ' 分钟撤回时限，请联系管理员处理', 400);
  }

  await env.DB.prepare("DELETE FROM records WHERE id = ? AND student_no = ? AND status IN ('pending','approved')")
    .bind(id, user.studentNo).run();

  // 记录被删了，但操作日志永久留存
  await writeLog(env, {
    operator: rec.student_name + '(' + rec.student_no + ')',
    role: 'student',
    action: ACTION.RECORD_DELETE,
    targetType: 'record',
    targetId: id,
    oldValue: rec.work_date + ' / ' + rec.work_type_name + ' / ' + minutesText(rec.minutes) + (rec.remark ? ' / 备注:' + rec.remark : ''),
    newValue: '(已删除)',
    reason: '学生在' + win + '分钟内自助撤回',
    ip: clientIp(context.request)
  });

  return ok({ id: id });
}
