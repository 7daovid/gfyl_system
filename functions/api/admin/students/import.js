/**
 * POST /api/admin/students/import
 * 批量导入学号白名单
 * body: { text, mode }   mode: 'append'(默认追加/更新) | 'replace'(先全部停用再导入)
 *
 * text 每行一条，支持分隔符：逗号 / 中文逗号 / 制表符 / 空格
 *   20230001,张三,计算机学院
 *   20230002 李四
 *   20230003
 */
import { ok, readJson, clean, ApiError, bjTime, clientIp } from '../../../_lib/util.js';
import { writeLog, ACTION } from '../../../_lib/log.js';

const MAX_ROWS = 2000;

export async function onRequestPost(context) {
  const env = context.env;
  const admin = (context.data && context.data.admin) || { name: '管理员' };
  const body = await readJson(context.request);
  const text = typeof body.text === 'string' ? body.text : '';
  const mode = body.mode === 'replace' ? 'replace' : 'append';

  if (!text.trim()) throw new ApiError('请粘贴要导入的名单内容', 400);

  const lines = text.split(/\r?\n/);
  const items = [];
  const errors = [];
  const seen = {};

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (!raw) continue;
    // 跳过表头
    if (i === 0 && /学号/.test(raw)) continue;

    const cols = raw.split(/[,，\t;；]+|\s{1,}/).filter(function (s) { return s !== ''; });
    const no = clean(cols[0], 40);
    const name = clean(cols[1], 40) || ('学生' + no.slice(-4));
    const dept = clean(cols[2], 60);
    const phone = clean(cols[3], 20);

    if (!/^[A-Za-z0-9_-]{4,40}$/.test(no)) {
      errors.push('第 ' + (i + 1) + ' 行学号格式不正确：' + raw.slice(0, 30));
      continue;
    }
    if (seen[no]) {
      errors.push('第 ' + (i + 1) + ' 行学号重复：' + no);
      continue;
    }
    seen[no] = 1;
    items.push({ no: no, name: name, dept: dept, phone: phone });

    if (items.length > MAX_ROWS) throw new ApiError('单次导入最多 ' + MAX_ROWS + ' 条，请分批导入', 400);
  }

  if (!items.length) throw new ApiError('没有解析到有效数据。' + (errors[0] || ''), 400);

  const now = Date.now();
  const nowText = bjTime(now);

  if (mode === 'replace') {
    // 不物理删除（保护历史填报的姓名溯源），仅全部停用
    await env.DB.prepare('UPDATE students SET active = 0').run();
  }

  // 分批用 batch 写入，减少往返
  const CHUNK = 50;
  let inserted = 0;
  for (let s = 0; s < items.length; s += CHUNK) {
    const chunk = items.slice(s, s + CHUNK);
    const stmts = chunk.map(function (it) {
      return env.DB.prepare(
        `INSERT INTO students (student_no, name, dept, phone, reg_status, active, created_ms, created_at)
         VALUES (?, ?, ?, ?, 'approved', 1, ?, ?)
         ON CONFLICT(student_no) DO UPDATE SET
            name = excluded.name,
            dept = CASE WHEN excluded.dept <> '' THEN excluded.dept ELSE students.dept END,
            phone = CASE WHEN excluded.phone <> '' THEN excluded.phone ELSE students.phone END,
            active = 1`
      ).bind(it.no, it.name, it.dept, it.phone, now, nowText);
    });
    await env.DB.batch(stmts);
    inserted += chunk.length;
  }

  // 同步刷新历史填报中的姓名（学生改名场景）
  await env.DB.prepare(
    'UPDATE records SET student_name = (SELECT s.name FROM students s WHERE s.student_no = records.student_no) ' +
    'WHERE EXISTS (SELECT 1 FROM students s WHERE s.student_no = records.student_no)'
  ).run();

  await writeLog(env, {
    operator: admin.name || '管理员',
    role: 'admin',
    action: ACTION.STUDENT_IMPORT,
    targetType: 'student',
    targetId: '',
    oldValue: mode === 'replace' ? '导入前已将全部名单置为停用' : '',
    newValue: '导入 ' + inserted + ' 条（模式：' + (mode === 'replace' ? '覆盖' : '追加/更新') + '）',
    reason: clean(body.reason, 200),
    ip: clientIp(context.request)
  });

  return ok({ inserted: inserted, errors: errors.slice(0, 20), error_count: errors.length });
}
