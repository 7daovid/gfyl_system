/**
 * GET /api/admin/students/list?page=1&size=20&keyword=&active=
 * 白名单分页查询
 */
import { ok, pageParams, clean, toInt } from '../../../_lib/util.js';

function bindAll(stmt, args) {
  return args && args.length ? stmt.bind.apply(stmt, args) : stmt;
}

export async function onRequestGet(context) {
  const env = context.env;
  const url = new URL(context.request.url);
  const pg = pageParams(url, 20, 100);
  const keyword = clean(url.searchParams.get('keyword'), 40);
  const active = clean(url.searchParams.get('active'), 4);

  const where = [];
  const args = [];
  if (keyword) {
    where.push('(student_no LIKE ? OR name LIKE ? OR dept LIKE ?)');
    args.push('%' + keyword + '%', '%' + keyword + '%', '%' + keyword + '%');
  }
  if (active === '0' || active === '1') {
    where.push('active = ?');
    args.push(Number(active));
  }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const cnt = await bindAll(env.DB.prepare('SELECT COUNT(*) AS c FROM students ' + whereSql), args).first();

  const rs = await bindAll(
    env.DB.prepare(
      'SELECT id, student_no, name, dept, active, created_at FROM students ' + whereSql +
      ' ORDER BY student_no ASC LIMIT ? OFFSET ?'
    ),
    args.concat([pg.size, pg.offset])
  ).all();

  const stat = await env.DB.prepare(
    'SELECT COUNT(*) AS all_cnt, SUM(CASE WHEN active = 1 THEN 1 ELSE 0 END) AS on_cnt FROM students'
  ).first();

  return ok({
    list: rs.results || [],
    page: pg.page,
    size: pg.size,
    total: toInt(cnt && cnt.c, 0),
    stat: {
      total: toInt(stat && stat.all_cnt, 0),
      active: toInt(stat && stat.on_cnt, 0)
    }
  });
}
