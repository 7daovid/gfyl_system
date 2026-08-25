/* ============================================================
   管理后台逻辑：审核 / 名单 / 单价 / 统计导出 / 操作日志
   本页专属管理员，可见单价、核算工时、工资、操作日志
   ============================================================ */
(function () {
  var TITLES = { review: '填报审核', students: '名单管理', types: '单价配置', stats: '统计导出', logs: '操作日志' };

  App.guard('admin').then(function (d) {
    if (!d) return;
    bindTabs();
    bindCommon();
    loadReview();
    loadWorkTypes();
  });

  /* ---------------- 通用 ---------------- */
  function bindCommon() {
    document.getElementById('btn-out').onclick = function () {
      App.confirmBox('退出登录', '确定要退出管理后台吗？').then(function (yes) {
        if (yes) { App.clearAuth(); location.href = '/'; }
      });
    };
  }

  function bindTabs() {
    var tabs = document.querySelectorAll('#tabbar a');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].onclick = (function (btn) {
        return function () {
          for (var j = 0; j < tabs.length; j++) tabs[j].className = '';
          btn.className = 'on';
          switchView(btn.getAttribute('data-v'));
        };
      })(tabs[i]);
    }
  }

  var currentView = '';
  function switchView(v) {
    currentView = v;
    document.getElementById('view-title').textContent = TITLES[v] || '';
    var map = { review: 'v-review', students: 'v-students', types: 'v-types', stats: 'v-stats', logs: 'v-logs' };
    for (var k in map) {
      if (!map.hasOwnProperty(k)) continue;
      document.getElementById(map[k]).className = (k === v) ? '' : 'hide';
    }
    window.scrollTo(0, 0);
    if (v === 'review') loadReview();
    else if (v === 'students') loadStudents();
    else if (v === 'types') loadWorkTypes();
    else if (v === 'stats') loadStats();
    else if (v === 'logs') loadLogs();
  }

  /* ============================================================
     一、审核
     ============================================================ */
  var review = { page: 1, size: 20, total: 0, status: '', from: '', to: '', keyword: '' };

  function bindReview() {
    if (review.bound) return;
    review.bound = true;

    var chips = document.querySelectorAll('#rv-status button');
    for (var i = 0; i < chips.length; i++) {
      chips[i].onclick = (function (b) {
        return function () {
          for (var j = 0; j < chips.length; j++) chips[j].className = '';
          b.className = 'on';
          review.status = b.getAttribute('data-s');
          review.page = 1;
          loadReview();
        };
      })(chips[i]);
    }

    document.getElementById('rv-search').onclick = function () {
      review.from = document.getElementById('rv-from').value;
      review.to = document.getElementById('rv-to').value;
      review.keyword = document.getElementById('rv-key').value.trim();
      review.page = 1;
      loadReview();
    };
    document.getElementById('rv-reset').onclick = function () {
      document.getElementById('rv-from').value = '';
      document.getElementById('rv-to').value = '';
      document.getElementById('rv-key').value = '';
      review.from = ''; review.to = ''; review.keyword = '';
      review.page = 1;
      loadReview();
    };
  }

  function loadReview() {
    bindReview();
    var q = '/api/admin/records/list?page=' + review.page + '&size=' + review.size;
    if (review.status) q += '&status=' + encodeURIComponent(review.status);
    if (review.from) q += '&from=' + review.from;
    if (review.to) q += '&to=' + review.to;
    if (review.keyword) q += '&keyword=' + encodeURIComponent(review.keyword);

    App.get(q).then(function (d) {
      review.total = d.total || 0;
      var c = d.counter || {};
      document.getElementById('rv-stat').innerHTML =
        statBox(c.approved || 0, '已审核') + statBox(c.adjusted || 0, '已调整');

      var box = document.getElementById('rv-list');
      var list = d.list || [];
      if (!list.length) {
        box.innerHTML = '<div class="empty"><span class="ic">📋</span>没有符合条件的记录</div>';
      } else {
        var html = '';
        for (var i = 0; i < list.length; i++) html += reviewCard(list[i]);
        box.innerHTML = html;
        bindReviewCards(list);
      }
      renderReviewPager();
    }).catch(function (e) { App.toast(e.message); });
  }

  function reviewCard(r) {
    var adjTag = r.adjusted ? '<span class="badge b-warn">已调整</span>' : '';
    var slotText = (r.start_time && r.end_time)
      ? '<span>⏱ ' + App.esc(r.start_time) + '–' + App.esc(r.end_time) + '（' + App.esc(r.minutes_text) + '）</span>'
      : '<span>填报 <b>' + App.esc(r.minutes_text) + '</b></span>';

    var revBlock = (r.reviewer)
      ? '<div class="muted mt6">操作人：' + App.esc(r.reviewer) + ' · ' + App.esc(r.reviewed_at) + '</div>' : '';

    var btns =
      '<button class="btn btn-sm btn-ghost" data-adj="' + r.id + '">调整工时</button>' +
      '<button class="btn btn-sm btn-danger" data-del="' + r.id + '">移除</button>';

    return '<div class="item ' + r.status + '" data-row="' + r.id + '">' +
      '<div class="item-h"><div class="item-name">' + App.esc(r.student_name) +
        '<span class="item-no">' + App.esc(r.student_no) + '</span></div>' +
        '<span class="badge ' + App.statusClass(r.status) + '">' + App.esc(r.status_text) + '</span></div>' +
      '<div class="item-meta">' +
        '<span>📅 ' + App.esc(r.work_date) + '</span>' +
        '<span>' + App.esc(r.work_type_name) + '</span>' +
        slotText +
        (r.status === 'approved' ? '<span>核算 <b>' + App.esc(r.acc_hours) + '</b></span><span>单价 ¥' + App.esc(r.rate) + '/h</span><span>应发 <b>¥' + App.esc(r.amount) + '</b></span>' : '') +
      '</div>' +
      adjTag +
      (r.remark ? '<div class="item-remark">' + App.esc(r.remark) + '</div>' : '') +
      revBlock +
      '<div class="item-foot">' + btns + '</div>' +
    '</div>';
  }

  function bindReviewCards(list) {
    bindAction('[data-adj]', function (id, rec) { openAdjust(rec); });
    bindAction('[data-del]', function (id) { doRemove(id); });

    function bindAction(sel, fn) {
      var attr = sel.replace(/[\[\]"=]/g, ''); // [data-ok] -> data-ok
      var els = document.querySelectorAll('#rv-list ' + sel);
      for (var i = 0; i < els.length; i++) {
        els[i].onclick = (function (el) {
          return function () {
            var id = parseInt(el.getAttribute(attr), 10);
            var rec = null;
            for (var k = 0; k < list.length; k++) if (list[k].id === id) rec = list[k];
            fn(id, rec);
          };
        })(els[i]);
      }
    }
  }

  // 驳回 / 通过 / 撤销审核 已移除：记录提交即默认通过，老师不同意的记录直接「移除」即可。

  function openAdjust(rec) {
    var start = rec.start_time || '';
    var end = rec.end_time || '';
    if (!start || !end) {
      // 旧数据无时段，回退为按分钟调整
      var acc = rec.acc_minutes || rec.minutes;
      var rh = Math.floor(acc / 60), rm = acc % 60;
      var hOpt = '', mOpt = '';
      for (var i = 0; i <= 12; i++) hOpt += '<option value="' + i + '"' + (i === rh ? ' selected' : '') + '>' + i + '</option>';
      for (var j = 0; j < 60; j += 5) mOpt += '<option value="' + j + '"' + (j === rm ? ' selected' : '') + '>' + j + '</option>';
      var s2 = App.sheet(
        '<div class="sheet-t">调整核算工时 #' + rec.id + '</div>' +
        '<p class="sheet-sub">' + App.esc(rec.student_name) + ' · ' + App.esc(rec.work_date) +
          ' · 学生填报 ' + App.esc(rec.minutes_text) + '</p>' +
        '<div class="field"><label>核算工时（小时/分钟）</label><div class="row2">' +
          '<div class="inline-unit"><select data-h>' + hOpt + '</select><span>小时</span></div>' +
          '<div class="inline-unit"><select data-m>' + mOpt + '</select><span>分钟</span></div></div></div>' +
        '<div class="field"><label>修改理由（必填，不可删除的日志）</label><textarea data-r maxlength="300" placeholder="例如：含午休 1 小时，按实际核算"></textarea></div>' +
        '<div class="btn-row mt14"><button class="btn btn-line" style="flex:1" data-cancel>取消</button>' +
          '<button class="btn" style="flex:1" data-save>保存核算</button></div>'
      );
      s2.q('[data-cancel]').onclick = s2.close;
      s2.q('[data-save]').onclick = function () {
        var h = parseInt(s2.q('[data-h]').value, 10) || 0;
        var m = parseInt(s2.q('[data-m]').value, 10) || 0;
        var reason = s2.q('[data-r]').value.trim();
        if (h * 60 + m <= 0) { App.toast('核算工时必须大于 0'); return; }
        if (!reason) { App.toast('请填写修改理由'); return; }
        App.spin(true);
        App.post('/api/admin/records/review', { id: rec.id, action: 'adjust', hours: h, minutes: m, reason: reason })
          .then(function () { App.spin(false); s2.close(); App.toast('核算已更新'); loadReview(); })
          .catch(function (e) { App.spin(false); App.toast(e.message); });
      };
      return;
    }

    var s = App.sheet(
      '<div class="sheet-t">调整工时 #' + rec.id + '</div>' +
      '<p class="sheet-sub">' + App.esc(rec.student_name) + ' · ' + App.esc(rec.work_date) +
        ' · 当前 ' + App.esc(start) + '–' + App.esc(end) + '（' + App.esc(rec.minutes_text) + '）</p>' +
      '<div class="field"><label>开始时间</label><input type="time" step="600" data-st value="' + App.esc(start) + '"></div>' +
      '<div class="field"><label>结束时间</label><input type="time" step="600" data-et value="' + App.esc(end) + '"></div>' +
      '<div class="field"><label>修改理由（必填，不可删除的日志）</label><textarea data-r maxlength="300" placeholder="例如：实际到岗时间有出入，按考勤修正"></textarea></div>' +
      '<div class="btn-row mt14"><button class="btn btn-line" style="flex:1" data-cancel>取消</button>' +
        '<button class="btn" style="flex:1" data-save>保存工时</button></div>'
    );
    s.q('[data-cancel]').onclick = s.close;
    s.q('[data-save]').onclick = function () {
      var st = s.q('[data-st]').value;
      var et = s.q('[data-et]').value;
      var reason = s.q('[data-r]').value.trim();
      if (!st || !et) { App.toast('请填写起止时间'); return; }
      if (!reason) { App.toast('请填写修改理由'); return; }
      App.spin(true);
      App.post('/api/admin/records/review', { id: rec.id, action: 'adjust', start_time: st, end_time: et, reason: reason })
        .then(function () { App.spin(false); s.close(); App.toast('工时已更新'); loadReview(); })
        .catch(function (e) { App.spin(false); App.toast(e.message); });
    };
  }

  function doRemove(id) {
    App.confirmBox('移除记录', '确定要移除这条填报记录吗？该操作不可恢复，但会留下永久操作日志。').then(function (yes) {
      if (!yes) return;
      App.reasonBox('移除理由', '请填写移除理由（必填，写入不可删除的操作日志）。', '例如：重复填报、录入错误').then(function (reason) {
        if (reason === null) return;
        App.spin(true);
        App.post('/api/admin/records/delete', { id: id, reason: reason }).then(function () {
          App.spin(false); App.toast('已移除'); loadReview();
        }).catch(function (e) { App.spin(false); App.toast(e.message); });
      });
    });
  }

  function renderReviewPager() {
    var pages = Math.max(1, Math.ceil(review.total / review.size));
    document.getElementById('rv-pager').innerHTML =
      '<button ' + (review.page <= 1 ? 'disabled' : '') + ' data-prev>上一页</button>' +
      '<span>' + review.page + ' / ' + pages + '（共 ' + review.total + ' 条）</span>' +
      '<button ' + (review.page >= pages ? 'disabled' : '') + ' data-next>下一页</button>';
    var p = document.querySelector('#rv-pager [data-prev]');
    var n = document.querySelector('#rv-pager [data-next]');
    if (p) p.onclick = function () { if (review.page > 1) { review.page--; loadReview(); window.scrollTo(0, 0); } };
    if (n) n.onclick = function () { if (review.page < pages) { review.page++; loadReview(); window.scrollTo(0, 0); } };
  }

  /* ============================================================
     二、名单管理
     ============================================================ */
  var students = { page: 1, size: 20, total: 0, keyword: '', active: '' };

  function bindStudents() {
    if (students.bound) return;
    students.bound = true;
    document.getElementById('st-import').onclick = importStudents;
    document.getElementById('st-search').onclick = function () {
      students.keyword = document.getElementById('st-key').value.trim();
      students.active = document.getElementById('st-active').value;
      students.page = 1; loadStudents();
    };
    document.getElementById('st-add').onclick = function () { openStudentSheet(null); };
  }

  function loadStudents() {
    bindStudents();
    App.get('/api/admin/students/list?page=' + students.page + '&size=' + students.size +
      (students.keyword ? '&keyword=' + encodeURIComponent(students.keyword) : '') +
      (students.active ? '&active=' + students.active : '')
    ).then(function (d) {
      students.total = d.total || 0;
      var st = d.stat || {};
      document.getElementById('st-stat').textContent = '名单总数 ' + (st.total || 0) + ' 人，其中启用 ' + (st.active || 0) + ' 人。';

      var box = document.getElementById('st-list');
      var list = d.list || [];
      if (!list.length) {
        box.innerHTML = '<div class="empty"><span class="ic">👥</span>没有匹配的名单记录</div>';
      } else {
        var html = '';
        for (var i = 0; i < list.length; i++) {
          var s = list[i];
          html += '<div class="item">' +
            '<div class="item-h"><div class="item-name">' + App.esc(s.name) +
              '<span class="item-no">' + App.esc(s.student_no) + '</span></div>' +
              '<span class="badge ' + (s.active ? 'b-approved' : 'b-pending') + '">' + (s.active ? '启用' : '停用') + '</span></div>' +
            (s.dept ? '<div class="muted mt4">' + App.esc(s.dept) + '</div>' : '') +
            '<div class="item-foot">' +
              '<button class="btn btn-sm btn-ghost" data-edit="' + s.id + '">编辑</button>' +
              '<button class="btn btn-sm btn-line" data-del="' + s.id + '">移除</button>' +
            '</div></div>';
        }
        box.innerHTML = html;
        var eds = document.querySelectorAll('#st-list [data-edit]');
        for (var e = 0; e < eds.length; e++) {
          eds[e].onclick = (function (el) {
            return function () {
              var id = parseInt(el.getAttribute('data-edit'), 10);
              var rec = null;
              for (var k = 0; k < list.length; k++) if (list[k].id === id) rec = list[k];
              openStudentSheet(rec);
            };
          })(eds[e]);
        }
        var dels = document.querySelectorAll('#st-list [data-del]');
        for (var x = 0; x < dels.length; x++) {
          dels[x].onclick = (function (el) {
            return function () {
              var id = parseInt(el.getAttribute('data-del'), 10);
              App.confirmBox('移出白名单', '有填报记录的学号只会停用（保留历史），无记录的会彻底移除。确定继续？').then(function (yes) {
                if (!yes) return;
                App.reasonBox('移除理由', '请填写移出白名单的理由（写入操作日志）。', '例如：已毕业离岗').then(function (reason) {
                  if (reason === null) return;
                  App.spin(true);
                  App.post('/api/admin/students/delete', { id: id, reason: reason }).then(function () {
                    App.spin(false); App.toast('已处理'); loadStudents();
                  }).catch(function (e2) { App.spin(false); App.toast(e2.message); });
                });
              });
            };
          })(dels[x]);
        }
      }
      renderStudentPager();
    }).catch(function (e) { App.toast(e.message); });
  }

  function importStudents() {
    var text = document.getElementById('st-text').value;
    var mode = document.getElementById('st-mode').value;
    if (!text.trim()) { App.toast('请粘贴名单内容'); return; }
    App.confirmBox('确认导入', '共将解析文本框内所有行，模式：' + (mode === 'replace' ? '覆盖（先停用旧名单）' : '追加/更新') + '。继续？')
      .then(function (yes) {
        if (!yes) return;
        App.spin(true);
        App.post('/api/admin/students/import', { text: text, mode: mode }).then(function (d) {
          App.spin(false);
          var msg = '成功导入 ' + d.inserted + ' 条';
          if (d.error_count) msg += '，' + d.error_count + ' 行有误（如：' + (d.errors[0] || '') + '）';
          App.toast(msg, 3200);
          document.getElementById('st-text').value = '';
          loadStudents();
        }).catch(function (e) { App.spin(false); App.toast(e.message); });
      });
  }

  function openStudentSheet(rec) {
    var isEdit = !!rec;
    var s = App.sheet(
      '<div class="sheet-t">' + (isEdit ? '编辑名单' : '新增白名单') + '</div>' +
      '<div class="field"><label>学号</label><input data-no value="' + (isEdit ? App.esc(rec.student_no) : '') + '" placeholder="学号"></div>' +
      '<div class="field"><label>姓名</label><input data-name value="' + (isEdit ? App.esc(rec.name) : '') + '" placeholder="姓名"></div>' +
      '<div class="field"><label>院系（可选）</label><input data-dept value="' + (isEdit ? App.esc(rec.dept) : '') + '" placeholder="院系"></div>' +
      '<div class="field"><label>状态</label><select data-active>' +
        '<option value="1"' + (isEdit ? (rec.active ? ' selected' : '') : ' selected') + '>启用</option>' +
        '<option value="0"' + (isEdit ? (rec.active ? '' : ' selected') : '') + '>停用</option>' +
      '</select></div>' +
      '<div class="btn-row mt14"><button class="btn btn-line" style="flex:1" data-cancel>取消</button>' +
        '<button class="btn" style="flex:1" data-save>保存</button></div>'
    );
    s.q('[data-cancel]').onclick = s.close;
    s.q('[data-save]').onclick = function () {
      var body = {
        student_no: s.q('[data-no]').value.trim(),
        name: s.q('[data-name]').value.trim(),
        dept: s.q('[data-dept]').value.trim(),
        active: parseInt(s.q('[data-active]').value, 10) || 0
      };
      if (isEdit) body.id = rec.id;
      if (!body.student_no) { App.toast('请输入学号'); return; }
      if (!body.name) { App.toast('请输入姓名'); return; }
      App.spin(true);
      App.post('/api/admin/students/save', body).then(function () {
        App.spin(false); s.close(); App.toast('已保存'); loadStudents();
      }).catch(function (e) { App.spin(false); App.toast(e.message); });
    };
  }

  function renderStudentPager() {
    var pages = Math.max(1, Math.ceil(students.total / students.size));
    document.getElementById('st-pager').innerHTML =
      '<button ' + (students.page <= 1 ? 'disabled' : '') + ' data-prev>上一页</button>' +
      '<span>' + students.page + ' / ' + pages + '（共 ' + students.total + ' 条）</span>' +
      '<button ' + (students.page >= pages ? 'disabled' : '') + ' data-next>下一页</button>';
    var p = document.querySelector('#st-pager [data-prev]');
    var n = document.querySelector('#st-pager [data-next]');
    if (p) p.onclick = function () { if (students.page > 1) { students.page--; loadStudents(); window.scrollTo(0, 0); } };
    if (n) n.onclick = function () { if (students.page < pages) { students.page++; loadStudents(); window.scrollTo(0, 0); } };
  }

  /* ============================================================
     三、工作类型与单价
     ============================================================ */
  function loadWorkTypes() {
    App.get('/api/admin/work-types/list').then(function (d) {
      var list = d.list || [];
      var box = document.getElementById('wt-list');
      if (!list.length) {
        box.innerHTML = '<div class="empty"><span class="ic">💰</span>尚未配置工作类型</div>';
        return;
      }
      var html = '';
      for (var i = 0; i < list.length; i++) {
        var t = list[i];
        html += '<div class="item">' +
          '<div class="item-h"><div class="item-name">' + App.esc(t.name) +
            '<span class="item-no">排序 ' + t.sort_no + '</span></div>' +
            '<span class="badge ' + (t.active ? 'b-approved' : 'b-pending') + '">' + (t.active ? '启用' : '停用') + '</span></div>' +
          '<div class="item-meta"><span>小时单价 <b>¥' + App.esc(t.rate) + '</b></span>' +
            '<span>历史填报 ' + t.used_count + ' 条</span></div>' +
          '<div class="item-foot">' +
            '<button class="btn btn-sm btn-ghost" data-edit="' + t.id + '">编辑</button>' +
            '<button class="btn btn-sm btn-line" data-del="' + t.id + '">删除/停用</button>' +
          '</div></div>';
      }
      box.innerHTML = html;
      var eds = document.querySelectorAll('#wt-list [data-edit]');
      for (var e = 0; e < eds.length; e++) {
        eds[e].onclick = (function (el) {
          return function () {
            var id = parseInt(el.getAttribute('data-edit'), 10);
            var rec = null;
            for (var k = 0; k < list.length; k++) if (list[k].id === id) rec = list[k];
            openTypeSheet(rec);
          };
        })(eds[e]);
      }
      var dels = document.querySelectorAll('#wt-list [data-del]');
      for (var x = 0; x < dels.length; x++) {
        dels[x].onclick = (function (el) {
          return function () {
            var id = parseInt(el.getAttribute('data-del'), 10);
            App.reasonBox('删除 / 停用工种', '有历史填报引用的工种只会停用（保留数据），无引用的可彻底删除。请填写理由。', '例如：该岗位已取消').then(function (reason) {
              if (reason === null) return;
              App.spin(true);
              App.post('/api/admin/work-types/delete', { id: id, reason: reason }).then(function () {
                App.spin(false); App.toast('已处理'); loadWorkTypes();
              }).catch(function (e2) { App.spin(false); App.toast(e2.message); });
            });
          };
        })(dels[x]);
      }
    }).catch(function (e) { App.toast(e.message); });

    document.getElementById('wt-add').onclick = function () { openTypeSheet(null); };
  }

  function openTypeSheet(rec) {
    var isEdit = !!rec;
    var s = App.sheet(
      '<div class="sheet-t">' + (isEdit ? '编辑工作类型' : '新增工作类型') + '</div>' +
      '<div class="field"><label>类型名称</label><input data-name value="' + (isEdit ? App.esc(rec.name) : '') + '" placeholder="如：正常岗位工作"></div>' +
      '<div class="field"><label>小时单价（元/小时，仅管理员可见）</label><input type="number" step="0.5" min="0" data-rate value="' + (isEdit ? App.esc(rec.rate) : '0') + '" placeholder="0"></div>' +
      '<div class="field"><label>排序号</label><input type="number" min="0" data-sort value="' + (isEdit ? App.esc(rec.sort_no) : '0') + '"></div>' +
      '<div class="field"><label>状态</label><select data-active>' +
        '<option value="1"' + (isEdit ? (rec.active ? ' selected' : '') : ' selected') + '>启用</option>' +
        '<option value="0"' + (isEdit ? (rec.active ? '' : ' selected') : '') + '>停用</option>' +
      '</select></div>' +
      '<div class="btn-row mt14"><button class="btn btn-line" style="flex:1" data-cancel>取消</button>' +
        '<button class="btn" style="flex:1" data-save>保存</button></div>'
    );
    s.q('[data-cancel]').onclick = s.close;
    s.q('[data-save]').onclick = function () {
      var body = {
        name: s.q('[data-name]').value.trim(),
        rate: parseFloat(s.q('[data-rate]').value) || 0,
        sort_no: parseInt(s.q('[data-sort]').value, 10) || 0,
        active: parseInt(s.q('[data-active]').value, 10) || 0
      };
      if (isEdit) body.id = rec.id;
      if (!body.name) { App.toast('请输入类型名称'); return; }
      App.spin(true);
      App.post('/api/admin/work-types/save', body).then(function () {
        App.spin(false); s.close(); App.toast('已保存'); loadWorkTypes();
      }).catch(function (e) { App.spin(false); App.toast(e.message); });
    };
  }

  /* ============================================================
     四、统计与导出
     ============================================================ */
  var stats = { from: '', to: '', keyword: '', page: 1, size: 20, total: 0 };

  function bindStats() {
    if (stats.bound) return;
    stats.bound = true;
    document.getElementById('sx-go').onclick = function () {
      stats.from = document.getElementById('sx-from').value;
      stats.to = document.getElementById('sx-to').value;
      stats.page = 1; loadStats();
    };
    document.getElementById('sx-month').onclick = function () {
      var d = new Date(Date.now() + 8 * 3600000);
      var m = ('0' + (d.getMonth() + 1)).slice(-2);
      stats.from = d.getFullYear() + '-' + m + '-01';
      stats.to = '';
      document.getElementById('sx-from').value = stats.from;
      document.getElementById('sx-to').value = '';
      loadStats();
    };
    document.getElementById('sx-30').onclick = function () {
      stats.from = App.dateOffset(-30);
      stats.to = '';
      document.getElementById('sx-from').value = stats.from;
      document.getElementById('sx-to').value = '';
      loadStats();
    };
    document.getElementById('sx-exp-raw').onclick = function () {
      App.download('/api/admin/export?type=raw' + rangeQ());
    };
    document.getElementById('sx-exp-audit').onclick = function () {
      App.download('/api/admin/export?type=audit' + rangeQ());
    };
  }

  function rangeQ() {
    var q = '';
    if (stats.from) q += '&from=' + stats.from;
    if (stats.to) q += '&to=' + stats.to;
    return q;
  }

  function loadStats() {
    bindStats();
    App.get('/api/admin/stats?page=' + stats.page + '&size=' + stats.size + rangeQ()).then(function (d) {
      stats.total = d.total || 0;
      var s = d.summary || {};
      document.getElementById('sx-stat').innerHTML =
        statBox(s.students || 0, '参与学生') +
        statBox(s.records || 0, '已审核记录') +
        statBox(s.acc_hours || 0, '核算总时长') +
        statBox('¥' + (s.wage || 0), '应发工资') +
        statBox(s.pending || 0, '待审核');

      // 按类型
      var trows = (d.by_type || []).map(function (t) {
        return '<tr><td>' + App.esc(t.name) + '</td><td>¥' + t.rate + '/h</td><td>' + t.count + '</td><td>' + t.acc_hours + '</td><td>¥' + t.wage + '</td></tr>';
      }).join('');
      document.getElementById('sx-type').innerHTML =
        '<thead><tr><th>类型</th><th>单价</th><th>条数</th><th>核算时长</th><th>应发</th></tr></thead><tbody>' +
        (trows || '<tr><td colspan="5" class="muted">无数据</td></tr>') + '</tbody>';

      // 按学生
      var rows = (d.list || []).map(function (r) {
        return '<tr><td>' + App.esc(r.student_name) + '</td><td>' + App.esc(r.student_no) + '</td><td>' + r.count + '</td>' +
          '<td>' + r.acc_hours + '</td><td>¥' + r.wage + '</td></tr>';
      }).join('');
      document.getElementById('sx-tbl').innerHTML =
        '<thead><tr><th>姓名</th><th>学号</th><th>条数</th><th>核算时长</th><th>应发</th></tr></thead><tbody>' +
        (rows || '<tr><td colspan="5" class="muted">无数据</td></tr>') + '</tbody>';

      renderStatsPager();
    }).catch(function (e) { App.toast(e.message); });
  }

  function renderStatsPager() {
    var pages = Math.max(1, Math.ceil(stats.total / stats.size));
    document.getElementById('sx-pager').innerHTML =
      '<button ' + (stats.page <= 1 ? 'disabled' : '') + ' data-prev>上一页</button>' +
      '<span>' + stats.page + ' / ' + pages + '（共 ' + stats.total + ' 名学生）</span>' +
      '<button ' + (stats.page >= pages ? 'disabled' : '') + ' data-next>下一页</button>';
    var p = document.querySelector('#sx-pager [data-prev]');
    var n = document.querySelector('#sx-pager [data-next]');
    if (p) p.onclick = function () { if (stats.page > 1) { stats.page--; loadStats(); window.scrollTo(0, 0); } };
    if (n) n.onclick = function () { if (stats.page < pages) { stats.page++; loadStats(); window.scrollTo(0, 0); } };
  }

  /* ============================================================
     五、操作日志
     ============================================================ */
  var logs = { page: 1, size: 20, total: 0, from: '', to: '', keyword: '', action: '' };

  function bindLogs() {
    if (logs.bound) return;
    logs.bound = true;
    document.getElementById('lg-search').onclick = function () {
      logs.from = document.getElementById('lg-from').value;
      logs.to = document.getElementById('lg-to').value;
      logs.keyword = document.getElementById('lg-key').value.trim();
      logs.action = document.getElementById('lg-action').value;
      logs.page = 1; loadLogs();
    };
    document.getElementById('lg-reset').onclick = function () {
      document.getElementById('lg-from').value = '';
      document.getElementById('lg-to').value = '';
      document.getElementById('lg-key').value = '';
      document.getElementById('lg-action').value = '';
      logs.from = ''; logs.to = ''; logs.keyword = ''; logs.action = '';
      logs.page = 1; loadLogs();
    };
  }

  function loadLogs() {
    bindLogs();
    // 首次加载填充动作下拉
    App.get('/api/admin/logs?page=1&size=1').then(fillActions).catch(function () {});

    var q = '/api/admin/logs?page=' + logs.page + '&size=' + logs.size;
    if (logs.from) q += '&from=' + logs.from;
    if (logs.to) q += '&to=' + logs.to;
    if (logs.keyword) q += '&keyword=' + encodeURIComponent(logs.keyword);
    if (logs.action) q += '&action=' + encodeURIComponent(logs.action);

    App.get(q).then(function (d) {
      logs.total = d.total || 0;
      fillActions(d);
      var box = document.getElementById('lg-list');
      var list = d.list || [];
      if (!list.length) {
        box.innerHTML = '<div class="empty"><span class="ic">🗂️</span>没有符合条件的日志</div>';
      } else {
        var html = '';
        for (var i = 0; i < list.length; i++) {
          var L = list[i];
          html += '<div class="log-item">' +
            '<div class="log-h"><span class="log-act">' + App.esc(L.action) + '</span>' +
              '<span class="muted">' + App.esc(L.ts) + '</span></div>' +
            '<div class="log-meta">操作人：' + App.esc(L.operator) + ' · 角色：' + App.esc(L.operator_role) +
              ' · 对象：' + App.esc(L.target_type) + (L.target_id ? ' #' + App.esc(L.target_id) : '') +
              (L.ip ? ' · IP ' + App.esc(L.ip) : '') + '</div>' +
            (L.old_value ? '<div class="log-val">原值：' + App.esc(L.old_value) + '</div>' : '') +
            (L.new_value ? '<div class="log-val">改后：' + App.esc(L.new_value) + '</div>' : '') +
            (L.reason ? '<div class="log-reason">理由：' + App.esc(L.reason) + '</div>' : '') +
          '</div>';
        }
        box.innerHTML = html;
      }
      renderLogsPager();
    }).catch(function (e) { App.toast(e.message); });
  }

  function fillActions(d) {
    if (!d || !d.actions) return;
    var sel = document.getElementById('lg-action');
    if (!sel || sel.dataset.filled) return;
    var cur = sel.value;
    var html = '<option value="">全部动作</option>';
    for (var i = 0; i < d.actions.length; i++) {
      html += '<option value="' + App.esc(d.actions[i].action) + '">' + App.esc(d.actions[i].action) + '（' + d.actions[i].count + '）</option>';
    }
    sel.innerHTML = html;
    sel.value = cur;
    sel.dataset.filled = '1';
  }

  function renderLogsPager() {
    var pages = Math.max(1, Math.ceil(logs.total / logs.size));
    document.getElementById('lg-pager').innerHTML =
      '<button ' + (logs.page <= 1 ? 'disabled' : '') + ' data-prev>上一页</button>' +
      '<span>' + logs.page + ' / ' + pages + '（共 ' + logs.total + ' 条）</span>' +
      '<button ' + (logs.page >= pages ? 'disabled' : '') + ' data-next>下一页</button>';
    var p = document.querySelector('#lg-pager [data-prev]');
    var n = document.querySelector('#lg-pager [data-next]');
    if (p) p.onclick = function () { if (logs.page > 1) { logs.page--; loadLogs(); window.scrollTo(0, 0); } };
    if (n) n.onclick = function () { if (logs.page < pages) { logs.page++; loadLogs(); window.scrollTo(0, 0); } };
  }

  /* ---------------- 小工具 ---------------- */
  function statBox(v, k) {
    return '<div class="stat"><div class="v">' + App.esc(v) + '</div><div class="k">' + App.esc(k) + '</div></div>';
  }
})();
