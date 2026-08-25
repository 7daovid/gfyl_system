/**
 * POST /api/admin/work-types/delete
 * 已有填报引用的类型只做停用（保护历史数据），未被引用的可真删
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

  const old = await env.DB.prepare('SELECT * FROM work_types WHERE id = ?').bind(id).first();
  if (!old) throw new ApiError('类型不存在', 404);

  const used = await env.DB.prepare('SELECT COUNT(*) AS c FROM records WHERE work_type_id = ?')
    .bind(id).first();
  const usedCount = toInt(used && used.c, 0);

  let mode;
  if (usedCount > 0) {
    await env.DB.prepare('UPDATE work_types SET active = 0 WHERE id = ?').bind(id).run();
    mode = '停用（已有 ' + usedCount + ' 条历史填报引用，保留数据）';
  } else {
    await env.DB.prepare('DELETE FROM work_types WHERE id = ?').bind(id).run();
    mode = '彻底删除（无历史引用）';
  }

  await writeLog(env, {
    operator: admin.name || '管理员',
    role: 'admin',
    action: ACTION.WORKTYPE_DELETE,
    targetType: 'work_type',
    targetId: id,
    oldValue: old.name + ' / 单价 ' + Number(old.rate) + ' 元每小时',
    newValue: mode,
    reason: reason,
    ip: clientIp(context.request)
  });

  return ok({ id: id, mode: mode });
}
