/**
 * GET /api/admin/logs?page&size&keyword&action&target_type&from&to
 * 完整操作日志（只读，不提供任何删除/修改接口，数据库触发器也已封死）
 */
import { ok, pageParams, clean, toInt } from '../../_lib/util.js';

function bindAll(stmt, args) {
  return args && args.length ? stmt.bind.apply(stmt, args) : stmt;
}

export async function onRequestGet(context) {
  const env = context.env;
  const url = new URL(context.request.url);
  const pg = pageParams(url, 20, 100);

  const keyword = clean(url.searchParams.get('keyword'), 60);
  const action = clean(url.searchParams.get('action'), 40);
  const targetType = clean(url.searchParams.get('target_type'), 20);
  const from = clean(url.searchParams.get('from'), 10);
  const to = clean(url.searchParams.get('to'), 10);

  const where = [];
  const args = [];

  if (keyword) {
    where.push('(operator LIKE ? OR action LIKE ? OR target_id LIKE ? OR old_value LIKE ? OR new_value LIKE ? OR reason LIKE ?)');
    const k = '%' + keyword + '%';
    args.push(k, k, k, k, k, k);
  }
  if (action) { where.push('action = ?'); args.push(action); }
  if (targetType) { where.push('target_type = ?'); args.push(targetType); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(from)) { where.push('ts >= ?'); args.push(from + ' 00:00:00'); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(to)) { where.push('ts <= ?'); args.push(to + ' 23:59:59'); }

  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const cnt = await bindAll(env.DB.prepare('SELECT COUNT(*) AS c FROM audit_logs ' + whereSql), args).first();

  const rs = await bindAll(
    env.DB.prepare(
      'SELECT id, ts, operator, operator_role, action, target_type, target_id, old_value, new_value, reason, ip ' +
      'FROM audit_logs ' + whereSql + ' ORDER BY id DESC LIMIT ? OFFSET ?'
    ),
    args.concat([pg.size, pg.offset])
  ).all();

  const actions = await env.DB.prepare(
    'SELECT action, COUNT(*) AS c FROM audit_logs GROUP BY action ORDER BY c DESC LIMIT 30'
  ).all();

  return ok({
    list: rs.results || [],
    page: pg.page,
    size: pg.size,
    total: toInt(cnt && cnt.c, 0),
    actions: (actions.results || []).map(function (r) { return { action: r.action, count: toInt(r.c, 0) }; })
  });
}
