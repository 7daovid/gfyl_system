-- ============================================================
-- 小星星奖励机制 · 数据库迁移脚本（仅对已存在的旧库执行一次）
-- 新库直接用 schema.sql 即可（已包含 stars 列）
-- 执行： wrangler d1 execute qgzx-hours --remote --file=./migrate_stars.sql
-- 或本地： npm run db:init:local 之后执行：
--   wrangler d1 execute qgzx-hours --local --file=./migrate_stars.sql
-- 注意：若已执行过本脚本（列已存在）会报 duplicate column，属正常，可忽略。
-- ============================================================

-- 1. 给填报记录表增加「小星星数量」字段
ALTER TABLE records ADD COLUMN stars INTEGER NOT NULL DEFAULT 0;

-- 2. 初始化小星星单价（每颗价值，单位：元，默认 15）
INSERT OR IGNORE INTO settings (key, value, updated_at)
VALUES ('star_rate', '15', '');
