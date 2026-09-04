-- ============================================================
-- 学生自助注册 + 老师审核 · 数据库迁移脚本（仅对已存在的旧库执行一次）
-- 新库直接用 schema.sql 即可（已包含 phone / reg_status 字段）
-- 执行： wrangler d1 execute qgzx-hours --remote --file=./migrate_students.sql
-- 或本地： wrangler d1 execute qgzx-hours --local --file=./migrate_students.sql
-- 注意：若已执行过本脚本（列已存在）会报 duplicate column，属正常，可忽略。
-- ============================================================

-- 1. 白名单表增加「联系方式」「注册审核状态」字段
ALTER TABLE students ADD COLUMN phone TEXT NOT NULL DEFAULT '';
ALTER TABLE students ADD COLUMN reg_status TEXT NOT NULL DEFAULT 'approved';

-- 2. 初始化注册邀请码（空 = 暂未开放注册，管理员可在后台设置）
INSERT OR IGNORE INTO settings (key, value, updated_at)
VALUES ('invite_code', '', '');
