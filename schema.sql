-- ============================================================
-- 勤工助学工时填报系统 · D1 (SQLite) 数据库结构
-- 执行： wrangler d1 execute qgzx-hours --remote --file=./schema.sql
-- 本脚本可重复执行（全部 IF NOT EXISTS）
-- ============================================================

-- ---------- 1. 勤工助学学号白名单 ----------
CREATE TABLE IF NOT EXISTS students (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  student_no  TEXT    NOT NULL UNIQUE,          -- 学号（登录凭证）
  name        TEXT    NOT NULL,                 -- 姓名
  dept        TEXT    NOT NULL DEFAULT '',      -- 院系/岗位部门
  active      INTEGER NOT NULL DEFAULT 1,       -- 1 启用 0 停用（停用后不可登录/填报）
  created_ms  INTEGER NOT NULL,
  created_at  TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_students_active ON students(active);
CREATE INDEX IF NOT EXISTS idx_students_name   ON students(name);

-- ---------- 2. 工作类型（含小时单价，仅管理员可见） ----------
CREATE TABLE IF NOT EXISTS work_types (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL UNIQUE,          -- 类型名称
  rate        REAL    NOT NULL DEFAULT 0,       -- 小时单价（元/小时）★敏感字段，学生接口绝不返回
  sort_no     INTEGER NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1,
  created_ms  INTEGER NOT NULL,
  created_at  TEXT    NOT NULL
);

-- ---------- 3. 原始填报记录 ----------
-- status: pending 待审核 / approved 已审核 / rejected 驳回 / merged 已被合并
CREATE TABLE IF NOT EXISTS records (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  student_no        TEXT    NOT NULL,
  student_name      TEXT    NOT NULL,           -- 冗余存姓名，避免广场页 join
  work_date         TEXT    NOT NULL,           -- YYYY-MM-DD
  start_time        TEXT    NOT NULL DEFAULT '', -- 开始时间 HH:MM（按时间段填报；留空表示旧数据）
  end_time          TEXT    NOT NULL DEFAULT '', -- 结束时间 HH:MM
  minutes           INTEGER NOT NULL,           -- 学生填报时长（分钟）★原始值，由 start/end 推算，永不被管理员覆盖
  work_type_id      INTEGER NOT NULL,
  work_type_name    TEXT    NOT NULL DEFAULT '',-- 冗余，防止类型改名影响历史
  remark            TEXT    NOT NULL DEFAULT '',
  stars             INTEGER NOT NULL DEFAULT 0, -- 该时间段获得的小星星数量（荣誉奖励，学生自愿填写）★学生接口只返回数量，绝不返回单价
  status            TEXT    NOT NULL DEFAULT 'pending',
  approved_minutes  INTEGER,                    -- 核算工时（分钟）★敏感字段，仅管理员可见
  reject_reason     TEXT    NOT NULL DEFAULT '',
  merged_into       INTEGER,                    -- 被合并到哪条记录的 id
  merged_count      INTEGER NOT NULL DEFAULT 0, -- 本条合并了几条（作为合并目标时）
  reviewer          TEXT    NOT NULL DEFAULT '',
  reviewed_ms       INTEGER,
  reviewed_at       TEXT    NOT NULL DEFAULT '',
  created_ms        INTEGER NOT NULL,
  created_at        TEXT    NOT NULL,
  updated_ms        INTEGER NOT NULL,
  updated_at        TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_records_date     ON records(work_date DESC);
CREATE INDEX IF NOT EXISTS idx_records_student  ON records(student_no, work_date DESC);
CREATE INDEX IF NOT EXISTS idx_records_status   ON records(status);
CREATE INDEX IF NOT EXISTS idx_records_created  ON records(created_ms DESC);

-- ---------- 4. 操作日志（不可删除、不可修改） ----------
CREATE TABLE IF NOT EXISTS audit_logs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  ts_ms         INTEGER NOT NULL,
  ts            TEXT    NOT NULL,               -- 北京时间
  operator      TEXT    NOT NULL,               -- 操作人
  operator_role TEXT    NOT NULL,               -- admin / student
  action        TEXT    NOT NULL,               -- 动作代码
  target_type   TEXT    NOT NULL,               -- record / work_type / student / system
  target_id     TEXT    NOT NULL DEFAULT '',
  old_value     TEXT    NOT NULL DEFAULT '',    -- 原值
  new_value     TEXT    NOT NULL DEFAULT '',    -- 修改后值
  reason        TEXT    NOT NULL DEFAULT '',    -- 修改/驳回理由
  ip            TEXT    NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_logs_ts     ON audit_logs(ts_ms DESC);
CREATE INDEX IF NOT EXISTS idx_logs_target ON audit_logs(target_type, target_id);

-- 数据库层面强制日志不可篡改：任何 UPDATE / DELETE 直接报错
DROP TRIGGER IF EXISTS trg_audit_logs_no_update;
CREATE TRIGGER trg_audit_logs_no_update
BEFORE UPDATE ON audit_logs
BEGIN
  SELECT RAISE(ABORT, '操作日志不可修改');
END;

DROP TRIGGER IF EXISTS trg_audit_logs_no_delete;
CREATE TRIGGER trg_audit_logs_no_delete
BEFORE DELETE ON audit_logs
BEGIN
  SELECT RAISE(ABORT, '操作日志不可删除');
END;

-- ---------- 5. 系统配置（预留：可在后台改管理员密码哈希等） ----------
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT ''
);
