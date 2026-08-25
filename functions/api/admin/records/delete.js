/**
 * POST /api/admin/records/delete
 * 管理员移除一条填报记录（硬删除，但操作日志永久留存）
 * body: { id, reason }
 */
import { ok, readJson, toInt, ApiError, clientIp, minutesText, clean } from '../../../_lib/util.js';
import { writeLog, ACTION } from '../../../_lib/log.js';

export async function onRequestPost(context) {
  const env = context.env;
  const admin = (context.data && context.data.admin) || { name: '管理员' };
  const body = await readJson(context.request);

  const id = toInt(body.id, 0);
  const reason = clean(body.reason, 300);
  if (!id) throw new ApiError('缺少记录 id', 400);
  if (!reason) throw new ApiError('移除记录必须填写理由（将写入不可删除的操作日志）', 400);

  const rec = await env.DB.prepare('SELECT * FROM records WHERE id = ?').bind(id).first();
  if (!rec) throw new ApiError('记录不存在', 404);

  const oldDesc = rec.work_date + ' ' + (rec.start_time || '') + '-' + (rec.end_time || '') +
    ' / ' + rec.work_type_name + ' / ' + minutesText(rec.minutes) +
    (rec.remark ? ' / 备注:' + rec.remark : '');

  await env.DB.prepare('DELETE FROM records WHERE id = ?').bind(id).run();

  await writeLog(env, {
    operator: admin.name || '管理员',
    role: 'admin',
    action: ACTION.RECORD_ADMIN_DELETE,
    targetType: 'record',
    targetId: id,
    oldValue: oldDesc,
    newValue: '(已移除该记录)',
    reason: reason,
    ip: clientIp(context.request)
  });

  return ok({ id: id, removed: true });
}
