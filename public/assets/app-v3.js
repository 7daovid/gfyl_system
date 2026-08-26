/* ============================================================
   前端公共库：请求封装 / 登录态 / 弹窗 / 工具
   纯原生 JS，无任何外部依赖，兼容微信内置浏览器
   ============================================================ */
(function () {
  var TOKEN_KEY = 'qgzx_token';
  var USER_KEY = 'qgzx_user';

  function store() {
    try { return window.localStorage; } catch (e) { return null; }
  }

  function getToken() {
    var s = store();
    return s ? (s.getItem(TOKEN_KEY) || '') : '';
  }

  function getUser() {
    var s = store();
    if (!s) return null;
    try { return JSON.parse(s.getItem(USER_KEY) || 'null'); } catch (e) { return null; }
  }

  function setAuth(token, user) {
    var s = store();
    if (!s) return;
    s.setItem(TOKEN_KEY, token);
    s.setItem(USER_KEY, JSON.stringify(user || {}));
  }

  function clearAuth() {
    var s = store();
    if (!s) return;
    s.removeItem(TOKEN_KEY);
    s.removeItem(USER_KEY);
  }

  /* ---------------- 请求 ---------------- */
  function request(path, options) {
    var opt = options || {};
    var headers = { 'Content-Type': 'application/json' };
    var t = getToken();
    if (t) headers['Authorization'] = 'Bearer ' + t;

    return fetch(path, {
      method: opt.method || 'GET',
      headers: headers,
      body: opt.body ? JSON.stringify(opt.body) : undefined
    }).then(function (res) {
      return res.json().catch(function () { return { ok: false, error: '服务器返回异常（' + res.status + '）' }; })
        .then(function (data) {
          if (res.status === 401) {
            clearAuth();
            if (!opt.silent) {
              toast(data.error || '登录已过期，请重新登录');
              setTimeout(function () { location.href = '/'; }, 1200);
            }
            throw new Error(data.error || '未登录');
          }
          if (!res.ok || data.ok === false) throw new Error(data.error || '请求失败');
          return data.data;
        });
    });
  }

  function get(path) { return request(path); }
  function post(path, body) { return request(path, { method: 'POST', body: body || {} }); }

  /** 下载二进制（导出 Excel） */
  function download(path, fallbackName) {
    spin(true);
    var headers = {};
    var t = getToken();
    if (t) headers['Authorization'] = 'Bearer ' + t;

    return fetch(path, { headers: headers }).then(function (res) {
      if (!res.ok) {
        return res.json().catch(function () { return {}; }).then(function (d) {
          throw new Error(d.error || '导出失败（' + res.status + '）');
        });
      }
      var name = fallbackName || 'export.xlsx';
      var cd = res.headers.get('Content-Disposition') || '';
      var m = cd.match(/filename\*=UTF-8''([^;]+)/i);
      if (m) { try { name = decodeURIComponent(m[1]); } catch (e) { /* keep */ } }
      return res.blob().then(function (blob) {
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 800);
      });
    }).then(function () {
      spin(false);
      if (isWeChat()) {
        toast('微信浏览器可能拦截下载，建议用手机浏览器或电脑打开');
      } else {
        toast('导出成功');
      }
    }).catch(function (e) {
      spin(false);
      toast(e.message || '导出失败');
    });
  }

  /* ---------------- UI ---------------- */
  var toastTimer = null;
  function toast(msg, ms) {
    var old = document.querySelector('.toast');
    if (old) old.parentNode.removeChild(old);
    var d = document.createElement('div');
    d.className = 'toast';
    d.textContent = msg;
    document.body.appendChild(d);
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      if (d.parentNode) d.parentNode.removeChild(d);
    }, ms || 2200);
  }

  var spinEl = null;
  function spin(on) {
    if (on) {
      if (spinEl) return;
      spinEl = document.createElement('div');
      spinEl.className = 'spin';
      spinEl.innerHTML = '<i></i>';
      document.body.appendChild(spinEl);
    } else if (spinEl) {
      if (spinEl.parentNode) spinEl.parentNode.removeChild(spinEl);
      spinEl = null;
    }
  }

  /** 通用底部弹层；返回 { close } */
  function sheet(html, opts) {
    var o = opts || {};
    var mask = document.createElement('div');
    mask.className = 'mask' + (o.center ? ' center' : '');
    mask.innerHTML = '<div class="sheet">' + html + '</div>';
    document.body.appendChild(mask);
    mask.addEventListener('click', function (e) {
      if (e.target === mask && o.dismissible !== false) close();
    });
    function close() { if (mask.parentNode) mask.parentNode.removeChild(mask); }
    return { el: mask, close: close, q: function (sel) { return mask.querySelector(sel); } };
  }

  /** 确认框 */
  function confirmBox(title, text) {
    return new Promise(function (resolve) {
      var s = sheet(
        '<div class="sheet-t">' + esc(title) + '</div>' +
        '<p class="sheet-sub">' + esc(text || '') + '</p>' +
        '<div class="btn-row"><button class="btn btn-line" style="flex:1" data-no>取消</button>' +
        '<button class="btn btn-danger" style="flex:1" data-yes>确定</button></div>',
        { center: true }
      );
      s.q('[data-no]').onclick = function () { s.close(); resolve(false); };
      s.q('[data-yes]').onclick = function () { s.close(); resolve(true); };
    });
  }

  /** 必填理由输入框 */
  function reasonBox(title, tip, placeholder) {
    return new Promise(function (resolve) {
      var s = sheet(
        '<div class="sheet-t">' + esc(title) + '</div>' +
        '<p class="sheet-sub">' + esc(tip || '') + '</p>' +
        '<textarea data-r placeholder="' + esc(placeholder || '请输入理由（必填，将写入不可删除的操作日志）') + '"></textarea>' +
        '<div class="btn-row mt14"><button class="btn btn-line" style="flex:1" data-no>取消</button>' +
        '<button class="btn" style="flex:1" data-yes>提交</button></div>',
        { center: true }
      );
      var ta = s.q('[data-r]');
      setTimeout(function () { ta.focus(); }, 120);
      s.q('[data-no]').onclick = function () { s.close(); resolve(null); };
      s.q('[data-yes]').onclick = function () {
        var v = (ta.value || '').trim();
        if (!v) { toast('理由为必填项'); return; }
        s.close(); resolve(v);
      };
    });
  }

  /* ---------------- 工具 ---------------- */
  function esc(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function todayStr() {
    var d = new Date(Date.now() + 8 * 3600000);
    return d.toISOString().slice(0, 10);
  }

  function dateOffset(days) {
    var d = new Date(Date.now() + 8 * 3600000 + days * 86400000);
    return d.toISOString().slice(0, 10);
  }

  function minutesText(m) {
    m = parseInt(m, 10) || 0;
    var h = Math.floor(m / 60), r = m % 60;
    if (h && r) return h + '小时' + r + '分';
    if (h) return h + '小时';
    return r + '分钟';
  }

  function isWeChat() {
    return /micromessenger/i.test(navigator.userAgent);
  }

  function statusClass(s) {
    return ({ pending: 'b-pending', approved: 'b-approved', merged: 'b-merged' })[s] || 'b-info';
  }

  /** 校验登录态；role 可为 'student' | 'admin' */
  function guard(role) {
    return get('/api/auth/me').then(function (d) {
      if (!d || !d.logged_in || (role && d.role !== role)) {
        clearAuth();
        location.href = '/';
        return null;
      }
      setAuth(getToken(), d);
      return d;
    }).catch(function () {
      clearAuth();
      location.href = '/';
      return null;
    });
  }

  window.App = {
    getToken: getToken, getUser: getUser, setAuth: setAuth, clearAuth: clearAuth,
    get: get, post: post, download: download, guard: guard,
    toast: toast, spin: spin, sheet: sheet, confirmBox: confirmBox, reasonBox: reasonBox,
    esc: esc, todayStr: todayStr, dateOffset: dateOffset, minutesText: minutesText,
    isWeChat: isWeChat, statusClass: statusClass
  };
})();
