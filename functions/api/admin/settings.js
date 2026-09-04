/**
 * GET/POST /api/admin/settings
 * 系统参数配置（管理员专属）
 *   GET  → 读取当前配置（小星星单价等）
 *   POST → 保存配置 { star_rate: 每颗星星价值（元） }
 *
 * 安全：本接口在 /api/admin/ 目录下，中间件已强制管理员身份。
 *      学生端不调用本接口，学生端绝不接触星星单价金额。
 */
import { ok, readJson, toFloat, money, clean, bjTime, clientIp, ApiError } from '../../_lib/util.js';
import { writeLog, ACTION } from '../../_lib/log.js';

/** 读取单个配置项 */
async function getSetting(env, key, def) {
  const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first();
  return (row && row.value !== undefined && row.value !== null && row.value !== '') ? row.value : def;
}

export async function onRequestGet(context) {
  const env = context.env;
  const starRate = money(toFloat(await getSetting(env, 'star_rate', '15'), 15));
  const inviteCode = String(await getSetting(env, 'invite_code', ''));
  return ok({ star_rate: starRate, invite_code: inviteCode });
}

export async function onRequestPost(context) {
  const env = context.env;
  const admin = (context.data && context.data.admin) || { name: '管理员' };
  const body = await readJson(context.request);
  const now = Date.now();
  const nowText = bjTime(now);

  const out = {};

  // 小星星单价
  if (body.star_rate !== undefined) {
    const rate = money(toFloat(body.star_rate, 15));
    if (rate < 0 || rate > 10000) throw new ApiError('小星星单价需在 0 ~ 10000 元之间', 400);
    const old = await getSetting(env, 'star_rate', '15');
    await env.DB.prepare(
      'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ' +
      'ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at'
    ).bind('star_rate', String(rate), nowText).run();
    await writeLog(env, {
      operator: admin.name || '管理员',
      role: 'admin',
      action: ACTION.SETTING_UPDATE,
      targetType: 'system',
      targetId: 'star_rate',
      oldValue: '小星星单价 ' + money(toFloat(old, 15)) + ' 元/颗',
      newValue: '小星星单价 ' + rate + ' 元/颗',
      reason: clean(body.reason, 200),
      ip: clientIp(context.request)
    });
    out.star_rate = rate;
  }

  // 注册邀请码
  if (body.invite_code !== undefined) {
    const code = clean(String(body.invite_code), 40);
    const oldCode = String(await getSetting(env, 'invite_code', ''));
    await env.DB.prepare(
      'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ' +
      'ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at'
    ).bind('invite_code', code, nowText).run();
    await writeLog(env, {
      operator: admin.name || '管理员',
      role: 'admin',
      action: ACTION.SETTING_UPDATE,
      targetType: 'system',
      targetId: 'invite_code',
      oldValue: '注册邀请码 ' + (oldCode || '(未设置)'),
      newValue: '注册邀请码 ' + (code || '(已清空，暂不开放注册)'),
      reason: clean(body.reason, 200),
      ip: clientIp(context.request)
    });
    out.invite_code = code;
  }

  return ok(out);
}
