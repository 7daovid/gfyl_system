/**
 * /api/admin/* 目录级鉴权
 * 纵深防御：即使某个 handler 忘了写 requireAdmin，这里也会先拦住非管理员请求。
 * 单价 / 核算工时 / 工资 / 操作日志 全部只在此目录下暴露。
 */
import { requireAdmin } from '../../_lib/auth.js';

export async function onRequest(context) {
  const user = await requireAdmin(context.request, context.env);
  context.data = context.data || {};
  context.data.admin = user;
  return context.next();
}
