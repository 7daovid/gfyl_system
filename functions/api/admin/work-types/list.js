/**
 * GET /api/admin/work-types/list
 * 管理员查看工作类型（含小时单价，管理员专属）
 */
import { ok, toInt } from '../../../_lib/util.js';

export async function onRequestGet(context) {
  const rs = await context.env.DB.prepare(
    `SELECT w.id, w.name, w.rate, w.sort_no, w.active,
            (SELECT COUNT(*) FROM records r WHERE r.work_type_id = w.id) AS used_count
       FROM work_types w
      ORDER BY w.sort_no ASC, w.id ASC`
  ).all();

  const list = (rs.results || []).map(function (r) {
    return {
      id: r.id,
      name: r.name,
      rate: Number(r.rate) || 0,
      sort_no: toInt(r.sort_no, 0),
      active: toInt(r.active, 0),
      used_count: toInt(r.used_count, 0)
    };
  });

  return ok({ list: list });
}
