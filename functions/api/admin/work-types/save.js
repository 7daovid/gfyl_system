/**
 * POST /api/admin/work-types/save
 * 新增 / 修改工作类型与小时单价
 * body: { id?, name, rate, sort_no?, active? }
 */
import { ok, readJson, clean, toInt, toFloat, ApiError, bjTime, money, clientIp } from '../../../_lib/util.js';
import { writeLog, ACTION } from '../../../_lib/log.js';

export async function onRequestPost(context) {
  const env = context.env;
  const admin = (context.data && context.data.admin) || { name: '管理员' };
  const body = await readJson(context.request);

  const id = toInt(body.id, 0);
  const name = clean(body.name, 40);
  const rate = money(toFloat(body.rate, 0));
  const sortNo = toInt(body.sort_no, 0);
  const active = toInt(body.active, 1) === 1 ? 1 : 0;

  if (!name) throw new ApiError('请填写类型名称', 400);
  if (rate < 0 || rate > 10000) throw new ApiError('单价需在 0 ~ 10000 元/小时之间', 400);

  const now = Date.now();
  const nowText = bjTime(now);

  if (id) {
    const old = await env.DB.prepare('SELECT * FROM work_types WHERE id = ?').bind(id).first();
    if (!old) throw new ApiError('类型不存在', 404);

    const dupName = await env.DB.prepare('SELECT id FROM work_types WHERE name = ? AND id <> ?')
      .bind(name, id).first();
    if (dupName) throw new ApiError('已存在同名工作类型', 409);

    await env.DB.prepare('UPDATE work_types SET name = ?, rate = ?, sort_no = ?, active = ? WHERE id = ?')
      .bind(name, rate, sortNo, active, id).run();

    // 类型改名后同步历史记录里的冗余名称（不影响原始时长）
    if (old.name !== name) {
      await env.DB.prepare('UPDATE records SET work_type_name = ? WHERE work_type_id = ?')
        .bind(name, id).run();
    }

    await writeLog(env, {
      operator: admin.name || '管理员',
      role: 'admin',
      action: ACTION.WORKTYPE_UPDATE,
      targetType: 'work_type',
      targetId: id,
      oldValue: old.name + ' / 单价 ' + Number(old.rate) + ' 元每小时 / ' + (Number(old.active) === 1 ? '启用' : '停用'),
      newValue: name + ' / 单价 ' + rate + ' 元每小时 / ' + (active === 1 ? '启用' : '停用'),
      reason: clean(body.reason, 200),
      ip: clientIp(context.request)
    });

    return ok({ id: id });
  }

  const dup = await env.DB.prepare('SELECT id FROM work_types WHERE name = ?').bind(name).first();
  if (dup) throw new ApiError('已存在同名工作类型', 409);

  const res = await env.DB.prepare(
    'INSERT INTO work_types (name, rate, sort_no, active, created_ms, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(name, rate, sortNo, active, now, nowText).run();

  const newId = (res.meta && res.meta.last_row_id) ? res.meta.last_row_id : 0;

  await writeLog(env, {
    operator: admin.name || '管理员',
    role: 'admin',
    action: ACTION.WORKTYPE_CREATE,
    targetType: 'work_type',
    targetId: newId,
    oldValue: '',
    newValue: name + ' / 单价 ' + rate + ' 元每小时',
    reason: clean(body.reason, 200),
    ip: clientIp(context.request)
  });

  return ok({ id: newId });
}
