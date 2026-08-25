/**
 * GET /api/work-types
 * 学生端工作类型下拉列表
 * ★★ 安全红线：只 SELECT id, name —— 单价 rate 绝不出现在返回值里 ★★
 */
import { ok } from '../_lib/util.js';
import { requireUser } from '../_lib/auth.js';

export async function onRequestGet(context) {
  await requireUser(context.request, context.env);

  const rs = await context.env.DB
    .prepare('SELECT id, name FROM work_types WHERE active = 1 ORDER BY sort_no ASC, id ASC')
    .all();

  const list = (rs.results || []).map(function (r) {
    return { id: r.id, name: r.name };   // 白名单式字段映射，防止未来加字段时意外泄露
  });

  return ok({ list: list });
}
