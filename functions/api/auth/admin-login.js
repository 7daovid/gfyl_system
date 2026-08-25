/**
 * POST /api/auth/admin-login
 * 管理员密码登录
 * body: { password }
 */
import { ok, readJson, clean, ApiError, clientIp } from '../../_lib/util.js';
import { signToken, adminTtl } from '../../_lib/auth.js';
import { writeLog, ACTION } from '../../_lib/log.js';

/** 定长比较 */
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function onRequestPost(context) {
  const env = context.env;
  const body = await readJson(context.request);
  const pwd = clean(body.password, 100);

  const expect = env.ADMIN_PASSWORD || 'admin123';

  if (!pwd) throw new ApiError('请输入管理员密码', 400);
  if (!safeEqual(pwd, expect)) throw new ApiError('密码错误', 401);

  const token = await signToken(env, { r: 'admin', n: '管理员' }, adminTtl());

  await writeLog(env, {
    operator: '管理员',
    role: 'admin',
    action: ACTION.ADMIN_LOGIN,
    targetType: 'system',
    targetId: '',
    ip: clientIp(context.request)
  });

  return ok({
    token: token,
    role: 'admin',
    name: '管理员',
    default_password: expect === 'admin123'
  });
}
