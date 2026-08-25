# 勤工助学工时填报系统

一套**全免费**的勤工助学工时填报与审核系统，运行在 **Cloudflare Pages + D1(SQLite)** 上，零付费依赖、零第三方运行库。

- 学生端：学号登录 → 填报工时 → 公开广场互相监督 → 个人记录（10 分钟内可改/删）
- 管理后台：密码登录 → 配置单价 → 审核/调整工时/驳回/合并 → 薪资统计 → 导出 Excel 双表 → 不可篡改操作日志
- 安全红线：**单价、核算工时、工资、操作日志仅管理员可见**；学生端接口通过「白名单式字段映射 + 目录级鉴权中间件」双重保证绝不返回金额字段。

---

## 一、目录结构

```
.
├── wrangler.toml            # Pages + D1 配置（含环境变量说明）
├── package.json             # dev / deploy / 数据库初始化脚本
├── schema.sql              # 建表 + 操作日志防删改触发器（可重复执行）
├── seed.sql                # 初始化工作类型 + 示例白名单
├── functions/              # Pages Functions（后端 API，纯原生 JS）
│   ├── _lib/               # 公共库：鉴权 / 工具 / 日志 / 零依赖 xlsx 生成
│   ├── api/
│   │   ├── _middleware.js  # 全局：CORS + 异常兜底 + DB 绑定检查
│   │   ├── auth/           # 学号登录 / 管理员登录 / 当前身份
│   │   ├── work-types.js   # 学生端类型下拉（不含单价）
│   │   ├── records/        # 填报 / 改 / 删 / 我的记录
│   │   ├── plaza.js        # 公开广场（仅 6 字段，近 30 天）
│   │   └── admin/          # 审核 / 名单 / 单价 / 统计导出 / 日志
│   │       └── _middleware.js  # 目录级：管理员鉴权（纵深防御）
└── public/                 # H5 前端（校园风格，移动端 + 微信浏览器适配）
    ├── index.html          # 登录页（学生 / 管理员入口）
    ├── student.html        # 学生端：填报 / 广场 / 我的
    ├── admin.html          # 管理后台：审核 / 名单 / 单价 / 统计 / 日志
    └── assets/             # style.css / app.js / student.js / admin.js
```

---

## 二、本地开发

```bash
# 1. 安装 wrangler（已包含在 devDependencies）
npm install -g wrangler         # 或 npm install

# 2. 创建 D1 数据库（记下返回的 database_id）
wrangler d1 create qgzx-hours

# 3. 把 database_id 填进 wrangler.toml 的 d1_databases.database_id
#    （或保留占位符，改用控制台绑定，见下文「线上部署」）

# 4. 初始化表结构 + 示例数据（本地 SQLite 模拟）
wrangler d1 execute qgzx-hours --local --file=./schema.sql
wrangler d1 execute qgzx-hours --local --file=./seed.sql

# 5. 设置本地管理员密码 / 签名密钥（本地用 .dev.vars 更方便）
echo "ADMIN_PASSWORD=admin123" > .dev.vars
echo "AUTH_SECRET=本地测试密钥" >> .dev.vars

# 6. 启动（默认 http://localhost:8788）
npm run dev
```

> 本地访问 `http://localhost:8788/` → 学号 `20230001` 登录填报；管理员用 `admin123` 登录后台。

---

## 三、线上部署（Cloudflare Pages）

### 1. 准备 D1
```bash
# 在 Cloudflare 账号下创建数据库
wrangler d1 create qgzx-hours
# 把返回的 id 写入 wrangler.toml 的 d1_databases.database_id
```

### 2. 初始化数据库（远程）
```bash
wrangler d1 execute qgzx-hours --remote --file=./schema.sql
wrangler d1 execute qgzx-hours --remote --file=./seed.sql
```

### 3. 设置密钥（敏感信息务必用 secret，不要写进 wrangler.toml）
```bash
wrangler pages secret put ADMIN_PASSWORD   # 后台登录密码
wrangler pages secret put AUTH_SECRET      # Token 签名密钥（任意长随机串）
```
> 不设置时：后台默认密码为 `admin123`，`AUTH_SECRET` 自动派生（**上线务必修改**，否则 Token 可被伪造）。

