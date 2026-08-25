/**
 * 鉴权：无第三方依赖，使用 Web Crypto 做 HMAC-SHA256 签名的无状态 Token
 *
 * Token 结构： base64url(payload).base64url(hmac)
 * payload: { r: 角色, s: 学号, n: 姓名, e: 过期时间(秒) }
 */
import { ApiError } from './util.js';

const DEFAULT_TTL = 7 * 24 * 3600;      // 学生 7 天
const ADMIN_TTL = 12 * 3600;            // 管理员 12 小时

function secretOf(env) {
  return (env && env.AUTH_SECRET) || (env && env.ADMIN_PASSWORD ? 'qgzx$' + env.ADMIN_PASSWORD : 'qgzx-dev-secret-please-change');
}

function b64urlFromBytes(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function bytesFromB64url(str) {
  let s = str.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmac(env, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secretOf(env)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return new Uint8Array(sig);
}

export async function signToken(env, payload, ttlSec) {
  const body = Object.assign({}, payload, {
    e: Math.floor(Date.now() / 1000) + (ttlSec || DEFAULT_TTL)
  });
  const p = b64urlFromBytes(new TextEncoder().encode(JSON.stringify(body)));
  const sig = b64urlFromBytes(await hmac(env, p));
  return p + '.' + sig;
}

export async function verifyToken(env, token) {
  if (!token || typeof token !== 'string' || token.indexOf('.') < 0) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const expect = b64urlFromBytes(await hmac(env, parts[0]));
  // 定长比较，避免时序泄漏
  if (expect.length !== parts[1].length) return null;
  let diff = 0;
  for (let i = 0; i < expect.length; i++) diff |= expect.charCodeAt(i) ^ parts[1].charCodeAt(i);
  if (diff !== 0) return null;
  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(bytesFromB64url(parts[0])));
  } catch (e) {
    return null;
  }
  if (!payload || !payload.e || payload.e < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

export function studentTtl() { return DEFAULT_TTL; }
export function adminTtl() { return ADMIN_TTL; }

/** 从请求头 / query 取出并校验身份，未登录返回 null */
export async function currentUser(request, env) {
  let token = '';
  const h = request.headers.get('Authorization') || '';
  if (h.indexOf('Bearer ') === 0) token = h.slice(7);
  if (!token) {
    const u = new URL(request.url);
    token = u.searchParams.get('token') || '';
  }
  if (!token) return null;
  const p = await verifyToken(env, token);
  if (!p) return null;
  return { role: p.r, studentNo: p.s || '', name: p.n || '', };
}

/** 必须是管理员 */
export async function requireAdmin(request, env) {
  const u = await currentUser(request, env);
  if (!u || u.role !== 'admin') throw new ApiError('需要管理员身份，请重新登录', 401);
  return u;
}

/** 必须已登录（学生或管理员） */
export async function requireUser(request, env) {
  const u = await currentUser(request, env);
  if (!u) throw new ApiError('请先登录', 401);
  return u;
}

/** 必须是学生本人（管理员不能代替学生提交） */
export async function requireStudent(request, env) {
  const u = await currentUser(request, env);
  if (!u || u.role !== 'student' || !u.studentNo) throw new ApiError('请使用学号登录', 401);
  return u;
}

/**
 * 每次涉及填报的操作都重新校验白名单，
 * 防止「离职/被移出名单」的学生用旧 token 继续提交。
 */
export async function assertWhitelisted(env, studentNo) {
  const row = await env.DB
    .prepare('SELECT student_no, name, active FROM students WHERE student_no = ?')
    .bind(studentNo)
    .first();
  if (!row) throw new ApiError('该学号不在勤工助学名单内，无法提交', 403);
  if (Number(row.active) !== 1) throw new ApiError('该学号已被停用，如有疑问请联系管理员', 403);
  return row;
}
