/**
 * POST /api/records/update
 * 学生修改自己的填报（仅提交后 10 分钟内 + 管理员未调整过工时）
 * body: { id, work_date, start_time, end_time, work_type_id, remark }
 */
import {
  ok, readJson, clean, toInt, ApiError, bjDate, bjTime, isValidDate, dayDiff, envInt, minutesText, clientIp,
  isValidHHMM, slotMinutes
} from '../../_lib/util.js';
import { requireStudent, assertWhitelisted } from '../../_lib/auth.js';
import { writeLog, ACTION } from '../../_lib/log.js';

export async function onRequestPost(context) {
  const env = context.env;
  const user = await requireStudent(context.request, env);
  const stu = await assertWhitelisted(env, user.studentNo);

  const body = await readJson(context.request);
  const id = toInt(body.id, 0);
  if (!id) throw new ApiError('缺少记录 id', 400);

  const rec = await env.DB
    .prepare('SELECT * FROM records WHERE id = ?')
    .bind(id)
    .first();
  if (!rec) throw new ApiError('记录不存在', 404);
  if (rec.student_no !== user.studentNo) throw new ApiError('无权操作他人的记录', 403);

  const win = envInt(env, 'EDIT_WINDOW_MINUTES', 10);
  const elapsed = Date.now() - toInt(rec.created_ms, 0);
  if (elapsed > win * 60000) throw new ApiError('已超过 ' + win + ' 分钟修改时限，请联系管理员处理', 400);
  // 已被管理员调整过核算的，学生不能再改
  if (rec.status === 'approved' && rec.approved_minutes !== null && rec.approved_minutes !== undefined
      && toInt(rec.approved_minutes, 0) !== toInt(rec.minutes, 0)) {
    throw new ApiError('该记录已被管理员调整过工时，如需修改请联系管理员', 400);
  }

  /* ---------- 校验新值 ---------- */
  const workDate = clean(body.work_date, 10);
  const start = clean(body.start_time, 5);
  const end = clean(body.end_time, 5);
  const typeId = toInt(body.work_type_id, 0);
  const remark = clean(body.remark, 200);
  const stars = toInt(body.stars, 0);
  if (stars < 0 || stars > 50) throw new ApiError('小星星数量需在 0 ~ 50 之间', 400);

  if (!isValidDate(workDate)) throw new ApiError('请选择正确的工作日期', 400);
  const today = bjDate();
  if (dayDiff(workDate, today) > 0) throw new ApiError('不能填报未来日期', 400);
  const backfill = envInt(env, 'BACKFILL_DAYS', 31);
  if (dayDiff(today, workDate) > backfill) throw new ApiError('只能补报最近 ' + backfill + ' 天内的工时', 400);

  if (!isValidHHMM(start) || !isValidHHMM(end)) throw new ApiError('时间格式不正确（应为 HH:MM）', 400);
  const slot = slotMinutes(start, end);
  if (slot === null || slot <= 0) throw new ApiError('结束时间必须晚于开始时间', 400);
  const minSlot = envInt(env, 'MIN_SLOT_MINUTES', 10);
  if (slot < minSlot) throw new ApiError('单个时间段时长不能少于 ' + minSlot + ' 分钟', 400);
  const maxMin = envInt(env, 'MAX_MINUTES_PER_RECORD', 720);
  if (slot > maxMin) throw new ApiError('单个时间段时长不能超过 ' + Math.floor(maxMin / 60) + ' 小时', 400);

  const type = await env.DB
    .prepare('SELECT id, name, active FROM work_types WHERE id = ?')
    .bind(typeId)
    .first();
  if (!type || Number(type.active) !== 1) throw new ApiError('请选择有效的工作类型', 400);

  // 默认通过状态下，改时长同步更新核算工时
  const newStatus = (rec.status === 'approved') ? 'approved' : 'pending';
  const newApproved = (newStatus === 'approved') ? slot : (rec.approved_minutes === null || rec.approved_minutes === undefined ? null : toInt(rec.approved_minutes, 0));

  const now = Date.now();
  await env.DB.prepare(
    `UPDATE records
       SET work_date = ?, start_time = ?, end_time = ?, minutes = ?, work_type_id = ?, work_type_name = ?, remark = ?, stars = ?,
           status = ?, approved_minutes = ?, updated_ms = ?, updated_at = ?
     WHERE id = ? AND student_no = ?`
  ).bind(workDate, start, end, slot, type.id, type.name, remark, stars,
         newStatus, newApproved, now, bjTime(now), id, user.studentNo).run();

  await writeLog(env, {
    operator: stu.name + '(' + user.studentNo + ')',
    role: 'student',
    action: ACTION.RECORD_UPDATE,
    targetType: 'record',
    targetId: id,
    oldValue: rec.work_date + ' ' + rec.start_time + '-' + rec.end_time + ' / ' + rec.work_type_name + ' / ' + minutesText(rec.minutes) + (rec.remark ? ' / 备注:' + rec.remark : ''),
    newValue: workDate + ' ' + start + '-' + end + ' / ' + type.name + ' / ' + minutesText(slot) + (stars ? ' / ⭐' + stars + '颗' : '') + (remark ? ' / 备注:' + remark : ''),
    reason: '学生在' + win + '分钟内自助修改',
    ip: clientIp(context.request)
  });

  return ok({ id: id });
}
