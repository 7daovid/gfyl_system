/**
 * POST /api/auth/register
 * 学生自助注册（需邀请码；注册后进入待审核，老师审核通过后才能登录）
 * body: { invite_code, name, student_no, phone }
 *
 * 安全说明：
 *   · 邀请码必须与管理端 settings.invite_code 完全一致，否则拒绝
 *   · 学号需在白名单之外（已在名单内 / 已注册则拒绝）
 *   · 注册成功后 reg_status = pending，登录接口会拦截到审核通过前
 *   · 联系电话只存数据库，仅管理员可见，学生端接口不返回
 */
import { ok, readJson, clean, ApiError, bjTime, clientIp } from '../../_lib/util.js';
import { writeLog, ACTION } from '../../_lib/log.js';

export async function onRequestPost(context) {
  const env = context.env;
  const body = await readJson(context.request);

  const invite = clean(body.invite_code, 40);
  const no = clean(body.student_no, 40);
  const name = clean(body.name, 40);
  const phone = clean(body.phone, 20);

  /* ---------- 校验 ---------- */
  // 邀请码
  const inviteRow = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind('invite_code').first();
  const inviteCode = (inviteRow && inviteRow.value) ? String(inviteRow.value) : '';
  if (!inviteCode) throw new ApiError('当前未开放注册，请联系老师', 403);
  if (invite !== inviteCode) throw new ApiError('邀请码不正确，请核对后重试', 403);

  // 学号
  if (!/^[A-Za-z0-9_-]{4,40}$/.test(no)) throw new ApiError('学号格式不正确（4-40 位字母数字）', 400);
  const dup = await env.DB.prepare('SELECT id, reg_status FROM students WHERE student_no = ?').bind(no).first();
  if (dup) {
    if (dup.reg_status === 'pending') throw new ApiError('该学号已提交注册，正在审核中，请勿重复提交', 409);
    if (dup.reg_status === 'approved') throw new ApiError('该学号已在勤工助学名单中，无需注册，可直接登录', 409);
    // rejected：允许重新提交注册申请（更新资料，回到待审核）
  }

  // 姓名
  if (!name) throw new ApiError('请填写姓名', 400);

  // 联系方式（必填，手机号校验）
  if (!/^1\d{10}$/.test(phone)) throw new ApiError('请填写正确的手机号（11 位）', 400);

  /* ---------- 写入 ---------- */
  const now = Date.now();
  const res = await env.DB.prepare(
    `INSERT INTO students (student_no, name, dept, phone, reg_status, active, created_ms, created_at)
     VALUES (?, ?, '', ?, 'pending', 1, ?, ?)
     ON CONFLICT(student_no) DO UPDATE SET
        name = excluded.name,
        phone = excluded.phone,
        reg_status = 'pending',
        active = 1`
  ).bind(no, name, phone, now, bjTime(now)).run();
  // 用真实 id（ON CONFLICT UPDATE 时 last_row_id 可能不准）
  const real = await env.DB.prepare('SELECT id FROM students WHERE student_no = ?').bind(no).first();
  const newId = (real && real.id) || 0;

  await writeLog(env, {
    operator: name + '(' + no + ')',
    role: 'student',
    action: ACTION.STUDENT_REGISTER,
    targetType: 'student',
    targetId: newId,
    oldValue: '',
    newValue: '注册申请 学号 ' + no + ' / 姓名 ' + name + ' / 电话 ' + phone,
    reason: '邀请码验证通过，等待老师审核',
    ip: clientIp(context.request)
  });

  return ok({ id: newId, status: 'pending' });
}
