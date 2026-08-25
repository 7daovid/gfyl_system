/**
 * POST /api/records/create
 * 学生提交工时填报（按「时间段」批量提交）
 * body: {
 *   work_date: "YYYY-MM-DD",
 *   segments: [
 *     { start_time: "09:00", end_time: "11:30", work_type_id: 1, remark: "..." },
 *     ...
 *   ]
 * }
 * 每条时间段单独成一条记录；时长由 start/end 推算。
 */
import {
  ok, readJson, clean, toInt, ApiError, bjDate, bjTime, isValidDate, dayDiff,
  envInt, envStr, minutesText, clientIp, isValidHHMM, slotMinutes
} from '../../_lib/util.js';
import { requireStudent, assertWhitelisted } from '../../_lib/auth.js';
import { writeLog, ACTION } from '../../_lib/log.js';

export async function onRequestPost(context) {
  const env = context.env;
  const user = await requireStudent(context.request, env);
  // 每次提交都重新查白名单：外部人员 / 已停用学号一律拦死
  const stu = await assertWhitelisted(env, user.studentNo);

  const body = await readJson(context.request);
  const workDate = clean(body.work_date, 10);
  const segments = Array.isArray(body.segments) ? body.segments : [];

  /* ---------- 基础校验 ---------- */
  if (!isValidDate(workDate)) throw new ApiError('请选择正确的工作日期', 400);

  const today = bjDate();
  if (dayDiff(workDate, today) > 0) throw new ApiError('不能填报未来日期', 400);

  const backfill = envInt(env, 'BACKFILL_DAYS', 31);
  if (dayDiff(today, workDate) > backfill) {
    throw new ApiError('只能补报最近 ' + backfill + ' 天内的工时', 400);
  }

  if (!segments.length) throw new ApiError('请至少添加一个工作时间段', 400);
  if (segments.length > 50) throw new ApiError('单次最多提交 50 个时间段', 400);

  const minSlot = envInt(env, 'MIN_SLOT_MINUTES', 10);
  const maxMin = envInt(env, 'MAX_MINUTES_PER_RECORD', 720);

  // 同一天内已存在、用于去重的集合
  const dayRow = await env.DB.prepare(
    `SELECT COALESCE(SUM(minutes),0) AS s FROM records
     WHERE student_no = ? AND work_date = ?`
  ).bind(user.studentNo, workDate).first();
  let dayTotal = toInt(dayRow && dayRow.s, 0);

  const defaultStatus = envStr(env, 'DEFAULT_STATUS', 'approved') === 'approved' ? 'approved' : 'pending';

  const now = Date.now();
  const nowText = bjTime(now);
  const newRows = [];

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i] || {};
    const start = clean(seg.start_time, 5);
    const end = clean(seg.end_time, 5);
    const typeId = toInt(seg.work_type_id, 0);
    const remark = clean(seg.remark, 200);

    if (!isValidHHMM(start) || !isValidHHMM(end)) {
      throw new ApiError('第 ' + (i + 1) + ' 个时间段的时间格式不正确（应为 HH:MM）', 400);
    }
    const slot = slotMinutes(start, end);
    if (slot === null || slot <= 0) {
      throw new ApiError('第 ' + (i + 1) + ' 个时间段的结束时间必须晚于开始时间', 400);
    }
    if (slot < minSlot) {
      throw new ApiError('单个时间段时长不能少于 ' + minSlot + ' 分钟', 400);
    }
    if (slot > maxMin) {
      throw new ApiError('单个时间段时长不能超过 ' + Math.floor(maxMin / 60) + ' 小时', 400);
    }

    const type = await env.DB
      .prepare('SELECT id, name, active FROM work_types WHERE id = ?')
      .bind(typeId)
      .first();
    if (!type || Number(type.active) !== 1) throw new ApiError('第 ' + (i + 1) + ' 个时间段请选择有效的工作类型', 400);

    // 防重复：同一天同类型同起止
    const dup = await env.DB.prepare(
      `SELECT id FROM records
       WHERE student_no = ? AND work_date = ? AND work_type_id = ? AND start_time = ? AND end_time = ?`
    ).bind(user.studentNo, workDate, typeId, start, end).first();
    if (dup) throw new ApiError('已存在完全相同的记录（同日期/同类型/同起止），请勿重复提交', 409);

    dayTotal += slot;
    if (dayTotal > 24 * 60) {
      throw new ApiError('该日累计填报时长已超过 24 小时，请检查', 400);
    }

    newRows.push({ start, end, minutes: slot, typeId: type.id, typeName: type.name, remark, status: defaultStatus });
  }

  /* ---------- 写入 ---------- */
  const ids = [];
  for (let i = 0; i < newRows.length; i++) {
    const r = newRows[i];
    const res = await env.DB.prepare(
      `INSERT INTO records
        (student_no, student_name, work_date, start_time, end_time, minutes, work_type_id, work_type_name, remark,
         status, approved_minutes, reviewer, reviewed_ms, reviewed_at, created_ms, created_at, updated_ms, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      user.studentNo, stu.name, workDate, r.start, r.end, r.minutes, r.typeId, r.typeName, r.remark,
      r.status,
      r.status === 'approved' ? r.minutes : null,           // 默认通过时核算=填报
      r.status === 'approved' ? '系统自动通过' : '',
      r.status === 'approved' ? now : null,
      r.status === 'approved' ? nowText : '',
      now, nowText, now, nowText
    ).run();
    const newId = (res.meta && res.meta.last_row_id) ? res.meta.last_row_id : 0;
    ids.push(newId);
    await writeLog(env, {
      operator: stu.name + '(' + user.studentNo + ')',
      role: 'student',
      action: ACTION.RECORD_CREATE,
      targetType: 'record',
      targetId: newId,
      oldValue: '',
      newValue: workDate + ' ' + r.start + '-' + r.end + ' / ' + r.typeName + ' / ' + minutesText(r.minutes) + (r.remark ? ' / 备注:' + r.remark : ''),
      reason: r.status === 'approved' ? '提交即自动通过' : '',
      ip: clientIp(context.request)
    });
  }

  const win = envInt(env, 'EDIT_WINDOW_MINUTES', 10);
  return ok({
    ids: ids,
    count: ids.length,
    default_status: defaultStatus,
    edit_window_minutes: win,
    message: defaultStatus === 'approved'
      ? '已提交并自动通过，' + win + ' 分钟内可修改/撤回'
      : '已提交，等待管理员审核，' + win + ' 分钟内可修改/撤回'
  });
}
