/**
 * GET /api/admin/records/list?page&size&status&from&to&keyword&type_id
 * 管理员审核列表（含核算工时、单价、金额 —— 管理员专属）
 */
import { ok, pageParams, clean, toInt, toFloat, money, minutesText, minutesToHours, STATUS_TEXT } from '../../../_lib/util.js';

function bindAll(stmt, args) {
  return args && args.length ? stmt.bind.apply(stmt, args) : stmt;
}

export async function onRequestGet(context) {
  const env = context.env;
  const url = new URL(context.request.url);
  const pg = pageParams(url, 20, 100);

  // 读取小星星单价（每颗价值，元）
  const starRow = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind('star_rate').first();
  const starRate = money(toFloat(starRow && starRow.value, 15));

  const status = clean(url.searchParams.get('status'), 12);
  const from = clean(url.searchParams.get('from'), 10);
  const to = clean(url.searchParams.get('to'), 10);
  const keyword = clean(url.searchParams.get('keyword'), 40);
  const typeId = toInt(url.searchParams.get('type_id'), 0);

  const where = [];
  const args = [];

  if (['pending', 'approved', 'merged'].indexOf(status) >= 0) {
    where.push('r.status = ?');
    args.push(status);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(from)) { where.push('r.work_date >= ?'); args.push(from); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(to)) { where.push('r.work_date <= ?'); args.push(to); }
  if (typeId) { where.push('r.work_type_id = ?'); args.push(typeId); }
  if (keyword) {
    where.push('(r.student_name LIKE ? OR r.student_no LIKE ? OR r.remark LIKE ?)');
    args.push('%' + keyword + '%', '%' + keyword + '%', '%' + keyword + '%');
  }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const cnt = await bindAll(env.DB.prepare('SELECT COUNT(*) AS c FROM records r ' + whereSql), args).first();

  const rs = await bindAll(
    env.DB.prepare(
      'SELECT r.*, w.rate AS rate FROM records r ' +
      'LEFT JOIN work_types w ON w.id = r.work_type_id ' +
      whereSql +
      ' ORDER BY r.work_date DESC, r.student_no ASC, r.id ASC LIMIT ? OFFSET ?'
    ),
    args.concat([pg.size, pg.offset])
  ).all();

  const list = (rs.results || []).map(function (r) {
    const accMin = (r.approved_minutes === null || r.approved_minutes === undefined)
      ? toInt(r.minutes, 0) : toInt(r.approved_minutes, 0);
    const rate = Number(r.rate) || 0;
    return {
      id: r.id,
      student_no: r.student_no,
      student_name: r.student_name,
      work_date: r.work_date,
      start_time: r.start_time || '',
      end_time: r.end_time || '',
      time_range: (r.start_time && r.end_time) ? (r.start_time + ' - ' + r.end_time) : '',
      minutes: toInt(r.minutes, 0),
      minutes_text: minutesText(r.minutes),
      hours: minutesToHours(r.minutes),
      work_type_id: r.work_type_id,
      work_type_name: r.work_type_name,
      remark: r.remark || '',
      status: r.status,
      status_text: STATUS_TEXT[r.status] || r.status,
      approved_minutes: r.approved_minutes === null || r.approved_minutes === undefined ? null : toInt(r.approved_minutes, 0),
      acc_minutes: accMin,
      acc_hours: minutesToHours(accMin),
      adjusted: r.approved_minutes !== null && r.approved_minutes !== undefined && toInt(r.approved_minutes, 0) !== toInt(r.minutes, 0),
      rate: rate,
      amount: r.status === 'approved' ? money(accMin / 60 * rate) : 0,
      stars: toInt(r.stars, 0),
      star_rate: starRate,
      star_amount: money(toInt(r.stars, 0) * starRate),
      total_amount: r.status === 'approved' ? money(accMin / 60 * rate + toInt(r.stars, 0) * starRate) : 0,
      merged_into: r.merged_into || null,
      merged_count: toInt(r.merged_count, 0),
      reviewer: r.reviewer || '',
      reviewed_at: r.reviewed_at || '',
      created_at: r.created_at,
      updated_at: r.updated_at
    };
  });

  const counter = await env.DB.prepare(
    `SELECT
       SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) AS approved,
       SUM(CASE WHEN status = 'approved' AND approved_minutes IS NOT NULL AND approved_minutes <> minutes THEN 1 ELSE 0 END) AS adjusted
     FROM records`
  ).first();

  return ok({
    list: list,
    page: pg.page,
    size: pg.size,
    total: toInt(cnt && cnt.c, 0),
    counter: {
      approved: toInt(counter && counter.approved, 0),
      adjusted: toInt(counter && counter.adjusted, 0)
    }
  });
}
