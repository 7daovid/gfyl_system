/**
 * GET /api/records/mine?page=1&size=20
 * 学生查看自己的全部记录
 * ★ 返回字段不含 approved_minutes / rate / 工资
 */
import { ok, pageParams, envInt, toInt, minutesText, STATUS_TEXT } from '../../_lib/util.js';
import { requireStudent } from '../../_lib/auth.js';

export async function onRequestGet(context) {
  const env = context.env;
  const user = await requireStudent(context.request, env);
  const url = new URL(context.request.url);
  const pg = pageParams(url, 20, 50);
  const win = envInt(env, 'EDIT_WINDOW_MINUTES', 10);
  const now = Date.now();

  const cnt = await env.DB
    .prepare('SELECT COUNT(*) AS c FROM records WHERE student_no = ?')
    .bind(user.studentNo).first();

  const rs = await env.DB.prepare(
    `SELECT id, work_date, start_time, end_time, minutes, work_type_name, remark, stars, status,
            merged_into, approved_minutes, created_ms, created_at
       FROM records
      WHERE student_no = ?
      ORDER BY work_date DESC, id DESC
      LIMIT ? OFFSET ?`
  ).bind(user.studentNo, pg.size, pg.offset).all();

  const list = (rs.results || []).map(function (r) {
    const leftMs = toInt(r.created_ms, 0) + win * 60000 - now;
    const adjustable = (r.status === 'pending' || r.status === 'approved')
      && (r.approved_minutes === null || r.approved_minutes === undefined || toInt(r.approved_minutes, 0) === toInt(r.minutes, 0));
    return {
      id: r.id,
      work_date: r.work_date,
      start_time: r.start_time || '',
      end_time: r.end_time || '',
      time_range: (r.start_time && r.end_time) ? (r.start_time + ' - ' + r.end_time) : '',
      minutes: r.minutes,
      duration_text: minutesText(r.minutes),
      work_type_name: r.work_type_name,
      remark: r.remark,
      stars: toInt(r.stars, 0),
      status: r.status,
      status_text: STATUS_TEXT[r.status] || r.status,
      merged_into: r.merged_into || null,
      created_at: r.created_at,
      editable: adjustable && leftMs > 0,
      edit_left_seconds: leftMs > 0 ? Math.floor(leftMs / 1000) : 0
    };
  });

  // 汇总（只统计学生自己填报的原始时长与星星，不涉及单价与工资）
  const sum = await env.DB.prepare(
    `SELECT
        COALESCE(SUM(minutes),0) AS total_min,
        COALESCE(SUM(stars),0) AS total_stars,
        SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) AS approved_cnt,
        COUNT(*) AS all_cnt
     FROM records WHERE student_no = ?`
  ).bind(user.studentNo).first();

  return ok({
    list: list,
    page: pg.page,
    size: pg.size,
    total: toInt(cnt && cnt.c, 0),
    edit_window_minutes: win,
    summary: {
      total_minutes: toInt(sum && sum.total_min, 0),
      total_text: minutesText(sum && sum.total_min),
      total_stars: toInt(sum && sum.total_stars, 0),
      approved: toInt(sum && sum.approved_cnt, 0),
      count: toInt(sum && sum.all_cnt, 0)
    }
  });
}
