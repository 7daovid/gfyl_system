/**
 * POST /api/admin/records/review
 * 审核操作
 * body: {
 *   id,
 *   action: 'adjust'
 *   start_time?, end_time?,  // 修改时间段（adjust 时传）
 *   hours?, minutes?,        // 按分钟调整（旧数据无时段时传）
 *   reason?                  // 工时与学生填报不一致时必填（写入不可删除日志）
 * }
 *
 * 说明：记录提交即默认通过（DEFAULT_STATUS=approved），本接口只负责「调整工时」。
 * 老师若不同意某条记录，直接在前端「移除」即可（对应 /api/admin/records/delete）。
 *
 * 规则：
 *   · 原始填报 minutes 永不被覆盖，核算写入 approved_minutes
 *   · 只要核算工时 ≠ 学生填报工时，必须填写修改理由，否则拒绝
 *   · 每一次操作都写入 audit_logs（数据库触发器保证不可删改）
 */
import {
  ok, readJson, clean, toInt, ApiError, bjTime, minutesText, envInt, clientIp, isValidHHMM, slotMinutes
} from '../../../_lib/util.js';
import { writeLog, ACTION } from '../../../_lib/log.js';

const ACTIONS = ['adjust'];

export async function onRequestPost(context) {
  const env = context.env;
  const admin = (context.data && context.data.admin) || { name: '管理员' };
  const body = await readJson(context.request);

  const id = toInt(body.id, 0);
  const action = clean(body.action, 12);
  const reason = clean(body.reason, 300);

  if (!id) throw new ApiError('缺少记录 id', 400);
  if (ACTIONS.indexOf(action) < 0) throw new ApiError('不支持的操作类型', 400);

  const rec = await env.DB.prepare('SELECT * FROM records WHERE id = ?').bind(id).first();
  if (!rec) throw new ApiError('记录不存在', 404);
  if (rec.status === 'merged') throw new ApiError('该记录已被合并到 #' + rec.merged_into + '，请操作合并后的记录', 400);

  const now = Date.now();
  const nowText = bjTime(now);
  const operator = admin.name || '管理员';
  const ip = clientIp(context.request);
  const rawMin = toInt(rec.minutes, 0);

  /* ---------------- 调整工时（记录已默认通过，此处仅修正时长） ---------------- */
  // 调整时长：优先用 start_time/end_time 推算（即「修改时间段」）
  const start = clean(body.start_time, 5);
  const end = clean(body.end_time, 5);
  const hasSlot = isValidHHMM(start) && isValidHHMM(end);
  const hasCustom = body.hours !== undefined || body.minutes !== undefined;

  let accMin;
  let newMinutes = null; // 若调整了时段，则同步更新原始填报分钟数

  if (hasSlot) {
    const slot = slotMinutes(start, end);
    if (slot === null || slot <= 0) throw new ApiError('结束时间必须晚于开始时间', 400);
    const minSlot = envInt(env, 'MIN_SLOT_MINUTES', 10);
    if (slot < minSlot) throw new ApiError('单个时间段时长不能少于 ' + minSlot + ' 分钟', 400);
    const maxMin = envInt(env, 'MAX_MINUTES_PER_RECORD', 720);
    if (slot > maxMin) throw new ApiError('单个时间段时长不能超过 ' + Math.floor(maxMin / 60) + ' 小时', 400);
    newMinutes = slot;
    accMin = slot; // 默认通过：核算 = 填报
  } else if (hasCustom) {
    const h = toInt(body.hours, 0);
    const m = toInt(body.minutes, 0);
    if (h < 0 || h > 24 || m < 0 || m > 59) throw new ApiError('核算工时填写不正确', 400);
    accMin = h * 60 + m;
    const maxMin = envInt(env, 'MAX_MINUTES_PER_RECORD', 720);
    if (accMin > maxMin) throw new ApiError('核算工时不能超过 ' + Math.floor(maxMin / 60) + ' 小时', 400);
  } else {
    // 未传值：沿用已有核算值，没有则等于学生填报时长
    accMin = (rec.approved_minutes === null || rec.approved_minutes === undefined)
      ? rawMin : toInt(rec.approved_minutes, 0);
  }

  if (accMin < 0) throw new ApiError('核算工时不能为负', 400);

  const changed = accMin !== rawMin || newMinutes !== null;
  // ★ 核心风控：工时与学生填报不一致，必须有修改理由
  if (changed && !reason) {
    const to = newMinutes !== null ? minutesText(newMinutes) : minutesText(accMin);
    throw new ApiError('工时与学生填报不一致（' + minutesText(rawMin) + ' → ' + to + '），必须填写修改理由', 400);
  }

  // 标记「已调整」：时段变化 或 核算≠原始填报
  const adjusted = accMin !== rawMin || newMinutes !== null;
  const setMinutes = newMinutes === null ? toInt(rec.minutes, 0) : newMinutes;
  const setStart = newMinutes === null ? (rec.start_time || '') : start;
  const setEnd = newMinutes === null ? (rec.end_time || '') : end;

  await env.DB.prepare(
    `UPDATE records SET status = 'approved', minutes = ?, start_time = ?, end_time = ?, approved_minutes = ?,
            reject_reason = '', reviewer = ?, reviewed_ms = ?, reviewed_at = ?, updated_ms = ?, updated_at = ?
     WHERE id = ?`
  ).bind(setMinutes, setStart, setEnd, accMin, operator, now, nowText, now, nowText, id).run();

  await writeLog(env, {
    operator: operator,
    role: 'admin',
    action: adjusted ? ACTION.RECORD_ADJUST : ACTION.RECORD_APPROVE,
    targetType: 'record',
    targetId: id,
    oldValue: '状态:' + (rec.status === 'pending' ? '待审核' : rec.status) + ' / 时段:' +
              (rec.start_time || '-') + '-' + (rec.end_time || '-') + ' / 核算工时:' + fmtAcc(rec) +
              ' / 学生填报:' + minutesText(rawMin),
    newValue: '状态:已审核 / 时段:' + setStart + '-' + setEnd + ' / 核算工时:' + minutesText(accMin),
    reason: reason || (adjusted ? '' : '按学生填报时长通过'),
    ip: ip
  });

  return ok({ id: id, status: 'approved', approved_minutes: accMin, adjusted: adjusted });
}

function fmtAcc(rec) {
  if (rec.approved_minutes === null || rec.approved_minutes === undefined) return '未核算';
  return minutesText(rec.approved_minutes);
}
