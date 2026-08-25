/**
 * 通用工具函数
 */

/** 业务异常：会被 _middleware 捕获并转成 JSON */
export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status || 400;
  }
}

export function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

export function ok(data) {
  return json({ ok: true, data: data === undefined ? null : data });
}

export function fail(message, status) {
  return json({ ok: false, error: message }, status || 400);
}

export async function readJson(request) {
  try {
    const body = await request.json();
    return body && typeof body === 'object' ? body : {};
  } catch (e) {
    return {};
  }
}

/* ---------------- 时间：统一按北京时间（UTC+8）处理 ---------------- */

const BJ_OFFSET = 8 * 60 * 60 * 1000;

/** 北京时间 "YYYY-MM-DD HH:mm:ss" */
export function bjTime(ms) {
  const d = new Date((ms === undefined || ms === null ? Date.now() : ms) + BJ_OFFSET);
  return d.toISOString().replace('T', ' ').slice(0, 19);
}

/** 北京日期 "YYYY-MM-DD" */
export function bjDate(ms) {
  return bjTime(ms).slice(0, 10);
}

/** 北京日期偏移 n 天 */
export function bjDateOffset(days) {
  return bjDate(Date.now() + days * 86400000);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDate(s) {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const parts = s.split('-');
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** 两个 YYYY-MM-DD 相差天数（a - b） */
export function dayDiff(a, b) {
  return Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 86400000);
}

/* ---------------- 数值 / 分页 ---------------- */

export function toInt(v, def) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : (def === undefined ? 0 : def);
}

export function toFloat(v, def) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : (def === undefined ? 0 : def);
}

export function envInt(env, key, def) {
  return toInt(env && env[key], def);
}

/** 从 URL 解析分页参数 */
export function pageParams(url, defaultSize, maxSize) {
  const ds = defaultSize || 20;
  const ms = maxSize || 100;
  let page = toInt(url.searchParams.get('page'), 1);
  let size = toInt(url.searchParams.get('size'), ds);
  if (page < 1) page = 1;
  if (size < 1) size = ds;
  if (size > ms) size = ms;
  return { page: page, size: size, offset: (page - 1) * size };
}

/** 分钟 → "3小时25分钟" */
export function minutesText(min) {
  const m = toInt(min, 0);
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h && r) return h + '小时' + r + '分钟';
  if (h) return h + '小时';
  return r + '分钟';
}

/** 分钟 → 小时数（保留两位） */
export function minutesToHours(min) {
  return Math.round((toInt(min, 0) / 60) * 100) / 100;
}

/** 金额四舍五入两位 */
export function money(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/* ---------------- 时间段（HH:MM）处理 ---------------- */

/** 校验 "HH:MM" 格式且合法 */
export function isValidHHMM(s) {
  if (typeof s !== 'string') return false;
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return false;
  const h = parseInt(m[1], 10), mm = parseInt(m[2], 10);
  return h >= 0 && h <= 23 && mm >= 0 && mm <= 59;
}

/** "HH:MM" -> 当天分钟数；非法返回 null */
export function toMinOfDay(s) {
  if (typeof s !== 'string') return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

/** 结束 - 开始（分钟），可能为负；任一非法返回 null */
export function slotMinutes(start, end) {
  const a = toMinOfDay(start), b = toMinOfDay(end);
  if (a === null || b === null) return null;
  return b - a;
}

/** 时间戳字符串 或 环境变量（字符串）读取 */
export function envStr(env, key, def) {
  const v = env && env[key];
  return (v === undefined || v === null) ? (def === undefined ? '' : def) : String(v);
}

/** 去除首尾空白并限长 */
export function clean(v, maxLen) {
  const s = (v === undefined || v === null ? '' : String(v)).trim();
  const lim = maxLen || 200;
  return s.length > lim ? s.slice(0, lim) : s;
}

export function clientIp(request) {
  return request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || '';
}

export const STATUS_TEXT = {
  pending: '待审核',
  approved: '已审核',
  merged: '已合并'
};
