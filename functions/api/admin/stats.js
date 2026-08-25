/**
 * GET /api/admin/stats?from&to&page&size&keyword
 * 薪资统计（按学生汇总，自动计算工资）—— 管理员专属
 */
import { ok, pageParams, clean, toInt, money, minutesToHours, minutesText, bjDate, bjDateOffset } from '../../_lib/util.js';

function bindAll(stmt, args) {
  return args && args.length ? stmt.bind.apply(stmt, args) : stmt;
}

export async function onRequestGet(context) {
  const env = context.env;
  const url = new URL(context.request.url);
  const pg = pageParams(url, 20, 100);

  let from = clean(url.searchParams.get('from'), 10);
  let to = clean(url.searchParams.get('to'), 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) from = bjDateOffset(-30);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(to)) to = bjDate();
  const keyword = clean(url.searchParams.get('keyword'), 40);

  const where = ["r.status = 'approved'", 'r.work_date >= ?', 'r.work_date <= ?'];
  const args = [from, to];
  if (keyword) {
    where.push('(r.student_name LIKE ? OR r.student_no LIKE ?)');
    args.push('%' + keyword + '%', '%' + keyword + '%');
  }
  const whereSql = 'WHERE ' + where.join(' AND ');

  const groupSql =
    'FROM records r LEFT JOIN work_types w ON w.id = r.work_type_id ' + whereSql +
    ' GROUP BY r.student_no, r.student_name';

  const cnt = await bindAll(
    env.DB.prepare('SELECT COUNT(*) AS c FROM (SELECT r.student_no ' + groupSql + ')'),
    args
  ).first();

  const rs = await bindAll(
    env.DB.prepare(
      'SELECT r.student_no, r.student_name, ' +
      '  COUNT(*) AS cnt, ' +
      '  SUM(r.minutes) AS raw_min, ' +
      '  SUM(COALESCE(r.approved_minutes, r.minutes)) AS acc_min, ' +
      '  SUM(COALESCE(r.approved_minutes, r.minutes) * COALESCE(w.rate, 0) / 60.0) AS wage ' +
      groupSql +
      ' ORDER BY wage DESC, r.student_no ASC LIMIT ? OFFSET ?'
    ),
    args.concat([pg.size, pg.offset])
  ).all();

  const list = (rs.results || []).map(function (r) {
    return {
      student_no: r.student_no,
      student_name: r.student_name,
      count: toInt(r.cnt, 0),
      raw_minutes: toInt(r.raw_min, 0),
      raw_hours: minutesToHours(r.raw_min),
      acc_minutes: toInt(r.acc_min, 0),
      acc_hours: minutesToHours(r.acc_min),
      acc_text: minutesText(r.acc_min),
      wage: money(r.wage)
    };
  });

  // 全量合计（不受分页影响）
  const totalRow = await bindAll(
    env.DB.prepare(
      'SELECT COUNT(*) AS cnt, SUM(r.minutes) AS raw_min, ' +
      ' SUM(COALESCE(r.approved_minutes, r.minutes)) AS acc_min, ' +
      ' SUM(COALESCE(r.approved_minutes, r.minutes) * COALESCE(w.rate, 0) / 60.0) AS wage, ' +
      ' COUNT(DISTINCT r.student_no) AS stu_cnt ' +
      'FROM records r LEFT JOIN work_types w ON w.id = r.work_type_id ' + whereSql
    ),
    args
  ).first();

  // 按工作类型汇总
  const byType = await bindAll(
    env.DB.prepare(
      'SELECT r.work_type_name AS name, COALESCE(w.rate,0) AS rate, COUNT(*) AS cnt, ' +
      ' SUM(COALESCE(r.approved_minutes, r.minutes)) AS acc_min, ' +
      ' SUM(COALESCE(r.approved_minutes, r.minutes) * COALESCE(w.rate,0) / 60.0) AS wage ' +
      'FROM records r LEFT JOIN work_types w ON w.id = r.work_type_id ' + whereSql +
      ' GROUP BY r.work_type_name, w.rate ORDER BY wage DESC'
    ),
    args
  ).all();

  const adjusted = await env.DB.prepare(
    "SELECT COUNT(*) AS c FROM records WHERE status = 'approved' AND approved_minutes IS NOT NULL AND approved_minutes <> minutes AND work_date >= ? AND work_date <= ?"
  ).bind(from, to).first();

  return ok({
    from: from,
    to: to,
    list: list,
    page: pg.page,
    size: pg.size,
    total: toInt(cnt && cnt.c, 0),
    summary: {
      students: toInt(totalRow && totalRow.stu_cnt, 0),
      records: toInt(totalRow && totalRow.cnt, 0),
      raw_hours: minutesToHours(totalRow && totalRow.raw_min),
      acc_hours: minutesToHours(totalRow && totalRow.acc_min),
      wage: money(totalRow && totalRow.wage),
      adjusted: toInt(adjusted && adjusted.c, 0)
    },
    by_type: (byType.results || []).map(function (r) {
      return {
        name: r.name,
        rate: Number(r.rate) || 0,
        count: toInt(r.cnt, 0),
        acc_hours: minutesToHours(r.acc_min),
        wage: money(r.wage)
      };
    })
  });
}
