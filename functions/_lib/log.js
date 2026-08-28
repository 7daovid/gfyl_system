/**
 * 操作日志写入（只增不改不删；数据库层已加触发器保护）
 */
import { bjTime, clean } from './util.js';

export const ACTION = {
  RECORD_CREATE: '学生提交填报',
  RECORD_UPDATE: '学生修改填报',
  RECORD_DELETE: '学生删除填报',
  RECORD_ADMIN_DELETE: '管理员移除记录',
  RECORD_APPROVE: '审核通过',
  RECORD_ADJUST: '修改核算工时',

  RECORD_MERGE: '合并当日多条记录',
  RECORD_REOPEN: '撤销审核结果',
  WORKTYPE_CREATE: '新增工作类型',
  WORKTYPE_UPDATE: '修改工作类型/单价',
  WORKTYPE_DELETE: '停用工作类型',
  STUDENT_IMPORT: '导入学号白名单',
  STUDENT_UPDATE: '修改白名单',
  STUDENT_DELETE: '移除白名单',
  SETTING_UPDATE: '修改系统设置',
  ADMIN_LOGIN: '管理员登录',
  EXPORT: '导出报表'
};

export async function writeLog(env, entry) {
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO audit_logs
      (ts_ms, ts, operator, operator_role, action, target_type, target_id, old_value, new_value, reason, ip)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    now,
    bjTime(now),
    clean(entry.operator, 60) || '未知',
    clean(entry.role, 20) || 'system',
    clean(entry.action, 60),
    clean(entry.targetType, 30) || 'system',
    String(entry.targetId === undefined || entry.targetId === null ? '' : entry.targetId).slice(0, 60),
    clean(entry.oldValue, 900),
    clean(entry.newValue, 900),
    clean(entry.reason, 500),
    clean(entry.ip, 60)
  ).run();
}
