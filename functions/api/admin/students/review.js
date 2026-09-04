/**
 * POST /api/admin/students/review
 * 老师审核学生注册申请
 * body: { id, action: 'approve' | 'reject', reason? }
 *
 *   approve → reg_status = 'approved'，学生即可登录
 *   reject  → reg_status = 'rejected'，学生登录被拒绝
 *
 * 操作均写入不可删除的操作日志。
 */
import { ok, readJson, toInt, clean, ApiError, bjTime, clientIp } from '../../../_lib/util.js';
import { writeLog, ACTION } from '../../../_lib/log.js';

export async function onRequestPost(context) {
  const env = context.env;
  const admin = (context.data && context.data.admin) || { name: '管理员' };
  const body = await readJson(context.request);

  const id = toInt(body.id, 0);
  const action = clean(body.action, 12);
  const reason = clean(body.reason, 300);

  if (!id) throw new ApiError('缺少记录 id', 400);
  if (action !== 'approve' && action !== 'reject') throw new ApiError('不支持的操作', 400);

  const stu = await env.DB.prepare('SELECT * FROM students WHERE id = ?').bind(id).first();
  if (!stu) throw new ApiError('学生不存在', 404);
  if (stu.reg_status !== 'pending') throw new ApiError('该申请已处理过，无需重复操作', 400);

  const now = Date.now();
  const nowText = bjTime(now);

  if (action === 'approve') {
    await env.DB.prepare("UPDATE students SET reg_status = 'approved', active = 1 WHERE id = ?").bind(id).run();
  } else {
    await env.DB.prepare("UPDATE students SET reg_status = 'rejected', active = 0 WHERE id = ?").bind(id).run();
  }

  await writeLog(env, {
    operator: admin.name || '管理员',
    role: 'admin',
    action: action === 'approve' ? ACTION.STUDENT_APPROVE : ACTION.STUDENT_REJECT,
    targetType: 'student',
    targetId: id,
    oldValue: '学号 ' + stu.student_no + ' / 姓名 ' + stu.name + ' / 电话 ' + (stu.phone || '-') + ' / 待审核',
    newValue: action === 'approve' ? '审核通过，可登录填报' : '审核拒绝，不可登录',
    reason: reason || '注册资料审核通过',
    ip: clientIp(context.request)
  });

  return ok({ id: id, status: action === 'approve' ? 'approved' : 'rejected' });
}
