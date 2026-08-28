/**
 * GET /api/plaza?page=1&size=20&keyword=&date=
 * 公开广场：所有学生的原始填报记录互相可见，用于互相监督
 *
 * ★ 只输出 6 个字段：姓名、学号、日期、填报时长、工作类型、备注
 *   绝不输出：核算工时 approved_minutes、单价 rate、工资、审核人
 * ★ 只查最近 30 天，分页加载，避免大量数据库读取（对 D1 免费额度友好）
 */
import { ok, pageParams, toInt, clean, minutesText, bjDateOffset, ApiError } from '../_lib/util.js';
import { currentUser } from '../_lib/auth.js';

const WINDOW_DAYS = 30;

/** D1 的 bind 需要展开参数 */
function bindAll(stmt, args) {
  return args && args.length ? stmt.bind.apply(stmt, args) : stmt;
}

export async function onRequestGet(context) {
  const env = context.env;

  // 默认要求登录（符合「原始填报记录全部登录用户可读」）；
  // 若把环境变量 PLAZA_PUBLIC 设为 1，则允许完全匿名浏览。
  if (String(env.PLAZA_PUBLIC || '0') !== '1') {
    const u = await currentUser(context.request, env);
    if (!u) throw new ApiError('请先登录后查看公开广场', 401);
  }

  const url = new URL(context.request.url);
  const pg = pageParams(url, 20, 50);
  const keyword = clean(url.searchParams.get('keyword'), 40);
  const date = clean(url.searchParams.get('date'), 10);
  const since = bjDateOffset(-(WINDOW_DAYS - 1));

  const where = ['work_date >= ?'];
  const args = [since];

  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    where.push('work_date = ?');
    args.push(date);
  }
  if (keyword) {
    where.push('(student_name LIKE ? OR student_no LIKE ?)');
    args.push('%' + keyword + '%', '%' + keyword + '%');
  }
  const whereSql = 'WHERE ' + where.join(' AND ');

  const cntRow = await bindAll(
    env.DB.prepare('SELECT COUNT(*) AS c FROM records ' + whereSql),
    args
  ).first();

  const rs = await bindAll(
    env.DB.prepare(
      'SELECT student_name, student_no, work_date, start_time, end_time, minutes, work_type_name, remark, stars ' +
      'FROM records ' + whereSql +
      ' ORDER BY work_date DESC, id DESC LIMIT ? OFFSET ?'
    ),
    args.concat([pg.size, pg.offset])
  ).all();

  const list = (rs.results || []).map(function (r) {
    return {
      name: r.student_name,
      student_no: r.student_no,
      work_date: r.work_date,
      start_time: r.start_time || '',
      end_time: r.end_time || '',
      time_range: (r.start_time && r.end_time) ? (r.start_time + ' - ' + r.end_time) : '',
      duration_text: minutesText(r.minutes),
      work_type_name: r.work_type_name,
      remark: r.remark || '',
      stars: toInt(r.stars, 0)
    };
  });

  const total = toInt(cntRow && cntRow.c, 0);

  return ok({
    list: list,
    page: pg.page,
    size: pg.size,
    total: total,
    has_more: pg.page * pg.size < total,
    window_days: WINDOW_DAYS,
    since: since
  });
}
