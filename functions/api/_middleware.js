/**
 * API 统一中间件：CORS + 异常兜底 + D1 绑定检查
 */
import { ApiError, fail } from '../_lib/util.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Max-Age': '86400'
};

export async function onRequest(context) {
  const request = context.request;

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  if (!context.env || !context.env.DB) {
    return fail('数据库未绑定：请在 Pages 项目设置中把 D1 数据库绑定为变量名 DB', 500);
  }

  try {
    const res = await context.next();
    const out = new Response(res.body, res);
    Object.keys(CORS).forEach(function (k) { out.headers.set(k, CORS[k]); });
    return out;
  } catch (err) {
    const status = err instanceof ApiError ? err.status : 500;
    const msg = (err && err.message) ? err.message : '服务器内部错误';
    const res = fail(msg, status);
    Object.keys(CORS).forEach(function (k) { res.headers.set(k, CORS[k]); });
    return res;
  }
}
