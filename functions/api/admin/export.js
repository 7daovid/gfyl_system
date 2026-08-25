/**
 * GET /api/admin/export?type=raw|audit&from&to
 * 导出 Excel（.xlsx，零第三方依赖自行生成）
 *   type=raw   → 原始填报表（学生填了什么，一字不改）
 *   type=audit → 审核核算表（核算工时 + 单价 + 应发金额 + 汇总页）
 *
 * 为控制 D1 读取量与 Worker 内存，分批 1000 条循环取，最多导出 MAX_ROWS 条。
 */
import {
  ok, clean, toInt, money, minutesToHours, minutesText, bjDate, bjDateOffset, ApiError, STATUS_TEXT, clientIp
} from '../../_lib/util.js';
import { buildXlsx, xlsxResponse } from '../../_lib/xlsx.js';
import { writeLog, ACTION } from '../../_lib/log.js';

const CHUNK = 1000;
const MAX_ROWS = 20000;

export async function onRequestGet(context) {
  const env = context.env;
  const admin = (context.data && context.data.admin) || { name: '管理员' };
  const url = new URL(context.request.url);

  const type = clean(url.searchParams.get('type'), 10) === 'audit' ? 'audit' : 'raw';
  let from = clean(url.searchParams.get('from'), 10);
  let to = clean(url.searchParams.get('to'), 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) from = bjDateOffset(-30);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(to)) to = bjDate();
  if (from > to) throw new ApiError('开始日期不能晚于结束日期', 400);

  const statusFilter = clean(url.searchParams.get('status'), 12);

  const where = ['r.work_date >= ?', 'r.work_date <= ?'];
  const args = [from, to];
  if (statusFilter === 'approved') {
    where.push('r.status = ?');
    args.push(statusFilter);
  }
  const whereSql = 'WHERE ' + where.join(' AND ');

  /* ---------------- 分批取数 ---------------- */
  const rows = [];
  let lastId = 0;
  while (rows.length < MAX_ROWS) {
    const sql =
      'SELECT r.*, COALESCE(w.rate, 0) AS rate FROM records r ' +
      'LEFT JOIN work_types w ON w.id = r.work_type_id ' +
      whereSql + ' AND r.id > ? ORDER BY r.id ASC LIMIT ?';
    const stmt = env.DB.prepare(sql);
    const batchArgs = args.concat([lastId, CHUNK]);
    const rs = await stmt.bind.apply(stmt, batchArgs).all();
    const part = rs.results || [];
    if (!part.length) break;
    for (let i = 0; i < part.length; i++) rows.push(part[i]);
    lastId = part[part.length - 1].id;
    if (part.length < CHUNK) break;
  }

  const range = from + '_至_' + to;
  let sheets;
  let filename;

  if (type === 'raw') {
    /* ============ 原始填报表 ============ */
    const header = ['序号', '学号', '姓名', '工作日期', '工作类型', '填报时长(小时)', '填报时长', '备注', '提交时间', '当前状态'];
    const data = rows.map(function (r, i) {
      return [
        i + 1,
        String(r.student_no),
        r.student_name,
        r.work_date,
        r.work_type_name,
        minutesToHours(r.minutes),
        minutesText(r.minutes),
        r.remark || '',
        r.created_at,
        STATUS_TEXT[r.status] || r.status
      ];
    });
    sheets = [{
      name: '原始填报',
      header: header,
      rows: data,
      widths: [6, 14, 10, 12, 16, 14, 14, 30, 20, 10]
    }];
    filename = '原始填报表_' + range + '.xlsx';
  } else {
    /* ============ 审核核算表 ============ */
    const header = [
      '序号', '学号', '姓名', '工作日期', '工作类型',
      '学生填报(小时)', '核算工时(小时)', '是否调整',
      '小时单价(元)', '应发金额(元)',
      '状态', '审核人', '审核时间', '备注'
    ];
    const data = [];
    const perStudent = {};

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const accMin = (r.approved_minutes === null || r.approved_minutes === undefined)
        ? toInt(r.minutes, 0) : toInt(r.approved_minutes, 0);
      const rate = Number(r.rate) || 0;
      const amount = r.status === 'approved' ? money(accMin / 60 * rate) : 0;
      const adjusted = (r.approved_minutes !== null && r.approved_minutes !== undefined &&
        toInt(r.approved_minutes, 0) !== toInt(r.minutes, 0)) ? '是' : '';

      data.push([
        i + 1,
        String(r.student_no),
        r.student_name,
        r.work_date,
        r.work_type_name,
        minutesToHours(r.minutes),
        minutesToHours(accMin),
        adjusted,
        rate,
        amount,
        STATUS_TEXT[r.status] || r.status,
        r.reviewer || '',
        r.reviewed_at || '',
        r.remark || ''
      ]);

      if (r.status === 'approved') {
        const k = r.student_no;
        if (!perStudent[k]) {
          perStudent[k] = { no: r.student_no, name: r.student_name, cnt: 0, accMin: 0, amount: 0 };
        }
        perStudent[k].cnt += 1;
        perStudent[k].accMin += accMin;
        perStudent[k].amount = money(perStudent[k].amount + amount);
      }
    }

    const sumRows = Object.keys(perStudent).map(function (k) { return perStudent[k]; })
      .sort(function (a, b) { return b.amount - a.amount; })
      .map(function (s, i) {
        return [i + 1, String(s.no), s.name, s.cnt, minutesToHours(s.accMin), s.amount];
      });

    let grandHours = 0, grandAmount = 0;
    for (let i = 0; i < sumRows.length; i++) {
      grandHours += Number(sumRows[i][4]) || 0;
      grandAmount += Number(sumRows[i][5]) || 0;
    }
    if (sumRows.length) {
      sumRows.push(['', '合计', '', '', Math.round(grandHours * 100) / 100, money(grandAmount)]);
    }

    sheets = [
      {
        name: '审核核算明细',
        header: header,
        rows: data,
        widths: [6, 14, 10, 12, 16, 14, 14, 10, 12, 12, 10, 10, 20, 24]
      },
      {
        name: '薪资汇总',
        header: ['序号', '学号', '姓名', '已审核条数', '核算工时(小时)', '应发金额(元)'],
        rows: sumRows,
        widths: [6, 16, 12, 14, 16, 16]
      }
    ];
    filename = '审核核算表_' + range + '.xlsx';
  }

  const bytes = buildXlsx(sheets);

  await writeLog(env, {
    operator: admin.name || '管理员',
    role: 'admin',
    action: ACTION.EXPORT,
    targetType: 'system',
    targetId: type,
    oldValue: '',
    newValue: (type === 'raw' ? '原始填报表' : '审核核算表') + ' / 区间 ' + from + '~' + to + ' / ' + rows.length + ' 条',
    reason: '',
    ip: clientIp(context.request)
  });

  return xlsxResponse(bytes, filename);
}
