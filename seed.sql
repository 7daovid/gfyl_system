-- ============================================================
-- 初始化基础数据（工作类型 + 示例白名单）
-- 执行： wrangler d1 execute qgzx-hours --remote --file=./seed.sql
-- ============================================================

-- 两种工作类型（单价可在管理后台随时修改）
INSERT OR IGNORE INTO work_types (name, rate, sort_no, active, created_ms, created_at)
VALUES ('正常岗位工作', 20.0, 1, 1, 0, '初始化');

INSERT OR IGNORE INTO work_types (name, rate, sort_no, active, created_ms, created_at)
VALUES ('外勤体力任务', 30.0, 2, 1, 0, '初始化');

-- 示例白名单（正式使用请在后台"名单管理"里批量导入，然后删掉这两条）
INSERT OR IGNORE INTO students (student_no, name, dept, active, created_ms, created_at)
VALUES ('20230001', '张三', '计算机学院', 1, 0, '初始化');

INSERT OR IGNORE INTO students (student_no, name, dept, active, created_ms, created_at)
VALUES ('20230002', '李四', '外国语学院', 1, 0, '初始化');