### 4. 部署
```bash
npm run deploy
# 或： wrangler pages deploy
```
部署后在 Cloudflare 控制台「Pages → 你的项目 → 设置 → 函数 → D1 数据库绑定」确认已绑定变量名为 **`DB`** 的 D1 数据库（与 wrangler.toml 中 `binding = "DB"` 一致）。若 wrangler.toml 未生效，也可直接在此处手动添加绑定。

### 5. 自定义域名（可选）
Pages → 自定义域 → 添加你的域名。微信里打开用你自己的域名最稳。

---

## 四、环境变量一览

| 变量 | 默认值 | 说明 |
|---|---|---|
| `ADMIN_PASSWORD` | `admin123` | 后台登录密码（务必改成强密码并设为 secret） |
| `AUTH_SECRET` | 由密码派生 | Token 签名密钥（务必设为强随机 secret） |
| `PLAZA_PUBLIC` | `0` | `1` 允许未登录浏览广场；`0` 必须登录（默认，符合"登录用户可读"） |
| `MAX_MINUTES_PER_RECORD` | `720` | 单条填报最大时长（分钟） |
| `BACKFILL_DAYS` | `31` | 允许补报的最长天数 |
| `EDIT_WINDOW_MINUTES` | `10` | 学生提交后可自助改/删的窗口（分钟） |

---

## 五、业务规则要点

1. **白名单优先**：学号必须在 `students` 表且 `active=1` 才能登录与填报；提交时还会再查一次，防止已停用的旧 Token 继续提交。
2. **公开广场只公开 6 字段**：姓名、学号、日期、填报时长、工作类型、备注。近 30 天、分页加载，绝不出现任何金额。
3. **原始填报永不被覆盖**：管理员核算写入 `approved_minutes`；学生看到的始终是 `minutes`。
4. **改工时强制留痕**：核算工时 ≠ 学生填报时必须填修改理由；驳回必须填驳回理由，均写入 `audit_logs`。
5. **日志不可篡改**：`audit_logs` 表上加了 `BEFORE UPDATE/DELETE` 触发器，任何修改/删除都会 `RAISE(ABORT)`；后端也完全不提供删除/修改日志的接口。
6. **合并**：同一学生、同一天的多条记录可合并为一条「已审核」，核算工时为各条之和；其余标记为已合并（核算 0），但**原始填报仍公开可见**，监督链不断。

---

## 六、API 速览

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| POST | `/api/auth/student-login` | 公开 | 学号登录（白名单校验） |
| POST | `/api/auth/admin-login` | 公开 | 管理员密码登录 |
| GET | `/api/auth/me` | 登录 | 当前身份 |
| GET | `/api/work-types` | 登录 | 类型下拉（**不含单价**） |
| POST | `/api/records/create` | 学生 | 提交填报 |
| POST | `/api/records/update` | 学生 | 10 分钟内修改 |
| POST | `/api/records/delete` | 学生 | 10 分钟内删除 |
| GET | `/api/records/mine` | 学生 | 我的记录（**不含工资**） |
| GET | `/api/plaza` | 登录 | 公开广场（仅 6 字段） |
| GET/POST | `/api/admin/*` | 管理员 | 审核/名单/单价/统计/日志/导出 |

---

## 七、常见问题

- **学生接口会不会泄露单价？** 不会。`/api/work-types` 只 `SELECT id, name` 并白名单式映射返回；敏感字段在 SQL 与序列化两层都被排除。`/api/admin/*` 之外的所有接口都不返回 `rate` / `approved_minutes` / 工资。
- **微信里导出 Excel 没反应？** 微信内置浏览器会拦截文件下载。导出报表请在电脑浏览器，或用手机系统浏览器 / Safari 打开本页面。
- **改了单价历史记录会变吗？** 不会自动变。导出核算表时按记录当时的 `work_type_id` 关联当前单价计算工资；类型改名会同步历史冗余名称，不影响时长。
- **操作日志能删吗？** 不能。数据库触发器 + 后端均无删除/修改入口。
