/* ============================================================
   学生端逻辑：填报（按时间段）/ 公开广场 / 我的记录
   注意：本文件不涉及任何单价、工资、核算工时字段
   ============================================================ */
(function () {
  var me = null;
  var workTypes = [];
  var editWindow = 10;

  var plaza = { page: 1, size: 20, loading: false, end: false, keyword: '', date: '' };
  var mine = { page: 1, size: 20, total: 0, status: '' };

  var TITLES = { report: '工时填报', plaza: '公开广场', mine: '我的记录' };

  /* ---------------- 初始化 ---------------- */
  App.guard('student').then(function (d) {
    if (!d) return;
    me = d;
    document.getElementById('who').textContent = d.name + ' · ' + d.student_no + (d.dept ? ' · ' + d.dept : '');
    document.getElementById('f-date').value = App.todayStr();
    document.getElementById('f-date').max = App.todayStr();
    bind();
    // 必须先拿到管理员配置的工作类型，再渲染默认时间段，否则下拉为空无法提交
    loadTypes().then(addSegment).catch(function () { addSegment(); });
  });

  function bind() {
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

    document.getElementById('btn-out').onclick = function () {
      App.confirmBox('退出登录', '确定要退出当前学号吗？').then(function (yes) {
        if (yes) { App.clearAuth(); location.href = '/'; }
      });
    };

    document.getElementById('btn-add-seg').onclick = addSegment;
    document.getElementById('btn-submit').onclick = submitRecord;

    document.getElementById('p-search').onclick = function () {
      plaza.keyword = document.getElementById('p-key').value.trim();
      plaza.date = document.getElementById('p-date').value;
      resetPlaza();
    };
    document.getElementById('p-reset').onclick = function () {
      document.getElementById('p-key').value = '';
      document.getElementById('p-date').value = '';
      plaza.keyword = ''; plaza.date = '';
      resetPlaza();
    };

    var fbtns = document.querySelectorAll('#mine-filter button');
    for (var k = 0; k < fbtns.length; k++) {
      fbtns[k].onclick = (function (b) {
        return function () {
          for (var x = 0; x < fbtns.length; x++) fbtns[x].className = '';
          b.className = 'on';
          mine.status = b.getAttribute('data-s');
          mine.page = 1;
          renderMine();
        };
      })(fbtns[k]);
    }

    window.addEventListener('scroll', function () {
      if (currentView !== 'plaza') return;
      if (window.innerHeight + window.pageYOffset >= document.body.offsetHeight - 260) loadPlaza();
    });
  }

  var currentView = 'report';
  function switchView(v) {
    currentView = v;
    document.getElementById('view-title').textContent = TITLES[v] || '';
    document.getElementById('v-report').className = v === 'report' ? '' : 'hide';
    document.getElementById('v-plaza').className = v === 'plaza' ? '' : 'hide';
    document.getElementById('v-mine').className = v === 'mine' ? '' : 'hide';
    window.scrollTo(0, 0);
    if (v === 'plaza' && !plaza.loaded) { plaza.loaded = true; loadPlaza(); }
    if (v === 'mine') loadMine();
  }

  /* ---------------- 工作类型 ---------------- */
  function loadTypes() {
    return App.get('/api/work-types').then(function (d) {
      workTypes = d.list || [];
    }).catch(function (e) { App.toast(e.message); });
  }

  function typeOptionsHtml() {
    if (!workTypes.length) return '<option value="">（管理员未配置类型）</option>';
    var s = '';
    for (var i = 0; i < workTypes.length; i++) {
      s += '<option value="' + workTypes[i].id + '"' + (i === 0 ? ' selected' : '') + '>' + App.esc(workTypes[i].name) + '</option>';
    }
    return s;
  }

  /* ---------------- 时间段 ---------------- */
  function addSegment() {
    var idx = document.querySelectorAll('#seg-wrap .tslot').length + 1;
    var div = document.createElement('div');
    div.className = 'tslot';
    div.innerHTML =
      '<div class="ts-h"><span class="ts-no">时间段 ' + idx + '</span>' +
        (idx > 1 ? '<button type="button" class="ts-del" data-del-seg>✕</button>' : '<span></span>') +
      '</div>' +
      '<div class="row2">' +
        '<div class="field" style="margin:0"><label>开始</label><input type="time" step="600" data-st></div>' +
        '<div class="field" style="margin:0"><label>结束</label><input type="time" step="600" data-et></div>' +
      '</div>' +
      '<div class="quick-times">' +
        '<button type="button" class="qt-btn" data-qt="08:10,11:30">正常上午</button>' +
        '<button type="button" class="qt-btn" data-qt="13:40,17:00">正常下午</button>' +
        '<button type="button" class="qt-btn" data-qt="08:30,11:30">暑期上午</button>' +
        '<button type="button" class="qt-btn" data-qt="14:00,17:00">暑期下午</button>' +
      '</div>' +
      '<div class="field" style="margin:8px 0 0"><label>工作类型 <span class="req">*</span></label><select data-ty>' + typeOptionsHtml() + '</select></div>' +
      '<div class="field" style="margin:8px 0 0"><label>备注（可选）</label><textarea data-rm maxlength="200" placeholder="本时间段工作内容，例如：图书馆三楼书籍整理"></textarea></div>';

    if (idx > 1) {
      div.querySelector('[data-del-seg]').onclick = function () {
        if (div.parentNode) div.parentNode.removeChild(div);
        reIndex();
      };
    }

    // 绑定快捷时间段按钮
    var qtBtns = div.querySelectorAll('.qt-btn');
    for (var q = 0; q < qtBtns.length; q++) {
      qtBtns[q].onclick = (function (btn) {
        return function () {
          var parts = btn.getAttribute('data-qt').split(',');
          div.querySelector('[data-st]').value = parts[0];
          div.querySelector('[data-et]').value = parts[1];
        };
      })(qtBtns[q]);
    }

    document.getElementById('seg-wrap').appendChild(div);
  }

  function reIndex() {
    var segs = document.querySelectorAll('#seg-wrap .tslot');
    for (var i = 0; i < segs.length; i++) {
      var n = segs[i].querySelector('.ts-no');
      if (n) n.textContent = '时间段 ' + (i + 1);
      var del = segs[i].querySelector('[data-del-seg]');
      if (del) del.style.display = (i === 0 ? 'none' : '');
    }
  }

  /* ---------------- 提交填报 ---------------- */
  function submitRecord() {
    var date = document.getElementById('f-date').value;
    if (!date) { App.toast('请选择工作日期'); return; }

    var segs = document.querySelectorAll('#seg-wrap .tslot');
    if (!segs.length) { App.toast('请至少添加一个时间段'); return; }

    var segments = [];
    for (var i = 0; i < segs.length; i++) {
      var st = segs[i].querySelector('[data-st]').value;
      var et = segs[i].querySelector('[data-et]').value;
      var ty = parseInt(segs[i].querySelector('[data-ty]').value, 10) || 0;
      var rm = segs[i].querySelector('[data-rm]').value.trim();
      if (!st || !et) { App.toast('请填写第 ' + (i + 1) + ' 个时间段的起止时间'); return; }
      if (!ty) { App.toast('请选择第 ' + (i + 1) + ' 个时间段的工作类型'); return; }
      segments.push({ start_time: st, end_time: et, work_type_id: ty, remark: rm });
    }

    var btn = document.getElementById('btn-submit');
    btn.disabled = true;
    App.spin(true);
    App.post('/api/records/create', { work_date: date, segments: segments }).then(function (d) {
      App.spin(false);
      btn.disabled = false;
      editWindow = d.edit_window_minutes || 10;
      document.getElementById('win-tip').textContent = editWindow;
      document.getElementById('seg-wrap').innerHTML = '';
      addSegment();
      App.toast('提交成功（' + d.count + ' 个时间段），' + editWindow + ' 分钟内可修改', 2600);
      plaza.loaded = false;
      setTimeout(function () {
        var tabs = document.querySelectorAll('#tabbar a');
        for (var i = 0; i < tabs.length; i++) tabs[i].className = tabs[i].getAttribute('data-v') === 'mine' ? 'on' : '';
        switchView('mine');
      }, 700);
    }).catch(function (e) {
      App.spin(false);
      btn.disabled = false;
      App.toast(e.message || '提交失败');
    });
  }

  /* ---------------- 公开广场 ---------------- */
  function resetPlaza() {
    plaza.page = 1; plaza.end = false;
    document.getElementById('plaza-list').innerHTML = '';
    loadPlaza();
  }

  function loadPlaza() {
    if (plaza.loading || plaza.end) return;
    plaza.loading = true;
    document.getElementById('plaza-more').textContent = '加载中…';

    var q = '/api/plaza?page=' + plaza.page + '&size=' + plaza.size;
    if (plaza.keyword) q += '&keyword=' + encodeURIComponent(plaza.keyword);
    if (plaza.date) q += '&date=' + encodeURIComponent(plaza.date);

    App.get(q).then(function (d) {
      plaza.loading = false;
      var box = document.getElementById('plaza-list');
      var list = d.list || [];

      if (plaza.page === 1 && !list.length) {
        box.innerHTML = '<div class="empty"><span class="ic">🗒️</span>暂无填报记录</div>';
        document.getElementById('plaza-more').textContent = '';
        plaza.end = true;
        return;
      }

      var html = '';
      for (var i = 0; i < list.length; i++) {
        var r = list[i];
        var when = r.time_range
          ? '<span>⏱ ' + App.esc(r.time_range) + '（' + App.esc(r.duration_text) + '）</span>'
          : '<span>⏱ 填报 <b>' + App.esc(r.duration_text) + '</b></span>';
        html += '<div class="item">' +
          '<div class="item-h"><div class="item-name">' + App.esc(r.name) +
          '<span class="item-no">' + App.esc(r.student_no) + '</span></div>' +
          '<span class="badge b-info">' + App.esc(r.work_type_name) + '</span></div>' +
          '<div class="item-meta"><span>📅 ' + App.esc(r.work_date) + '</span>' + when + '</div>' +
          (r.remark ? '<div class="item-remark">' + App.esc(r.remark) + '</div>' : '') +
          '</div>';
      }
      box.insertAdjacentHTML('beforeend', html);

      document.getElementById('plaza-tip').textContent =
        '全体同学最近 ' + d.window_days + ' 天（' + d.since + ' 起）共 ' + d.total + ' 条原始填报记录，人人可见。';

      if (d.has_more) {
        plaza.page += 1;
        document.getElementById('plaza-more').textContent = '上滑加载更多';
      } else {
        plaza.end = true;
        document.getElementById('plaza-more').textContent = '— 已显示全部 —';
      }
    }).catch(function (e) {
      plaza.loading = false;
      document.getElementById('plaza-more').textContent = e.message || '加载失败';
    });
  }

  /* ---------------- 我的记录 ---------------- */
  var mineCache = [];

  function loadMine() {
    App.get('/api/records/mine?page=' + mine.page + '&size=' + mine.size).then(function (d) {
      editWindow = d.edit_window_minutes || 10;
      document.getElementById('win-tip').textContent = editWindow;
      mineCache = d.list || [];
      mine.total = d.total || 0;

      var s = d.summary || {};
      document.getElementById('mine-stat').innerHTML =
        '<div class="stat"><div class="v">' + (s.count || 0) + '</div><div class="k">累计条数</div></div>' +
        '<div class="stat"><div class="v">' + App.minutesText(s.total_minutes || 0) + '</div><div class="k">累计填报时长</div></div>' +
        '<div class="stat"><div class="v">' + (s.approved || 0) + '</div><div class="k">已审核</div></div>';

      renderMine();
      renderMinePager();
    }).catch(function (e) { App.toast(e.message); });
  }

  function renderMine() {
    var box = document.getElementById('mine-list');
    var list = mineCache.filter(function (r) { return !mine.status || r.status === mine.status; });

    if (!list.length) {
      box.innerHTML = '<div class="empty"><span class="ic">📭</span>本页没有符合条件的记录</div>';
      return;
    }

    var html = '';
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      var when = r.time_range
        ? '⏱ ' + App.esc(r.time_range) + '（' + App.esc(r.duration_text) + '）'
        : '⏱ 填报时长 <b>' + App.esc(r.duration_text) + '</b>';
      html += '<div class="item ' + r.status + '">' +
        '<div class="item-h"><div class="item-name">' + App.esc(r.work_date) +
        '<span class="item-no">' + App.esc(r.work_type_name) + '</span></div>' +
        '<span class="badge ' + App.statusClass(r.status) + '">' + App.esc(r.status_text) + '</span></div>' +
        '<div class="item-meta"><span>' + when + '</span></div>' +
        (r.remark ? '<div class="item-remark">' + App.esc(r.remark) + '</div>' : '') +
        '<div class="item-foot"><span class="item-time">提交于 ' + App.esc(r.created_at) + '</span>' +
        (r.editable
          ? '<span class="btn-row"><button class="btn btn-sm btn-ghost" data-edit="' + r.id + '">修改</button>' +
            '<button class="btn btn-sm btn-line" data-del="' + r.id + '">撤回</button>' +
            '<span class="muted" data-left="' + r.id + '">' + fmtLeft(r.edit_left_seconds) + '</span></span>'
          : '<span class="muted">已处理，不可修改</span>') +
        '</div></div>';
    }
    box.innerHTML = html;

    bindMineActions(list);
    startCountdown(list);
  }

  function fmtLeft(sec) {
    if (sec <= 0) return '';
    var m = Math.floor(sec / 60), s = sec % 60;
    return '剩 ' + m + ':' + (s < 10 ? '0' + s : s);
  }

  var timer = null;
  function startCountdown(list) {
    if (timer) clearInterval(timer);
    var items = list.filter(function (r) { return r.editable; });
    if (!items.length) return;
    timer = setInterval(function () {
      var alive = 0;
      for (var i = 0; i < items.length; i++) {
        items[i].edit_left_seconds -= 1;
        var el = document.querySelector('[data-left="' + items[i].id + '"]');
        if (items[i].edit_left_seconds <= 0) {
          if (el) el.textContent = '已过期';
          var e1 = document.querySelector('[data-edit="' + items[i].id + '"]');
          var e2 = document.querySelector('[data-del="' + items[i].id + '"]');
          if (e1) e1.style.display = 'none';
          if (e2) e2.style.display = 'none';
        } else {
          alive++;
          if (el) el.textContent = fmtLeft(items[i].edit_left_seconds);
        }
      }
      if (!alive) { clearInterval(timer); timer = null; }
    }, 1000);
  }

  function bindMineActions(list) {
    var eds = document.querySelectorAll('[data-edit]');
    for (var i = 0; i < eds.length; i++) {
      eds[i].onclick = (function (id) {
        return function () {
          var rec = null;
          for (var k = 0; k < list.length; k++) if (String(list[k].id) === String(id)) rec = list[k];
          if (rec) openEdit(rec);
        };
      })(eds[i].getAttribute('data-edit'));
    }
    var dels = document.querySelectorAll('[data-del]');
    for (var j = 0; j < dels.length; j++) {
      dels[j].onclick = (function (id) {
        return function () {
          App.confirmBox('撤回记录', '撤回后该条填报将被删除，操作会留下日志。确定继续？').then(function (yes) {
            if (!yes) return;
            App.spin(true);
            App.post('/api/records/delete', { id: parseInt(id, 10) }).then(function () {
              App.spin(false); App.toast('已撤回'); plaza.loaded = false; loadMine();
            }).catch(function (e) { App.spin(false); App.toast(e.message); });
          });
        };
      })(dels[j].getAttribute('data-del'));
    }
  }

  function openEdit(rec) {
    var s = App.sheet(
      '<div class="sheet-t">修改填报记录</div>' +
      '<p class="sheet-sub">仅提交后 ' + editWindow + ' 分钟内可修改，修改会记入操作日志。</p>' +
      '<div class="field"><label>工作日期</label><input type="date" data-d value="' + App.esc(rec.work_date) + '" max="' + App.todayStr() + '"></div>' +
      '<div class="row2">' +
        '<div class="field" style="margin:0"><label>开始时间</label><input type="time" step="600" data-st value="' + App.esc(rec.start_time) + '"></div>' +
        '<div class="field" style="margin:0"><label>结束时间</label><input type="time" step="600" data-et value="' + App.esc(rec.end_time) + '"></div>' +
      '</div>' +
      '<div class="field" style="margin:8px 0 0"><label>工作类型</label><select data-ty>' + typeOptionsHtml() + '</select></div>' +
      '<div class="field" style="margin:8px 0 0"><label>备注</label><textarea data-r maxlength="200">' + App.esc(rec.remark) + '</textarea></div>' +
      '<div class="btn-row mt14"><button class="btn btn-line" style="flex:1" data-cancel>取消</button>' +
      '<button class="btn" style="flex:1" data-save>保存修改</button></div>'
    );

    // 回填工作类型
    var sel = s.q('[data-ty]');
    for (var i = 0; i < sel.options.length; i++) {
      if (sel.options[i].textContent === rec.work_type_name) { sel.selectedIndex = i; break; }
    }

    s.q('[data-cancel]').onclick = s.close;
    s.q('[data-save]').onclick = function () {
      var st = s.q('[data-st]').value;
      var et = s.q('[data-et]').value;
      var ty = parseInt(s.q('[data-ty]').value, 10) || 0;
      var rm = s.q('[data-r]').value.trim();
      if (!st || !et) { App.toast('请填写起止时间'); return; }
      if (!ty) { App.toast('请选择工作类型'); return; }
      App.spin(true);
      App.post('/api/records/update', {
        id: rec.id,
        work_date: s.q('[data-d]').value,
        start_time: st, end_time: et,
        work_type_id: ty, remark: rm
      }).then(function () {
        App.spin(false); s.close(); App.toast('修改成功'); plaza.loaded = false; loadMine();
      }).catch(function (e) { App.spin(false); App.toast(e.message); });
    };
  }

  function renderMinePager() {
    var pages = Math.max(1, Math.ceil(mine.total / mine.size));
    document.getElementById('mine-pager').innerHTML =
      '<button ' + (mine.page <= 1 ? 'disabled' : '') + ' data-prev>上一页</button>' +
      '<span>' + mine.page + ' / ' + pages + '（共 ' + mine.total + ' 条）</span>' +
      '<button ' + (mine.page >= pages ? 'disabled' : '') + ' data-next>下一页</button>';
    var p = document.querySelector('#mine-pager [data-prev]');
    var n = document.querySelector('#mine-pager [data-next]');
    if (p) p.onclick = function () { if (mine.page > 1) { mine.page--; loadMine(); window.scrollTo(0, 0); } };
    if (n) n.onclick = function () { if (mine.page < pages) { mine.page++; loadMine(); window.scrollTo(0, 0); } };
  }
})();
