/* ============================================================
   拾玖 · 时光  —  app.js
   恋爱纪念册 · 主逻辑
   ============================================================ */
(function () {
  'use strict';

  const D = window.LOVE_DATA;
  const KEY = 'shijiu.love.v1';
  const DEFAULT_START = '2026-10-19T23:45';
  const DAY = 86400000;

  /* 内置信封：两台手机装好就自动连上同一个云端信箱，谁都不用填令牌。
     这把令牌**没有过期日**（2026-11-04 建），所以不会哪天自己断掉。
     想换成自己的空间，在设置里重新创建/加入即可，会覆盖这里 */
  const BUILTIN_INVITE = 'SJ1.eyJwIjoiZ2l0aHViIiwidCI6ImdocF9sNWNQMmxUcGF0cWZrM0oxY2ZTRHUyM0RhNnl5SnA0QzhHSzciLCJnIjoiYzQ5NmZiNmQ2ZDVmYjlkYjRiZmUwZGVmOWU1MmM3MTMifQ==';
  /* 钥匙版本：换一把新的内置钥匙就把这里 +1，已经装好的人下次打开自动换过来 */
  const KEY_VERSION = 2;

  /* ==================== 工具 ==================== */
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const pad = (n, l) => String(n).padStart(l || 2, '0');
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const parseDT = (s) => {
    let str = String(s == null ? '' : s).trim().replace(' ', 'T');
    // 只有日期时按本地 0 点解析（避免被当成 UTC）
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) str += 'T00:00:00';
    const d = new Date(str);
    return isNaN(d.getTime()) ? new Date() : d;
  };
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const fmtDate = (d) => `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日`;
  const fmtMD = (d) => `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
  const fmtDT = (d) => `${fmtDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const today0 = () => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); };
  const dayStart = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

  /* 汉字数字：二〇二六年十月十九日 · 二十三时四十五分 */
  const CN_D = ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  function cnNum(n) {
    n = Math.max(0, Math.min(99, Math.floor(n)));
    if (n < 10) return CN_D[n];
    if (n === 10) return '十';
    if (n < 20) return '十' + CN_D[n % 10];
    const t = Math.floor(n / 10), o = n % 10;
    return CN_D[t] + '十' + (o ? CN_D[o] : '');
  }
  function cnYear(y) { return String(y).split('').map((c) => CN_D[+c] || c).join(''); }
  function cnDate(d) { return `${cnYear(d.getFullYear())}年${cnNum(d.getMonth() + 1)}月${cnNum(d.getDate())}日`; }

  /* ==================== 状态 ==================== */
  const DEFAULT_CONFIG = {
    start: DEFAULT_START,
    me: '我',
    you: '你',
    theme: 'auto',
    secret: '1919',
    secretMsg: '无论多久，我还是会选择你。',
    sync: { provider: 'github', token: '', gist: '', lastAt: 0, auto: false }
  };

  /* ==================== 主题：纸 / 夜 / 胭脂 ==================== */
  /* 老版本存的是 aurora / dusk / sea，这里静默迁移到新的三套纸色 */
  const THEME_MAP = {
    auto: 'auto', paper: 'paper', night: 'night', rose: 'rose',
    aurora: 'night', dusk: 'rose', sea: 'paper'
  };
  const THEME_LABEL = { auto: '随时刻', paper: '宣纸', night: '墨夜', rose: '胭脂' };
  const THEME_COLOR = { paper: '#eee4d3', night: '#0e0c12', rose: '#f3e3e2' };

  function normalizeTheme(t) { return THEME_MAP[t] || 'auto'; }

  /* 选「随时刻」时：入夜（19 点到清晨 5 点）自动翻到墨夜 */
  function resolveTheme() {
    const t = normalizeTheme(state.config.theme);
    if (t !== 'auto') return t;
    const h = new Date().getHours();
    return (h >= 19 || h < 5) ? 'night' : 'paper';
  }

  function applyTheme() {
    const t = resolveTheme();
    document.documentElement.dataset.theme = t;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', THEME_COLOR[t] || THEME_COLOR.paper);
    return t;
  }

  function blankState() {
    return {
      v: 1,
      config: { ...DEFAULT_CONFIG },
      moments: [],
      anns: [{ id: uid(), name: '每个月的那一天', date: DEFAULT_START.slice(0, 10), repeat: 'month', emoji: '🌙' }],
      capsules: [],
      bucket: {},
      bucketItems: [],
      checkins: {},
      qa: [],
      deleted: {},
      seen: { banner: false }
    };
  }

  let state = load();

  function load() {
    let raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) { }
    if (!raw) return blankState();
    try {
      const o = JSON.parse(raw);
      const base = blankState();
      const st = {
        ...base, ...o,
        config: { ...base.config, ...(o.config || {}) },
        anns: Array.isArray(o.anns) ? o.anns : base.anns,
        moments: Array.isArray(o.moments) ? o.moments : [],
        capsules: Array.isArray(o.capsules) ? o.capsules : [],
        qa: Array.isArray(o.qa) ? o.qa : [],
        bucket: o.bucket && typeof o.bucket === 'object' ? o.bucket : {},
        bucketItems: Array.isArray(o.bucketItems) ? o.bucketItems : [],
        checkins: o.checkins && typeof o.checkins === 'object' ? o.checkins : {},
        deleted: o.deleted && typeof o.deleted === 'object' ? o.deleted : {},
        seen: { ...base.seen, ...(o.seen || {}) }
      };
      st.config.theme = normalizeTheme(st.config.theme);
      // 只有一次：把「还没写作者」的老记录补上本机的称呼，时间轴上就不会有一截空白
      // 只做一次，是为了别把对方同步过来的老记录也认成自己写的
      if (!st.seen.byBackfilled) {
        st.seen.byBackfilled = true;
        const who = st.config.me;
        if (who && who !== '我') {
          (st.moments || []).forEach((m) => { if (m && !m.by) m.by = who; });
          (st.qa || []).forEach((x) => { if (x && !x.by) x.by = who; });
          Object.keys(st.checkins || {}).forEach((k) => {
            const c = st.checkins[k];
            if (c && typeof c === 'object' && !c.by) c.by = who;
          });
        }
      }
      // 只有一次：我自己做联网自检时往云端写过一条假心动，这里把它摘掉（tag 只匹配那一条）
      if (!st.seen.junkCleaned) {
        st.seen.junkCleaned = true;
        st.moments = (st.moments || []).filter((m) => !(m && (m.id === 'e2e1' || /端到端自检/.test(m.text || ''))));
      }
      // 只有一次：合并时曾经塞进来一堆同名同期的纪念日，这里归并成一条
      if (!st.seen.annDeduped) {
        st.seen.annDeduped = true;
        const seenSig = new Set();
        st.anns = (st.anns || []).filter((a) => {
          if (!a) return false;
          const sig = [a.name, a.date, a.repeat].join('|');
          if (seenSig.has(sig)) return false;
          seenSig.add(sig);
          return true;
        });
      }
      return st;
    } catch (e) {
      console.warn('数据读取失败，已重置', e);
      return blankState();
    }
  }

  /* 同步过程里自己写盘，不能再去排下一轮同步（否则会自己喂自己，一直转） */
  let syncSaving = false;

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      // 开了自动同步的话，写完过几秒自己推上去
      if (!syncSaving && typeof scheduleAutoSync === 'function') scheduleAutoSync();
      return true;
    } catch (e) {
      toast('存储空间不足啦，试试删掉几张照片～');
      return false;
    }
  }

  /* ==================== 时间核心 ==================== */
  function startDate() { return parseDT(state.config.start); }
  function elapsedMs() { return Date.now() - startDate().getTime(); }
  function elapsedDays() { return Math.floor(elapsedMs() / DAY); }
  /* 第 N 天：含开始当天（10 月 19 日开始，10 月 19 日就是第 1 天） */
  function dayIndex(d) { return Math.floor((dayStart(d || new Date()) - dayStart(startDate())) / DAY) + 1; }
  function todayIndex() { return dayIndex(new Date()); }

  /* 里程碑的日期：天数型按 +（n-1）天，周年型永远落在同一个「月·日」 */
  function milestoneTarget(m) {
    const s = startDate();
    if (m.type === 'year') {
      return new Date(s.getFullYear() + m.n, s.getMonth(), s.getDate(), s.getHours(), s.getMinutes());
    }
    return new Date(s.getTime() + (m.n - 1) * DAY);
  }

  function milestoneList() {
    return D.MILESTONES
      .map((m) => ({ ...m, date: milestoneTarget(m) }))
      .sort((a, b) => a.date - b.date);
  }

  function nextMilestone() {
    const list = milestoneList();
    const t = today0();
    return list.find((m) => dayStart(m.date) >= t) || list[list.length - 1];
  }

  function prevMilestone(nx) {
    const list = milestoneList();
    let prev = null;
    for (const m of list) if (dayStart(m.date) < dayStart(nx.date)) prev = m;
    return prev;
  }

  /* 从现在到某个日期的日历天数（今天是 0） */
  function daysUntil(d) { return Math.round((dayStart(d) - today0()) / DAY); }

  /* 自定义纪念日的下一次 */
  function nextAnn(ann) {
    const base = parseDT(ann.date + 'T00:00:00');
    const t = today0();
    if (ann.repeat === 'once') return base < t ? null : base;
    if (ann.repeat === 'month') {
      const d = Math.min(base.getDate(), 28);
      let c = new Date(t.getFullYear(), t.getMonth(), d);
      if (c < t) c = new Date(t.getFullYear(), t.getMonth() + 1, d);
      return c;
    }
    let y = new Date(t.getFullYear(), base.getMonth(), base.getDate());
    if (y < t) y = new Date(t.getFullYear() + 1, base.getMonth(), base.getDate());
    return y;
  }

  /* ==================== 小工具：toast / fx ==================== */
  function toast(msg, ms) {
    const w = $('#toast-wrap');
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    w.appendChild(el);
    setTimeout(() => el.remove(), (ms || 2600) + 200);
  }

  function burst(x, y, emoji, n) {
    const fx = $('#fx');
    const count = n || 10;
    const pool = emoji ? [emoji] : ['💗', '✨', '💫', '🌸', '♡'];
    for (let i = 0; i < count; i++) {
      const s = document.createElement('span');
      s.className = 'fx-heart';
      s.textContent = pool[Math.floor(Math.random() * pool.length)];
      const ang = Math.random() * Math.PI * 2;
      const dist = 50 + Math.random() * 120;
      s.style.left = x + 'px';
      s.style.top = y + 'px';
      s.style.setProperty('--dx', Math.cos(ang) * dist + 'px');
      s.style.setProperty('--dy', (Math.sin(ang) * dist - 40) + 'px');
      s.style.setProperty('--sc', (0.6 + Math.random()).toFixed(2));
      s.style.setProperty('--rot', (Math.random() * 90 - 45).toFixed(0) + 'deg');
      s.style.fontSize = (12 + Math.random() * 12) + 'px';
      fx.appendChild(s);
      setTimeout(() => s.remove(), 1600);
    }
  }

  function burstAt(el) {
    const r = el.getBoundingClientRect();
    burst(r.left + r.width / 2, r.top + r.height / 2);
  }

  /* ==================== 弹层 ==================== */
  const modalRoot = $('#modal-root');
  const modalEl = $('#modal');
  let modalCloser = null;

  function openModal(html, onMount, opts) {
    modalEl.innerHTML = html;
    modalEl.classList.toggle('is-wide', !!(opts && opts.wide));
    modalRoot.hidden = false;
    document.body.style.overflow = 'hidden';
    modalCloser = onMount ? (onMount(modalEl) || null) : null;
  }
  function closeModal() {
    if (typeof modalCloser === 'function') { try { modalCloser(); } catch (e) { } }
    modalCloser = null;
    modalRoot.hidden = true;
    modalEl.classList.remove('is-wide');
    modalEl.innerHTML = '';
    document.body.style.overflow = '';
  }

  /* 点开一张照片：整屏纸片里看大图 */
  function openLightbox(src, cap) {
    openModal(`
      <img class="lb-img" src="${esc(src)}" alt="">
      ${cap ? `<div class="lb-cap">${esc(cap)}</div>` : ''}
    `, null, { wide: true });
  }

  modalRoot.addEventListener('click', (e) => {
    if (e.target.dataset && e.target.dataset.close) closeModal();
    const closeBtn = e.target.closest('[data-close]');
    if (closeBtn) closeModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modalRoot.hidden) closeModal();
  });

  function moodPicker(selected) {
    return `<div class="emoji-pick" data-mood-pick>
      ${D.MOODS.map((m, i) => `<button type="button" data-mood="${i}" class="${i === selected ? 'is-on' : ''}" title="${esc(m.k)}">${m.e}</button>`).join('')}
    </div>`;
  }

  function bindMoodPicker(scope, initial) {
    let cur = initial;
    scope.addEventListener('click', (e) => {
      const b = e.target.closest('[data-mood]');
      if (!b) return;
      cur = Number(b.dataset.mood);
      $$('[data-mood]', scope).forEach((x) => x.classList.toggle('is-on', Number(x.dataset.mood) === cur));
    });
    return () => cur;
  }

  /* ==================== 首页 ==================== */
  let lastShownDay = null;

  function renderHome() {
    const ms = elapsedMs();
    const idx = todayIndex();
    const neg = idx < 1;
    const days = neg ? 1 - idx : idx;
    const rem = Math.abs(ms) % DAY;
    const h = Math.floor(rem / 3600000);
    const m = Math.floor((rem % 3600000) / 60000);
    const s = Math.floor((rem % 60000) / 1000);

    const daysEl = $('#h-days');
    if (daysEl.textContent !== String(days)) {
      daysEl.textContent = days;
      if (lastShownDay !== null) {
        daysEl.classList.remove('pop');
        void daysEl.offsetWidth;
        daysEl.classList.add('pop');
      }
      lastShownDay = days;
    }
    $('#h-eyebrow').textContent = neg ? '离我们的故事开始还有' : '我们在一起的第';
    $('#h-h').textContent = pad(h);
    $('#h-m').textContent = pad(m);
    $('#h-s').textContent = pad(s);

    const sd = startDate();
    const brandSub = $('.brand-sub');
    if (brandSub) brandSub.textContent = `since ${pad(sd.getMonth() + 1)}.${pad(sd.getDate())}`;
    $('#h-names').innerHTML = `<span>${esc(state.config.me)}</span><span class="hn-heart">♥</span><span>${esc(state.config.you)}</span>`;

    // 页面标题跟着天数走（起点的具体日期只留在设置里，不摆在首页）
    document.title = neg ? `还有 ${days} 天 · 拾玖时光` : `第 ${days} 天 · 拾玖时光`;

    // 下一个纪念日
    const nx = nextMilestone();
    const pv = prevMilestone(nx);
    const anchor = pv ? dayStart(pv.date) : dayStart(startDate());
    const span = Math.max(1, (dayStart(nx.date) - anchor) / DAY);
    const doneSpan = Math.max(0, (today0() - anchor) / DAY);
    const pct = Math.min(100, Math.max(0, (doneSpan / span) * 100));
    const left = Math.max(0, daysUntil(nx.date));

    $('#h-next-left').textContent = left;
    $('#h-next-name').textContent = `${nx.icon} ${nx.name}`;
    $('#h-next-date').textContent = fmtDate(nx.date);
    const ring = $('#home-ring');
    const C = 2 * Math.PI * (Number(ring.getAttribute('r')) || 52);
    ring.style.strokeDashoffset = String(C * (1 - pct / 100));
    $('#h-next-bar').style.width = pct + '%';

    // 情话
    if (!$('#h-quote').dataset.pinned) setQuote(quoteOfToday());

    // 打卡状态
    const tKey = ymd(new Date());
    const done = !!state.checkins[tKey];
    const tile = $('#h-checkin');
    tile.classList.toggle('is-done', done);
    // 打过卡，就在首页钤一枚「今日已记」
    const heroCard = document.querySelector('.hero');
    if (heroCard) heroCard.classList.toggle('is-stamped', done);
    $('#h-checkin-t').textContent = done ? '今天已打卡' : '今日打卡';
    $('#h-checkin-s').textContent = done ? `连续 ${streak()} 天` : `连续 ${streak()} 天，别断哦`;

    // 统计
    const hearts = state.moments.filter((x) => x.kind === 'heart').length;
    const mems = state.moments.filter((x) => x.kind === 'memory').length;
    $('#s-moments').textContent = hearts;
    $('#s-memories').textContent = mems;
    $('#s-bucket').textContent = Object.keys(state.bucket).length;
    $('#s-capsules').textContent = state.capsules.length;

    // 最近
    renderRecent();
    renderBanner();
  }

  function quoteOfToday() {
    const t = new Date();
    const seed = Math.floor(Date.now() / DAY) + t.getFullYear();
    return D.QUOTES[seed % D.QUOTES.length];
  }
  function setQuote(q, animate) {
    const el = $('#h-quote');
    if (!animate) {
      // 首屏直接显示，避免闪一下空白
      el.style.transition = 'none';
      el.textContent = q;
      el.style.opacity = 1;
      return;
    }
    el.style.transition = 'opacity .35s';
    el.style.opacity = 0;
    setTimeout(() => {
      el.textContent = q;
      el.style.opacity = 1;
    }, 180);
  }

  const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const weekday = (d) => WEEK[d.getDay()];

  function streak() {
    let n = 0;
    const d = today0();
    // 今天没打卡就从昨天开始数
    if (!state.checkins[ymd(d)]) d.setDate(d.getDate() - 1);
    while (state.checkins[ymd(d)]) { n++; d.setDate(d.getDate() - 1); }
    return n;
  }

  function renderRecent() {
    const box = $('#h-recent');
    const list = state.moments.slice().sort((a, b) => b.at.localeCompare(a.at)).slice(0, 3);
    if (!list.length) {
      box.innerHTML = `<div class="mini-empty">还没有记录。写下第一笔心动吧，那会是很久以后最珍贵的东西。</div>`;
      return;
    }
    box.innerHTML = list.map((x) => {
      const moodObj = D.MOODS[x.mood] || null;
      const d = parseDT(x.at);
      const text = x.kind === 'heart' ? x.text : (x.title || x.text);
      return `<button class="mini" type="button" data-goto="memories">
        <span class="mini-emoji">${moodObj ? moodObj.e : (x.kind === 'memory' ? '📖' : '💗')}</span>
        <span class="mini-body">
          <span class="mini-txt">${esc(text)}</span>
          <span class="mini-time">${fmtMD(d)} · 第 ${dayIndex(d)} 天${x.by ? ' · ' + esc(x.by) + ' 记' : ''}</span>
        </span>
      </button>`;
    }).join('');
  }

  function renderBanner() {
    const b = $('#banner-year');
    if (state.seen.banner) { b.hidden = true; return; }
    b.hidden = false;
  }

  /* ==================== 纪念日页 ==================== */
  function renderDays() {
    const nx = nextMilestone();
    const pv = prevMilestone(nx);
    const anchor = pv ? dayStart(pv.date) : dayStart(startDate());
    const span = Math.max(1, (dayStart(nx.date) - anchor) / DAY);
    const doneSpan = Math.max(0, (today0() - anchor) / DAY);
    const pct = Math.min(100, Math.max(0, (doneSpan / span) * 100));
    const left = Math.max(0, daysUntil(nx.date));

    $('#ann-hero-name').textContent = `${nx.icon} ${nx.name}`;
    $('#ann-hero-num').textContent = left;
    $('#ann-hero-date').textContent = fmtDate(nx.date) + (left === 0 ? ' · 就是今天' : '');
    $('#ann-hero-bar').style.width = pct + '%';

    // 里程碑
    const ms = $('#ms-list');
    ms.innerHTML = milestoneList().map((m) => {
      const target = m.date;
      const dl = daysUntil(target);
      const isToday = dl === 0;
      const isPast = dl < 0;
      const cls = ['ms'];
      if (isPast) cls.push('is-past');
      if (isToday) cls.push('is-today', 'is-now');
      const right = isToday
        ? `<div class="ms-num">就是今天<small>🎉</small></div>`
        : isPast
          ? `<div class="ms-num">已解锁</div>`
          : `<div class="ms-num">${dl}<small>天后</small></div>`;
      return `<div class="${cls.join(' ')}">
        <div class="ms-ico">${m.icon}</div>
        <div class="ms-body">
          <div class="ms-name">${esc(m.name)}</div>
          <div class="ms-date">${fmtDate(target)} · ${weekday(target)}</div>
        </div>
        <div class="ms-right">${right}</div>
      </div>`;
    }).join('');

    // 自定义纪念日
    const al = $('#ann-list');
    const items = state.anns.map((a) => {
      const nd = nextAnn(a);
      const dl = nd ? daysUntil(nd) : null;
      const sub = nd
        ? (dl === 0 ? '就是今天 🎉' : `${dl} 天后 · ${fmtMD(nd)}`)
        : '已经过去';
      return `<div class="ann" data-ann="${a.id}">
        <button class="ann-del" data-del-ann="${a.id}" title="删除">×</button>
        <div class="ann-emoji">${a.emoji || '💌'}</div>
        <div class="ann-name">${esc(a.name)}</div>
        <div class="ann-left">${sub}</div>
      </div>`;
    }).join('');
    al.innerHTML = items + `<button class="ann ann-add" type="button" id="ann-add-tile">＋ 添加纪念日</button>`;

    const addTile = $('#ann-add-tile');
    if (addTile) addTile.onclick = openAnnModal;
  }

  function openAnnModal() {
    openModal(`
      <h3>添加一个纪念日</h3>
      <p class="modal-sub">生日、第一次见面、第一次牵手…… 都值得被记住。</p>
      <div class="field">
        <label>名字</label>
        <input type="text" id="ann-name" maxlength="16" placeholder="比如：她的生日">
      </div>
      <div class="field">
        <label>日期</label>
        <input type="date" id="ann-date" value="${ymd(new Date())}">
      </div>
      <div class="field">
        <label>重复</label>
        <div class="seg" id="ann-repeat">
          <button type="button" data-r="year" class="is-on">每年</button>
          <button type="button" data-r="month">每月</button>
          <button type="button" data-r="once">仅一次</button>
        </div>
      </div>
      <div class="field">
        <label>图标</label>
        <div class="emoji-pick" id="ann-emoji">
          ${D.ANN_EMOJIS.map((e, i) => `<button type="button" data-e="${e}" class="${i === 0 ? 'is-on' : ''}">${e}</button>`).join('')}
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn" data-close="1" type="button">取消</button>
        <button class="btn btn-primary" id="ann-save" type="button">收好这个日子</button>
      </div>
    `, (root) => {
      let repeat = 'year';
      let emoji = D.ANN_EMOJIS[0];
      $('#ann-repeat', root).addEventListener('click', (e) => {
        const b = e.target.closest('[data-r]'); if (!b) return;
        repeat = b.dataset.r;
        $$('[data-r]', root).forEach((x) => x.classList.toggle('is-on', x === b));
      });
      $('#ann-emoji', root).addEventListener('click', (e) => {
        const b = e.target.closest('[data-e]'); if (!b) return;
        emoji = b.dataset.e;
        $$('[data-e]', root).forEach((x) => x.classList.toggle('is-on', x === b));
      });
      $('#ann-save', root).onclick = () => {
        const name = $('#ann-name', root).value.trim();
        const date = $('#ann-date', root).value;
        if (!name) { toast('给它起个名字吧'); return; }
        if (!date) { toast('选一个日期'); return; }
        state.anns.push({ id: uid(), name, date, repeat, emoji });
        save(); renderDays(); setPageHero();
        closeModal(); toast('记下了 🌙');
      };
    });
  }

  /* ==================== 拾光集 ==================== */
  let memFilter = 'all';
  /* 每日一问里还没按「收下」的草稿：同步回来重画页面时用它兜住，别把刚打的字冲掉 */
  let qaDraft = null;

  function renderMemories() {
    const box = $('#timeline');
    let list = state.moments.slice().sort((a, b) => b.at.localeCompare(a.at));
    if (memFilter !== 'all') list = list.filter((x) => x.kind === memFilter);

    if (!list.length) {
      box.innerHTML = `<div class="tl-empty">
        <b>这里还很干净</b>
        第一件想记下来的事，是什么？<br>哪怕只是「今天她笑了一下」。
      </div>`;
      return;
    }

    const groups = [];
    let cur = null;
    list.forEach((x) => {
      const d = parseDT(x.at);
      const k = ymd(d);
      if (!cur || cur.k !== k) { cur = { k, d, items: [] }; groups.push(cur); }
      cur.items.push(x);
    });

    box.innerHTML = groups.map((g) => {
      const dn = dayIndex(g.d);
      const label = dn > 0 ? `${fmtDate(g.d)} · 在一起第 ${dn} 天` : fmtDate(g.d);
      const cards = g.items.map((x) => {
        const moodObj = D.MOODS[x.mood] || null;
        const d = parseDT(x.at);
        const title = x.kind === 'memory' ? (x.title || '无题') : '心动瞬间';
        return `<div class="tl-card ${x.kind === 'heart' ? 'is-heart' : ''}">
          <div class="tl-top">
            <span class="tl-emoji">${moodObj ? moodObj.e : (x.kind === 'memory' ? '📖' : '💗')}</span>
            <span class="tl-title">${esc(title)}</span>
            ${x.by ? `<span class="tl-by">${esc(x.by)}</span>` : ''}
            ${moodObj ? `<span class="tl-mood">${esc(moodObj.k)}</span>` : ''}
            <button class="tl-del" data-del-mem="${x.id}" title="删除">删除</button>
          </div>
          ${x.text ? `<div class="tl-text">${esc(x.text)}</div>` : ''}
          ${x.img ? `<img class="tl-img" src="${x.img}" alt="" loading="lazy" data-cap="${pad(d.getHours())}:${pad(d.getMinutes())} · ${esc(fmtMD(d))}">` : ''}
          <div class="tl-foot">
            <span class="tl-day-num">${pad(d.getHours())}:${pad(d.getMinutes())}</span>
            <span>${x.kind === 'heart' ? '存入恋爱银行' : '收入拾光集'}</span>
          </div>
        </div>`;
      }).join('');
      return `<div class="tl-day"><div class="tl-day-label">${label}</div>${cards}</div>`;
    }).join('');
  }

  function openMomentModal(kind) {
    const isHeart = kind === 'heart';
    openModal(`
      <h3>${isHeart ? '记一笔心动' : '写一篇回忆'}</h3>
      <p class="modal-sub">${isHeart ? '一句话就好，越具体越珍贵。' : '把这件事写下来，以后会反复看。'}</p>
      ${isHeart ? '' : `<div class="field">
        <label>标题</label>
        <input type="text" id="mem-title" maxlength="24" placeholder="比如：第一次一起做饭">
      </div>`}
      <div class="field">
        <label>${isHeart ? '此刻' : '内容'}</label>
        <textarea id="mem-text" rows="${isHeart ? 3 : 5}" placeholder="${isHeart ? '今天她帮我带了一杯热奶茶，杯壁是温的。' : '发生了什么？当时你在想什么？'}"></textarea>
      </div>
      <div class="field">
        <label>心情</label>
        ${moodPicker(0)}
      </div>
      <div class="field">
        <label>时间</label>
        <input type="datetime-local" id="mem-at" value="${nowLocalInput()}">
      </div>
      <div class="field">
        <label>照片（可选）</label>
        <label class="img-drop" for="mem-img">
          <img class="img-prev" id="mem-prev" alt="">
          <span id="mem-img-tip">点这里选一张照片 · 会自动压缩</span>
        </label>
        <input type="file" id="mem-img" accept="image/*" hidden>
      </div>
      <div class="modal-actions">
        <button class="btn" data-close="1" type="button">取消</button>
        <button class="btn btn-primary" id="mem-save" type="button">存进去</button>
      </div>
    `, (root) => {
      const getMood = bindMoodPicker(root, 0);
      let imgData = '';

      $('#mem-img', root).addEventListener('change', (e) => {
        const f = e.target.files && e.target.files[0];
        if (!f) return;
        compressImage(f, (data) => {
          imgData = data;
          const p = $('#mem-prev', root);
          p.src = data; p.style.display = 'block';
          $('#mem-img-tip', root).textContent = '已添加 · 点这里可以换一张';
        });
      });

      $('#mem-save', root).onclick = () => {
        const text = $('#mem-text', root).value.trim();
        const title = isHeart ? '' : ($('#mem-title', root).value.trim() || '无题');
        const at = $('#mem-at', root).value;
        if (!text) { toast('写点什么吧'); return; }
        if (!at) { toast('选一个时间'); return; }
        state.moments.push({
          id: uid(), kind, at, text, title,
          mood: getMood(), img: imgData,
          by: state.config.me || ''
        });
        save();
        closeModal();
        renderAll();
        if (isHeart) {
          toast('已存入恋爱银行 ✨');
          burst(window.innerWidth / 2, window.innerHeight / 2, '💗', 14);
        } else {
          toast('这一篇，收进拾光集了');
        }
      };
    });
  }

  function nowLocalInput() {
    const d = new Date();
    return `${ymd(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function compressImage(file, cb) {
    const fr = new FileReader();
    fr.onload = () => {
      const img = new Image();
      img.onload = () => {
        const max = 1000;
        const sc = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.width * sc));
        c.height = Math.max(1, Math.round(img.height * sc));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        cb(c.toDataURL('image/jpeg', 0.72));
      };
      img.onerror = () => toast('这张图读不出来');
      img.src = fr.result;
    };
    fr.onerror = () => toast('读取失败');
    fr.readAsDataURL(file);
  }

  /* ==================== 时间胶囊 ==================== */
  let capsulePinged = false;

  function renderCapsules() {
    const box = $('#capsule-list');
    if (!state.capsules.length) {
      box.innerHTML = `<div class="cap-empty">还没有写过信。第一次写，可以从「一年后」开始。</div>`;
    } else {
      const list = state.capsules.slice().sort((a, b) => a.unlock.localeCompare(b.unlock));
      box.innerHTML = list.map((c) => {
        const now = Date.now();
        const t = parseDT(c.unlock).getTime();
        const left = Math.ceil((t - now) / DAY);
        const ready = now >= t;
        const sealed = !c.opened;
        let bodyHtml = '';
        let foot = '';

        if (!sealed) {
          bodyHtml = `<div class="cap-body">${esc(c.body)}</div>`;
        } else if (ready) {
          foot = `<button class="btn btn-primary cap-open-btn" data-open="${c.id}" type="button">拆开这封信</button>`;
        } else {
          bodyHtml = `<div class="cap-locked-note"><span>🔒</span><span>封存中，到期才能打开</span><i>${'·'.repeat(24)}</i></div>`;
        }

        return `<div class="capsule ${sealed ? 'sealed' : ''}">
          <div class="cap-top">
            <div class="cap-seal ${sealed ? '' : 'is-open'}" aria-hidden="true"></div>
            <div class="cap-title">
              <h4>${esc(c.title || '给未来的我们')}</h4>
              <div class="cap-sub">写于 ${fmtDate(parseDT(c.created))}${sealed ? '' : ' · 已拆封'}</div>
            </div>
            <div class="cap-time">
              ${ready ? `<b>到期</b><small>${fmtMD(parseDT(c.unlock))}</small>`
            : `<b>${left}</b><small>天后解锁</small>`}
            </div>
          </div>
          ${bodyHtml}${foot}
          <div class="tl-foot" style="margin-top:12px">
            <span>${ready ? '' : `解锁日：${fmtDate(parseDT(c.unlock))}`}</span>
            <button class="tl-del" data-del-cap="${c.id}" type="button">删除</button>
          </div>
        </div>`;
      }).join('');
    }

    // 有信到期了，只在本次打开时提醒一次
    if (!capsulePinged) {
      const readyN = state.capsules.filter((c) => !c.opened && Date.now() >= parseDT(c.unlock).getTime()).length;
      if (readyN) {
        capsulePinged = true;
        setTimeout(() => toast(readyN === 1 ? '有一封信到期了 💌' : `有 ${readyN} 封信到期了 💌`), 1300);
      }
    }

    // 每日一问
    const qIndex = Math.abs(Math.floor(Date.now() / DAY)) % D.QUESTIONS.length;
    $('#q-day').textContent = `第 ${qIndex + 1} 问`;
    $('#q-ask').textContent = D.QUESTIONS[qIndex];
    const tKey = ymd(new Date());
    const exist = state.qa.find((x) => x.date === tKey);
    // 正在打字的草稿别被重渲染冲掉（同步回来会整天重画这一页）
    const qaBox = $('#q-answer');
    const draft = qaDraft;
    if (document.activeElement === qaBox && qaBox.value.trim()) {
      // 用户正在写，保持原样
    } else if (draft && draft.date === tKey && draft.text.trim()) {
      qaBox.value = draft.text;
    } else {
      qaBox.value = exist ? exist.a : '';
    }
    $('#q-state').textContent = exist ? '今天已经答过了，可以再改。' : '答完会存进这里，只有我们能看到。';

    const hist = state.qa.slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6);
    $('#q-history').innerHTML = hist.length ? hist.map((x) => `
      <div class="qa">
        <div class="qa-q">${esc(x.q)}</div>
        <div class="qa-a">${esc(x.a)}</div>
        <div class="qa-t">${esc(x.date)}${x.by ? ' · ' + esc(x.by) + ' 答' : ''}</div>
      </div>`).join('') : '';
  }

  function openCapsuleModal() {
    openModal(`
      <h3>写一封寄往未来的信</h3>
      <p class="modal-sub">封上之后，在解锁日之前，你自己也读不到它。</p>
      <div class="field">
        <label>标题</label>
        <input type="text" id="cap-title" maxlength="24" placeholder="给一年后的我们">
      </div>
      <div class="field">
        <label>信的内容</label>
        <textarea id="cap-body" rows="6" placeholder="现在的我们在做什么？希望那时的我们是什么样子？"></textarea>
      </div>
      <div class="field">
        <label>什么时候解锁</label>
        <div class="seg" id="cap-preset">
          ${D.CAPSULE_PRESETS.map((p, i) => `<button type="button" data-d="${p.d}" class="${i === 0 ? 'is-on' : ''}">${esc(p.k)}</button>`).join('')}
        </div>
        <div style="margin-top:10px">
          <input type="date" id="cap-date" value="${ymd(new Date(Date.now() + 365 * DAY))}">
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn" data-close="1" type="button">取消</button>
        <button class="btn btn-primary" id="cap-save" type="button">封上这封信 🔴</button>
      </div>
    `, (root) => {
      $('#cap-preset', root).addEventListener('click', (e) => {
        const b = e.target.closest('[data-d]'); if (!b) return;
        $$('[data-d]', root).forEach((x) => x.classList.toggle('is-on', x === b));
        const d = Number(b.dataset.d);
        if (d > 0) $('#cap-date', root).value = ymd(new Date(Date.now() + d * DAY));
      });
      $('#cap-save', root).onclick = () => {
        const title = $('#cap-title', root).value.trim() || '给未来的我们';
        const body = $('#cap-body', root).value.trim();
        const unlock = $('#cap-date', root).value;
        if (!body) { toast('还什么都没写呢'); return; }
        if (!unlock) { toast('选一个解锁日'); return; }
        if (parseDT(unlock + 'T00:00:00').getTime() < today0().getTime()) {
          toast('解锁日要选在未来呀'); return;
        }
        state.capsules.push({ id: uid(), title, body, created: new Date().toISOString(), unlock, opened: false });
        save(); closeModal(); renderCapsules(); renderHome();
        toast('封好了，到期再见 💌');
      };
    });
  }

  /* ==================== 一百件小事（可以自己编辑） ==================== */
  let bucketCat = '全部';

  /* 第一次打开：把 data.js 里的清单搬进 state，并给每件一个稳定的 id */
  function ensureBucketItems() {
    if (!Array.isArray(state.bucketItems)) state.bucketItems = [];
    if (!state.bucketItems.length) {
      state.bucketItems = D.BUCKET.map((x, i) => ({ id: 'b' + i, t: x[0], c: x[1] }));
      // 老版本按序号记的，顺手迁成 id
      const old = state.bucket || {};
      const next = {};
      Object.keys(old).forEach((k) => {
        const n = Number(k);
        next[Number.isInteger(n) && String(n) === k ? ('b' + n) : k] = old[k];
      });
      state.bucket = next;
      save();
    }
    return state.bucketItems;
  }

  function bucketCats(items) {
    const set = [];
    items.forEach((x) => { if (x.c && set.indexOf(x.c) < 0) set.push(x.c); });
    return set;
  }

  function renderBucket() {
    const items = ensureBucketItems();
    const total = items.length;
    const doneCount = items.filter((x) => state.bucket[x.id]).length;
    const left = Math.max(0, total - doneCount);

    $('#b-done').textContent = doneCount;
    const totalEl = $('#b-total');
    if (totalEl) totalEl.textContent = total;
    $('#b-bar').style.width = (total ? (doneCount / total) * 100 : 0) + '%';

    $('#b-tip').textContent = !total
      ? '清单空了，点下面「＋ 添一件」把你们的事写回来。'
      : doneCount === 0
        ? '先划掉第一件吧。'
        : (left === 0 ? '全部完成，我们太厉害了 🏆' : `已经完成 ${doneCount} 件，还剩 ${left} 件。`);

    const cats = ['全部', ...bucketCats(items)];
    if (cats.indexOf(bucketCat) < 0) bucketCat = '全部';
    $('#b-chips').innerHTML = cats.map((c) =>
      `<button class="chip ${c === bucketCat ? 'is-on' : ''}" data-cat="${esc(c)}" type="button">${esc(c)}</button>`).join('');

    const rows = items
      .map((x, i) => ({ ...x, no: i + 1 }))
      .filter((x) => bucketCat === '全部' || x.c === bucketCat)
      .map((x) => {
        const done = !!state.bucket[x.id];
        return `<div class="bk ${done ? 'is-done' : ''}">
          <button class="bk-main" type="button" data-bk="${esc(x.id)}">
            <span class="bk-no">${pad(x.no, 2)}</span>
            <span class="bk-t">${esc(x.t)}</span>
            ${x.c ? `<span class="bk-cat">${esc(x.c)}</span>` : ''}
            <span class="bk-box"><svg viewBox="0 0 16 16"><path d="M3 8.5l3.2 3.2L13 4.8"/></svg></span>
          </button>
          <button class="bk-edit" type="button" data-edit="${esc(x.id)}" title="编辑这一件" aria-label="编辑这一件">✎</button>
        </div>`;
      }).join('');

    $('#bucket-list').innerHTML = rows + `<button class="bk-add" type="button" id="bk-add">
      <span>＋ 添一件</span>
      <i>写一件只有我们懂的</i>
    </button>`;
  }

  function toggleBucket(id, el) {
    if (!id) return;
    const items = ensureBucketItems();
    if (state.bucket[id]) {
      delete state.bucket[id];
    } else {
      state.bucket[id] = Date.now();
      if (el) burstAt(el);
      const doneCount = items.filter((x) => state.bucket[x.id]).length;
      const t = D.BUCKET_DONE_TIPS[Math.floor(Math.random() * D.BUCKET_DONE_TIPS.length)]
        .replace('{n}', doneCount).replace('{left}', Math.max(0, items.length - doneCount));
      toast(t);
    }
    save(); renderBucket(); renderHome();
  }

  /* 添一件 / 改一件 */
  function openBucketItemModal(id) {
    const items = ensureBucketItems();
    const cur = id ? items.find((x) => x.id === id) : null;
    const cats = bucketCats(items);
    openModal(`
      <h3>${cur ? '改这件小事' : '添一件小事'}</h3>
      <p class="modal-sub">${cur ? '改完之后，打勾的状态不会变。' : '越具体越容易真的去做。'}</p>
      <div class="field">
        <label>写什么</label>
        <input type="text" id="bk-text" maxlength="60" value="${cur ? esc(cur.t) : ''}" placeholder="比如：一起去看一次海">
      </div>
      <div class="field">
        <label>分类（可以空着，也可以自己起一个）</label>
        <input type="text" id="bk-cat" maxlength="8" value="${cur ? esc(cur.c || '') : ''}" placeholder="一起 / 吃喝 / 旅行 / 甜 / 仪式 / 成长" list="bk-cats">
        <datalist id="bk-cats">${cats.map((c) => `<option value="${esc(c)}"></option>`).join('')}</datalist>
      </div>
      <div class="modal-actions">
        ${cur ? '<button class="btn btn-danger spacer" id="bk-del" type="button">删掉这件</button>' : ''}
        <button class="btn" data-close="1" type="button">取消</button>
        <button class="btn btn-primary" id="bk-save" type="button">${cur ? '改好了' : '加进去'}</button>
      </div>
    `, (root) => {
      if (cur) {
        $('#bk-del', root).onclick = () => {
          if (!confirm('删掉这件小事？它的打勾记录也会一起没掉。')) return;
          markDeleted('bucketItems', cur.id);
          state.bucketItems = state.bucketItems.filter((x) => x.id !== cur.id);
          delete state.bucket[cur.id];
          save(); closeModal(); renderBucket(); renderHome();
          toast('删掉了');
        };
      }
      $('#bk-save', root).onclick = () => {
        const text = $('#bk-text', root).value.trim();
        const cat = $('#bk-cat', root).value.trim();
        if (!text) { toast('写点什么呀'); return; }
        if (cur) {
          cur.t = text;
          cur.c = cat;
        } else {
          state.bucketItems.push({ id: uid(), t: text, c: cat });
        }
        save(); closeModal(); renderBucket(); renderHome();
        toast(cur ? '改好了' : '加进去了');
        if (!cur) burst(window.innerWidth / 2, window.innerHeight / 2, '📝', 8);
      };
    });
  }

  function randomPick() {
    const items = ensureBucketItems().filter((x) => !state.bucket[x.id]);
    if (!items.length) { toast('清单都完成啦 🏆'); return; }
    const pick = items[Math.floor(Math.random() * items.length)];
    openModal(`
      <h3>今天就做这一件</h3>
      <p class="modal-sub">命运抽中了：</p>
      <div class="card" style="padding:22px;text-align:center;font-size:16px;line-height:1.8">
        ${esc(pick.t)}
        ${pick.c ? `<div style="font-size:11.5px;color:var(--faint);margin-top:10px;letter-spacing:.16em">${esc(pick.c)}</div>` : ''}
      </div>
      <div class="modal-actions">
        <button class="btn" id="rp-again" type="button">换一个</button>
        <button class="btn btn-primary" id="rp-ok" type="button">就这件，去做</button>
      </div>
    `, (root) => {
      $('#rp-again', root).onclick = () => { closeModal(); setTimeout(randomPick, 120); };
      $('#rp-ok', root).onclick = () => {
        state.bucket[pick.id] = Date.now();
        save(); closeModal(); renderBucket(); renderHome();
        toast('划掉一件 ✅ 记得回来记一笔');
      };
    });
  }

  /* ==================== 打卡 ==================== */
  function openCheckin() {
    const tKey = ymd(new Date());
    if (state.checkins[tKey] != null) {
      toast(`今天已经打过卡啦，连续 ${streak()} 天 🔥`);
      return;
    }
    openModal(`
      <h3>今天的心情是</h3>
      <p class="modal-sub">打个卡，就算今天也认真喜欢过了。</p>
      <div class="field">${moodPicker(0)}</div>
      <div class="field">
        <label>想说一句（可选）</label>
        <input type="text" id="ck-note" maxlength="30" placeholder="今天也很好">
      </div>
      <div class="modal-actions">
        <button class="btn" data-close="1" type="button">取消</button>
        <button class="btn btn-primary" id="ck-save" type="button">存入今天</button>
      </div>
    `, (root) => {
      const getMood = bindMoodPicker(root, 0);
      $('#ck-save', root).onclick = () => {
        const mi = getMood();
        const note = $('#ck-note', root).value.trim();
        state.checkins[tKey] = { m: mi, n: note, by: state.config.me || '' };
        save(); closeModal(); renderAll();
        toast(`连续 ${streak()} 天 · 第 ${Object.keys(state.checkins).length} 次心动`);
        burst(window.innerWidth / 2, window.innerHeight * 0.55, '💗', 16);
      };
    });
  }

  /* ==================== 设置 / 数据 ==================== */
  /* 删掉的东西记一笔「墓碑」，不然下次同步又会被对方的云端数据顶回来 */
  function markDeleted(kind, id) {
    if (!id) return;
    state.deleted = state.deleted || {};
    state.deleted[kind] = state.deleted[kind] || {};
    state.deleted[kind][id] = Date.now();
  }

  /* 把对方传来的同步包并进来：只增不删，绝不覆盖本机已有记录 */
  function mergeState(incoming) {
    const stat = { added: 0, updated: 0, config: false };
    const has = (arr, id) => arr.some((x) => x && x.id === id);
    // 联网自检时混进云端的假记录，永远不再收进来
    const junk = (m) => !m || m.id === 'e2e1' || /端到端自检/.test(m.text || '');

    // ① 先并「已经删掉」的清单（删了就到处都不许再活过来）
    state.deleted = state.deleted || {};
    const incDel = incoming.deleted || {};
    Object.keys(incDel).forEach((kind) => {
      const map = incDel[kind];
      if (!map || typeof map !== 'object') return;
      state.deleted[kind] = state.deleted[kind] || {};
      Object.keys(map).forEach((id) => {
        const mine = state.deleted[kind][id] || 0;
        const other = map[id] || 0;
        if (!mine || other > mine) state.deleted[kind][id] = other || Date.now();
      });
    });
    const dead = (kind, id) => !!(state.deleted[kind] && state.deleted[kind][id]);

    // ② 对方删掉的，本机也跟着摘掉
    ['moments', 'anns', 'capsules', 'bucketItems'].forEach((kind) => {
      const map = state.deleted[kind];
      if (!map) return;
      const before = (state[kind] || []).length;
      state[kind] = (state[kind] || []).filter((x) => !(x && map[x.id]));
      if (state[kind].length !== before) stat.updated++;
    });

    (incoming.moments || []).forEach((m) => {
      if (!m || !m.id || junk(m) || dead('moments', m.id)) return;
      if (!has(state.moments, m.id)) { state.moments.push(m); stat.added++; }
    });

    (incoming.capsules || []).forEach((c) => {
      if (!c || !c.id || dead('capsules', c.id)) return;
      const mine = state.capsules.find((x) => x && x.id === c.id);
      if (!mine) { state.capsules.push(c); stat.added++; }
      else if (c.opened && !mine.opened) { mine.opened = true; stat.updated++; }
    });

    (incoming.anns || []).forEach((a) => {
      if (!a || !a.id || dead('anns', a.id)) return;
      if (has(state.anns, a.id)) return;
      // 同名同日期同重复方式的，算同一个纪念日，别再塞一条重复的进来
      const sig = [a.name, a.date, a.repeat].join('|');
      if (state.anns.some((x) => x && [x.name, x.date, x.repeat].join('|') === sig)) return;
      state.anns.push(a); stat.added++;
    });

    // 一百件小事：按 id 合并，本机勾过的「做过」不会被对方覆盖掉
    (incoming.bucketItems || []).forEach((it) => {
      if (!it || !it.id || dead('bucketItems', it.id)) return;
      const mine = (state.bucketItems || []).find((x) => x && x.id === it.id);
      if (!mine) { state.bucketItems.push(it); stat.added++; }
      else {
        if (it.done && !mine.done) { mine.done = true; stat.updated++; }
        if (!mine.text && it.text) { mine.text = it.text; stat.updated++; }
      }
    });

    Object.keys(incoming.bucket || {}).forEach((k) => {
      if (state.bucket[k] == null) { state.bucket[k] = incoming.bucket[k]; stat.added++; }
    });

    Object.keys(incoming.checkins || {}).forEach((k) => {
      if (state.checkins[k] == null) { state.checkins[k] = incoming.checkins[k]; stat.added++; }
    });

    // 每日一问按日期去重，本机答过的以本机为准
    const dates = new Set(state.qa.map((x) => x && x.date));
    (incoming.qa || []).forEach((x) => {
      if (!x || !x.date || dates.has(x.date)) return;
      state.qa.push(x); dates.add(x.date); stat.added++;
    });

    // 本机还是默认值时才采用对方的称呼和起点，避免互相改花
    const cfg = incoming.config || {};
    if (cfg.start && state.config.start === DEFAULT_START && cfg.start !== DEFAULT_START) {
      state.config.start = cfg.start; stat.config = true;
    }
    if (cfg.me && state.config.me === '我' && cfg.me !== '我') { state.config.me = cfg.me; stat.config = true; }
    if (cfg.you && state.config.you === '你' && cfg.you !== '你') { state.config.you = cfg.you; stat.config = true; }

    state.seen.banner = true;
    return stat;
  }

  /* ==================== 云端同步（GitHub Gist / Gitee） ==================== */
  const SYNC_FILE = 'shijiu-sync.json';

  /* GitHub 认两种写法：token 和 Bearer。个别令牌只认后者，401 就换一种再试 */
  async function ghFetch(url, token, opts) {
    const o = opts || {};
    const send = (scheme) => fetch(url, {
      ...o,
      headers: { ...(o.headers || {}), Authorization: scheme + ' ' + token, Accept: 'application/vnd.github+json' }
    });
    const first = await send('token');
    if (first.status !== 401) return first;
    const second = await send('Bearer');
    return second;
  }

  const SYNC_PROVIDERS = {
    github: {
      name: 'GitHub 私有 Gist',
      async create(token, payload) {
        return ghFetch('https://api.github.com/gists', token, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ description: '拾玖·时光 · 同步空间', public: false, files: { [SYNC_FILE]: { content: payload } } })
        });
      },
      async read(token, id) {
        return ghFetch('https://api.github.com/gists/' + encodeURIComponent(id), token, {});
      },
      async write(token, id, payload) {
        return ghFetch('https://api.github.com/gists/' + encodeURIComponent(id), token, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ files: { [SYNC_FILE]: { content: payload } } })
        });
      },
      pick(js) {
        const f = js && js.files && js.files[SYNC_FILE];
        if (!f || f.truncated) return '';
        return f.content || '';
      }
    },
    gitee: {
      name: 'Gitee 码云',
      async create(token, payload) {
        return fetch('https://gitee.com/api/v5/gists', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            access_token: token, description: '拾玖·时光 · 同步空间', public: false,
            files: { [SYNC_FILE]: { content: payload } }
          })
        });
      },
      async read(token, id) {
        return fetch('https://gitee.com/api/v5/gists/' + encodeURIComponent(id) + '?access_token=' + encodeURIComponent(token));
      },
      async write(token, id, payload) {
        return fetch('https://gitee.com/api/v5/gists/' + encodeURIComponent(id), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ access_token: token, files: { [SYNC_FILE]: { content: payload } } })
        });
      },
      pick(js) {
        const f = js && js.files && js.files[SYNC_FILE];
        return f ? (f.content || '') : '';
      }
    }
  };

  function syncCfg() {
    if (!state.config.sync || typeof state.config.sync !== 'object') {
      state.config.sync = { provider: 'github', token: '', gist: '', lastAt: 0, auto: true };
    }
    const c = state.config.sync;
    const seed = parseInvite(BUILTIN_INVITE);
    if (seed) {
      // 用的是「自己配的」就完全不动它；否则跟着内置那把钥匙走（换新钥匙时自动升级）
      const mine = c.src === 'user' && c.token && c.gist;
      if (!mine && c.keyVersion !== KEY_VERSION) {
        c.provider = seed.p || 'github';
        c.token = seed.t || '';
        c.gist = seed.g || '';
        c.src = 'builtin';
        c.keyVersion = KEY_VERSION;
      }
      if (!c.provider) c.provider = seed.p || 'github';
      if (!c.token) c.token = seed.t || '';
      if (!c.gist) c.gist = seed.g || '';
    }
    if (typeof c.auto !== 'boolean') c.auto = true;
    // 老版本存着 auto:false，第一次升级时替 TA 打开自动同步，之后照用户的开关走
    if (!c.autoSeeded) { c.autoSeeded = true; if (c.token && c.gist) c.auto = true; }
    return c;
  }

  /* 令牌失效时悄悄换回内置信箱，用户不会看到 401 */
  function useBuiltinSync(c) {
    const seed = parseInvite(BUILTIN_INVITE);
    if (!seed || !seed.t) return false;
    if (seed.t === c.token && seed.g === c.gist) return false;
    c.token = seed.t;
    if (seed.g) c.gist = seed.g;
    if (seed.p) c.provider = seed.p;
    save();
    return true;
  }

  function syncStateText() {
    const c = syncCfg();
    if (!c.gist) return '未开启 · 也可以只靠同步包互传';
    const name = (SYNC_PROVIDERS[c.provider] || {}).name || c.provider;
    const auto = c.auto ? ' · 自动同步' : '';
    // 上次同步是失败的 → 直接说清楚，别让人以为还在同步（云端那份不会因此消失）
    if (c.failAt && (!c.lastAt || c.failAt > c.lastAt)) {
      const f = new Date(c.failAt);
      const why = c.failStatus ? `（HTTP ${c.failStatus}）` : '';
      return `⚠ 上次没同步成功${why} · ${f.getMonth() + 1} 月 ${f.getDate()} 日 ${pad(f.getHours())}:${pad(f.getMinutes())} · 云端那份还在，点「配置」看日志`;
    }
    if (!c.lastAt) return `已连接 ${name}${auto} · 还没同步过`;
    const d = new Date(c.lastAt);
    const days = Math.floor((Date.now() - c.lastAt) / 86400000);
    const stale = days >= 14 ? ` · 已经 ${days} 天没同步，最好打开一次` : '';
    return `已连接 ${name}${auto} · 上次 ${d.getMonth() + 1} 月 ${d.getDate()} 日 ${pad(d.getHours())}:${pad(d.getMinutes())}${stale}`;
  }

  /* 太大就把照片剔掉，先保住文字；钥匙本身永远不写进云端 */
  function syncPayload() {
    const clone = JSON.parse(JSON.stringify(state));
    if (clone.config) delete clone.config.sync;
    // 自检混进来的假记录，别再从任何一台设备推回云端
    clone.moments = (clone.moments || []).filter((m) => !(m && (m.id === 'e2e1' || /端到端自检/.test(m.text || ''))));
    // 同名同期的纪念日推上去之前先并一遍，云端就不会越堆越多
    const sigs = new Set();
    clone.anns = (clone.anns || []).filter((a) => {
      if (!a) return false;
      const sig = [a.name, a.date, a.repeat].join('|');
      if (sigs.has(sig)) return false;
      sigs.add(sig);
      return true;
    });
    let text = JSON.stringify(clone);
    let stripped = false;
    if (text.length > 900000) {
      clone.moments = (clone.moments || []).map((m) => ({ ...m, img: '' }));
      text = JSON.stringify(clone);
      stripped = true;
    }
    return { text, stripped };
  }

  /* ==================== 文字同步：复制 / 粘贴，不碰文件 ==================== */
  function bytesToB64(bytes) {
    let s = '';
    const CH = 0x8000;
    for (let i = 0; i < bytes.length; i += CH) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    }
    return btoa(s);
  }
  function b64ToBytes(b64) {
    const s = atob(String(b64).replace(/\s+/g, ''));
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }
  async function gzipBytes(bytes) {
    if (typeof CompressionStream === 'undefined') return null;
    const st = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
    return new Uint8Array(await new Response(st).arrayBuffer());
  }
  async function gunzipBytes(bytes) {
    if (typeof DecompressionStream === 'undefined') return null;
    const st = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Uint8Array(await new Response(st).arrayBuffer());
  }

  /* 生成一段可以微信发的文本：去掉照片，尽量压缩 */
  async function makeSyncText() {
    const clone = JSON.parse(JSON.stringify(state));
    delete clone.seen;
    clone.moments = (clone.moments || []).map((m) => ({ ...m, img: '' }));
    const raw = new TextEncoder().encode(JSON.stringify(clone));
    // 不压缩：SJT1 任何浏览器都能读；几 KB 的文字，压不压差别不大，兼容更重要
    return 'SJT1.' + bytesToB64(raw);
  }

  async function parseSyncText(text) {
    const s = String(text || '');
    const m = /SJT([123])\.([A-Za-z0-9+/=]+)/.exec(s.replace(/\s+/g, ' '));
    if (!m) throw new Error('bad-sync-text');
    const ver = m[1];
    const b64 = m[2].replace(/\s+/g, '');
    let bytes = b64ToBytes(b64);
    if (ver === '2') {
      const out = await gunzipBytes(bytes);
      if (!out) throw new Error('no-decompress');
      bytes = out;
    }
    return JSON.parse(new TextDecoder().decode(bytes));
  }

  function openTextImport() {
    openModal(`
      <h3>粘贴同步文本</h3>
      <p class="modal-sub">把对方发来的那一整段（<b>SJT2.</b> 开头）粘进来，照片不会同步，文字和打勾都在。</p>
      <textarea id="txt-in" rows="6" placeholder="SJT2.xxxxxxxx…"></textarea>
      <div class="modal-actions">
        <button class="btn" data-close="1" type="button">取消</button>
        <button class="btn btn-primary" id="txt-merge" type="button">合并进来</button>
      </div>
    `, (root) => {
      $('#txt-merge', root).onclick = async () => {
        const raw = $('#txt-in', root).value;
        if (!raw.trim()) { toast('还没粘贴呢'); return; }
        let o;
        try {
          o = await parseSyncText(raw);
        } catch (e) {
          toast('这段不完整，让她重新复制一次发你', 4200);
          return;
        }
        if (!o || !o.config) { toast('这段缺少内容'); return; }
        const stat = mergeState(o);
        save(); closeModal(); renderAll();
        const bits = [];
        if (stat.added) bits.push(`新增 ${stat.added} 条`);
        if (stat.updated) bits.push(`更新 ${stat.updated} 条`);
        toast(bits.length ? '已合并：' + bits.join('、') : '没有新内容，两边已经一样啦', 4200);
        if (stat.added) burst(window.innerWidth / 2, window.innerHeight / 2, '💗', 12);
      };
    });
  }

  /* 复制不了就退回到一个可手动复制的框 */
  function openTextCopy(text) {
    openModal(`
      <h3>复制这段发给她</h3>
      <p class="modal-sub">长按下面整段 → 全选 → 复制。照片不会同步，文字和打勾都在。</p>
      <textarea id="txt-out" rows="8">${esc(text)}</textarea>
      <div class="modal-actions">
        <button class="btn btn-primary" data-close="1" type="button">好了</button>
      </div>
    `, (root) => {
      const el = $('#txt-out', root);
      el.focus();
      el.select();
    });
  }

  function httpHint(code) {
    return ({
      401: '令牌无效或已过期',
      403: '权限不够，或请求太频繁',
      404: '同步码不对，或令牌看不到这个空间',
      422: '内容太大，或格式不被接受',
      429: '请求太频繁，等一分钟再试'
    })[code] || '服务端返回了错误';
  }

  async function createSpace(log) {
    const c = syncCfg();
    const p = SYNC_PROVIDERS[c.provider];
    if (!c.token) { log('先填访问令牌'); return; }
    log('正在创建私有同步空间…');
    try {
      const r = await p.create(c.token, syncPayload().text);
      if (!r.ok) { log(`创建失败：HTTP ${r.status} · ${httpHint(r.status)}`); return; }
      const js = await r.json();
      const id = js.id || js.gist_id || '';
      if (!id) { log('创建成功但没拿到同步码，请把返回内容告诉我'); return; }
      c.gist = id;
      c.lastAt = Date.now();
      save();
      log('创建成功 ✓');
      log('同步码：' + id);
      log('点「复制邀请串」发给她，她那边点「用邀请串加入」即可。');
    } catch (e) {
      log('网络错误：' + e.message + '（可能是被拦截或没网）');
    }
  }

  /* 核心：拉取 → 合并 → 推送。手动和自动两条路共用 */
  let syncBusy = false;
  let autoSyncTimer = null;
  let lastAutoAt = 0;

  async function runSync(log) {
    const c = syncCfg();
    const p = SYNC_PROVIDERS[c.provider];
    const res = { ok: false, added: 0, updated: 0, stripped: false, reason: '' };
    if (!c.token || !c.gist) { res.reason = 'not-configured'; return res; }
    if (syncBusy) { res.reason = 'busy'; return res; }
    syncBusy = true;
    syncSaving = true;
    try {
      // 诊断：把这次真正用到的凭据打出来，省得靠猜
      log(`凭据：${c.provider} · 令牌 ${c.token.length} 位（${c.token.slice(0, 4)}…）· 同步码 ${String(c.gist).slice(0, 8)}…`);
      log('正在拉取…');
      let r = await p.read(c.token, c.gist);
      if (r.status === 401 && useBuiltinSync(c)) {
        log('原来的令牌过期了，已自动换回内置信箱…');
        r = await p.read(c.token, c.gist);
      }
      if (!r.ok) {
        res.reason = `HTTP ${r.status} · ${httpHint(r.status)}`;
        c.failAt = Date.now(); c.failStatus = r.status; save();
        log('拉取失败：' + res.reason);
        return res;
      }
      const js = await r.json();
      const content = p.pick(js);
      if (content) {
        try {
          const merged = mergeState(JSON.parse(content));
          res.added = merged.added;
          res.updated = merged.updated;
          save(); renderAll();
        } catch (e) {
          log('对方的数据解不开，这次只推送不合并');
        }
      } else {
        log('对方还没推送过内容');
      }
      log(`合并完成：新增 ${res.added} 条，更新 ${res.updated} 条`);

      log('正在推送…');
      const payload = syncPayload();
      const w = await p.write(c.token, c.gist, payload.text);
      if (!w.ok) {
        res.reason = `HTTP ${w.status} · ${httpHint(w.status)}`;
        c.failAt = Date.now(); c.failStatus = w.status; save();
        log('推送失败：' + res.reason);
        return res;
      }
      c.lastAt = Date.now();
      c.failAt = 0;
      c.failStatus = 0;
      save();
      res.ok = true;
      res.stripped = payload.stripped;
      log('同步完成 ✓' + (payload.stripped ? '（照片太大，这次只同步了文字）' : ''));
      if (res.added) burst(window.innerWidth / 2, window.innerHeight / 2, '💗', 12);
      return res;
    } catch (e) {
      res.reason = e && e.message ? e.message : '网络错误';
      log('网络错误：' + res.reason + '（可能是被拦截或没网）');
      return res;
    } finally {
      syncBusy = false;
      syncSaving = false;
    }
  }

  /* 手动：在弹层里点「立即同步」 */
  async function syncNow(log) {
    const c = syncCfg();
    if (!c.token || !c.gist) { log('还没有令牌或同步码，先创建或加入'); return; }
    const r = await runSync(log);
    if (r.reason === 'busy') log('正在同步中，稍等一下…');
  }

  /* 自动：打开 App / 回到前台 / 写完一条之后 */
  let autoSyncReady = function () {
    const c = syncCfg();
    return !!(c.auto && c.token && c.gist);
  };

  function scheduleAutoSync(delay) {
    if (syncBusy || !autoSyncReady()) return;
    clearTimeout(autoSyncTimer);
    autoSyncTimer = setTimeout(function () { autoSync('write'); }, delay == null ? 8000 : delay);
  }

  async function autoSync(trigger) {
    if (!autoSyncReady() || syncBusy) return;
    // 不管谁触发的，15 秒内不重复跑，避免自己排自己转成风火轮
    if (Date.now() - lastAutoAt < 15000) return;
    lastAutoAt = Date.now();
    const r = await runSync(function () {});
    if (r.ok && (r.added || r.updated)) {
      toast(r.added ? `已和对方同步 · 新增 ${r.added} 条` : '已和对方同步 · 有更新');
    }
  }

  /* 邀请串 = 服务商 + 令牌 + 同步码，一串带走 */
  function inviteString() {
    const c = syncCfg();
    if (!c.gist) return '';
    const data = JSON.stringify({ p: c.provider, t: c.token, g: c.gist });
    return 'SJ1.' + btoa(unescape(encodeURIComponent(data)));
  }

  function parseInvite(s) {
    s = String(s || '').trim();
    if (s.indexOf('SJ1.') !== 0) return null;
    try { return JSON.parse(decodeURIComponent(escape(atob(s.slice(4))))); } catch (e) { return null; }
  }

  function openSyncModal() {
    const c = syncCfg();
    openModal(`
      <h3>云端同步</h3>
      <p class="modal-sub">把记录放在一个只有你们知道的地方。全程只调用 API，不会打开任何网页。</p>

      <div class="field">
        <label>服务商</label>
        <div class="seg" id="sp-provider">
          <button type="button" data-p="github" class="${c.provider === 'github' ? 'is-on' : ''}">GitHub 私有 Gist</button>
          <button type="button" data-p="gitee" class="${c.provider === 'gitee' ? 'is-on' : ''}">Gitee 码云</button>
        </div>
      </div>

      <div class="field">
        <label>访问令牌（只保存在这台设备）</label>
        <input type="password" id="sp-token" value="${esc(c.token)}" placeholder="粘贴令牌" autocomplete="off">
      </div>

      <div class="field">
        <label>同步码</label>
        <input type="text" id="sp-gist" value="${esc(c.gist)}" placeholder="第一次用点下面「创建」">
      </div>

      <div class="set-row">
        <div class="set-label"><b>自动同步</b><span>打开 App、切回前台、写完 8 秒后自动跟对方对齐一次</span></div>
        <button class="btn btn-sm ${c.auto ? 'btn-primary' : ''}" id="sp-auto" type="button">${c.auto ? '已开' : '关着'}</button>
      </div>

      <div class="sp-actions">
        <button class="btn btn-sm" id="sp-create" type="button">创建同步空间</button>
        <button class="btn btn-sm" id="sp-join" type="button">用邀请串加入</button>
        <button class="btn btn-sm" id="sp-test" type="button">测试令牌</button>
        <button class="btn btn-sm" id="sp-invite" type="button">复制邀请串</button>
        <button class="btn btn-sm btn-primary" id="sp-sync" type="button">立即同步</button>
      </div>

      <div class="sp-log" id="sp-log">${c.lastAt ? '上次同步：' + fmtDT(new Date(c.lastAt)) : '还没有同步过'}</div>

      <div class="sp-help">
        <b>怎么拿令牌</b><br>
        GitHub：Settings → Developer settings → Personal access tokens → 勾选 <b>gist</b><br>
        Gitee：设置 → 私人令牌 → 勾选 <b>gists</b><br>
        邀请串里包含令牌，只发给她一个人。令牌随时可以在网站上撤销重置。
      </div>

      <div class="modal-actions">
        <button class="btn" data-close="1" type="button">关闭</button>
        <button class="btn btn-primary" id="sp-save" type="button">保存</button>
      </div>
    `, (root) => {
      const box = $('#sp-log', root);
      const log = (s) => { box.textContent += '\n' + s; box.scrollTop = box.scrollHeight; };
      let provider = c.provider;

      $('#sp-provider', root).addEventListener('click', (e) => {
        const b = e.target.closest('[data-p]'); if (!b) return;
        provider = b.dataset.p;
        $$('[data-p]', root).forEach((x) => x.classList.toggle('is-on', x === b));
      });

      const collect = () => {
        const cc = syncCfg();
        cc.provider = provider;
        cc.token = $('#sp-token', root).value.trim();
        cc.gist = $('#sp-gist', root).value.trim();
        return cc;
      };

      $('#sp-create', root).onclick = async () => {
        collect();
        await createSpace(log);
        const cc = syncCfg();
        cc.src = 'user';
        cc.keyVersion = KEY_VERSION;
        save();
        $('#sp-gist', root).value = syncCfg().gist;
      };
      $('#sp-sync', root).onclick = async () => { collect(); await syncNow(log); };

      /* 只验令牌，不碰 Gist，用来区分「令牌不认」和「权限不够」 */
      $('#sp-test', root).onclick = async () => {
        collect();
        const cc = syncCfg();
        if (!cc.token) { log('先填令牌'); return; }
        log(`—— 测试令牌（${cc.token.length} 位，${cc.token.slice(0, 4)}…）——`);
        const hit = async (url, scheme) => {
          try {
            const r = await fetch(url, { headers: { Authorization: scheme + ' ' + cc.token, Accept: 'application/vnd.github+json' } });
            return r.status;
          } catch (e) { return 'ERR ' + (e.message || e); }
        };
        const u1 = await hit('https://api.github.com/user', 'token');
        const u2 = u1 === 401 ? await hit('https://api.github.com/user', 'Bearer') : u1;
        log(`/user  → token 写法 ${u1}${u2 !== u1 ? ' · Bearer 写法 ' + u2 : ''}`);
        const okScheme = u2 === 200 ? (u2 === u1 ? 'token' : 'Bearer') : null;
        if (!okScheme) {
          log('结论：GitHub 不认这把令牌（已作废 / 已过期 / 复制不全）');
          return;
        }
        const g = await hit('https://api.github.com/gists?per_page=1', okScheme);
        log(`/gists → ${g}（写法 ${okScheme}）`);
        if (g === 200) log('结论：令牌可用，直接点「创建同步空间」');
        else if (g === 403 || g === 404) log('结论：令牌有效，但缺 gist 权限');
        else log('结论：gist 接口返回 ' + g);
      };

      $('#sp-auto', root).onclick = () => {
        collect();
        const cc = syncCfg();
        cc.auto = !cc.auto;
        save();
        const b = $('#sp-auto', root);
        b.textContent = cc.auto ? '已开' : '关着';
        b.classList.toggle('btn-primary', cc.auto);
        log(cc.auto ? '自动同步：已开启' : '自动同步：已关闭');
        if (cc.auto) {
          if (!cc.token || !cc.gist) log('还缺令牌或同步码，填好之后才会真的同步');
          else scheduleAutoSync(1500);
        }
      };
      $('#sp-invite', root).onclick = async () => {
        collect();
        const s = inviteString();
        if (!s) { log('还没有同步码，先创建'); return; }
        try {
          await navigator.clipboard.writeText(s);
          log('邀请串已复制，发给她即可（里面含令牌，别发群）');
        } catch (e) {
          log('复制失败，请手动复制下面这串：');
          log(s);
        }
      };
      $('#sp-join', root).onclick = () => {
        const s = prompt('把对方发来的邀请串粘贴到这里：');
        if (!s) return;
        const o = parseInvite(s);
        if (!o || !o.g || !o.t) { log('邀请串不对，检查一下有没有复制完整'); return; }
        const cc = syncCfg();
        cc.provider = o.p === 'gitee' ? 'gitee' : 'github';
        cc.token = o.t;
        cc.gist = o.g;
        cc.src = 'user';
        cc.keyVersion = KEY_VERSION;
        provider = cc.provider;
        save();
        $('#sp-token', root).value = cc.token;
        $('#sp-gist', root).value = cc.gist;
        $$('[data-p]', root).forEach((x) => x.classList.toggle('is-on', x.dataset.p === cc.provider));
        log('已加入，点「立即同步」试试');
      };
      $('#sp-save', root).onclick = () => {
        const cc = collect();
        cc.src = 'user';
        cc.keyVersion = KEY_VERSION;
        save();
        closeModal();
        toast('同步设置已保存');
      };
    });
  }

  /* 把离线缓存整个丢掉再重新加载（localStorage 里的记录不受影响） */
  async function hardRefresh() {
    try { closeModal(); } catch (e) { }
    toast('正在清掉旧缓存…', 1800);
    try {
      if (window.caches) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
    } catch (e) { console.warn('清缓存失败', e); }
    try {
      if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
      }
    } catch (e) { console.warn('注销 SW 失败', e); }
    setTimeout(() => { location.reload(); }, 300);
    return true;
  }

  /* 装到主屏幕的提示语 */
  function isIOS() { return /iPad|iPhone|iPod/.test(navigator.userAgent); }
  function isStandalone() {
    if (navigator.standalone) return true; // iOS Safari
    return !!(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
  }
  function installHint() {
    if (location.protocol === 'file:') return '现在是本地文件模式，装不了；用网址打开才行';
    if (isStandalone()) return '已经装好啦，就在主屏幕上';
    return isIOS() ? 'Safari → 分享 → 添加到主屏幕' : '浏览器菜单（⋮）→ 添加到主屏幕';
  }

  function openSettings() {
    openModal(`
      <h3>设置</h3>
      <p class="modal-sub">这些都是只存在你自己设备上的数据，不会上传到任何地方。</p>

      <div class="field-row">
        <div class="field"><label>我的称呼</label><input type="text" id="set-me" maxlength="8" value="${esc(state.config.me)}"></div>
        <div class="field"><label>她的称呼</label><input type="text" id="set-you" maxlength="8" value="${esc(state.config.you)}"></div>
      </div>

      <div class="field">
        <label>我们确认关系的时间</label>
        <input type="datetime-local" id="set-start" value="${esc(state.config.start)}">
      </div>

      <div class="field">
        <label>主题</label>
        <div class="seg" id="set-theme">
          ${['auto', 'paper', 'night', 'rose'].map((t) => `<button type="button" data-t="${t}" class="${normalizeTheme(state.config.theme) === t ? 'is-on' : ''}">${THEME_LABEL[t]}</button>`).join('')}
        </div>
        <p class="modal-sub" style="margin:9px 0 0;font-size:11px">「随时刻」会在 19 点后自动翻到墨夜，白天回到宣纸。</p>
      </div>

      <div class="field-row">
        <div class="field"><label>我们的暗号</label><input type="text" id="set-secret" maxlength="16" value="${esc(state.config.secret)}" placeholder="随便打几个字"></div>
        <div class="field"><label>暗号彩蛋</label><input type="text" id="set-secretmsg" maxlength="30" value="${esc(state.config.secretMsg)}"></div>
      </div>
      <p class="modal-sub" style="margin-top:-6px">在任何页面连续敲出暗号，会掉出一句悄悄话。</p>

      <div class="set-row">
        <div class="set-label"><b>装到手机上</b><span>${installHint()}</span></div>
        <button class="btn btn-sm" id="set-install" type="button">怎么做</button>
      </div>

      <div class="set-row">
        <div class="set-label"><b>检查更新</b><span>看到的是旧界面？点一下清掉离线缓存再重新加载（记录不会丢）</span></div>
        <button class="btn btn-sm" id="set-refresh" type="button">强制更新</button>
      </div>

      <div class="set-row">
        <div class="set-label"><b>云端同步</b><span>${syncStateText()}</span></div>
        <button class="btn btn-sm" id="set-sync" type="button">配置</button>
      </div>
      <div class="set-row">
        <div class="set-label"><b>导出同步包</b><span>一个 JSON 文件，发给她，或带到新手机</span></div>
        <button class="btn btn-sm" id="set-export" type="button">导出</button>
      </div>
      <div class="set-row">
        <div class="set-label"><b>复制同步文本</b><span>文字版（不含照片）· 微信直接粘给她，不用找文件</span></div>
        <button class="btn btn-sm" id="set-copytext" type="button">复制</button>
      </div>
      <div class="set-row">
        <div class="set-label"><b>粘贴并合并</b><span>把她发来的那整段粘进来</span></div>
        <button class="btn btn-sm" id="set-pastetext" type="button">粘贴</button>
      </div>
      <div class="set-row">
        <div class="set-label"><b>合并同步包</b><span>按记录合并，只增不删，不会覆盖你已有的内容</span></div>
        <button class="btn btn-sm" id="set-import" type="button">合并</button>
        <input type="file" id="set-file" accept="application/json,.json" hidden>
      </div>
      <div class="set-row">
        <div class="set-label"><b>清空全部</b><span>删掉所有记录，无法恢复</span></div>
        <button class="btn btn-sm btn-danger" id="set-clear" type="button">清空</button>
      </div>

      <div class="set-about">
        <b>拾玖 · 时光</b> v2.0 · 纸册版<br>
        一个装在单个文件夹里的恋爱纪念册。<br>
        所有数据保存在这台设备的浏览器里；想两台设备同步，用「导出 / 合并」。<br>
        主题跟着时刻走：白昼宣纸，入夜墨灯。
      </div>

      <div class="modal-actions">
        <button class="btn" data-close="1" type="button">取消</button>
        <button class="btn btn-primary" id="set-save" type="button">保存</button>
      </div>
    `, (root) => {
      let theme = normalizeTheme(state.config.theme);
      const previewTheme = (t) => {
        if (t !== 'auto') return t;
        const hh = new Date().getHours();
        return (hh >= 19 || hh < 5) ? 'night' : 'paper';
      };
      $('#set-theme', root).addEventListener('click', (e) => {
        const b = e.target.closest('[data-t]'); if (!b) return;
        theme = b.dataset.t;
        $$('[data-t]', root).forEach((x) => x.classList.toggle('is-on', x === b));
        document.documentElement.dataset.theme = previewTheme(theme);
      });

      $('#set-sync', root).onclick = () => { closeModal(); setTimeout(openSyncModal, 120); };

      $('#set-install', root).onclick = () => {
        if (location.protocol === 'file:') {
          toast('这是本地文件模式，装不了；先在手机上用网址打开', 4200);
        } else if (isStandalone()) {
          toast('已经装好了，就是主屏幕上那个红印章', 3600);
        } else if (isIOS()) {
          toast('点 Safari 底部的「分享」，选「添加到主屏幕」', 4600);
        } else {
          toast('点浏览器右上角菜单，选「添加到主屏幕 / 安装应用」', 4600);
        }
      };

      $('#set-refresh', root).onclick = async () => {
        const btn = $('#set-refresh', root);
        btn.disabled = true;
        btn.textContent = '正在更新…';
        const ok = await hardRefresh();
        if (!ok) { btn.disabled = false; btn.textContent = '强制更新'; }
      };

      $('#set-export', root).onclick = async () => {
        const name = `拾玖时光-同步包-${ymd(new Date())}.json`;
        const data = JSON.stringify(state, null, 2);
        const blob = new Blob([data], { type: 'application/json' });
        // 手机上一键分享到微信，省得去文件管理器里找
        try {
          const file = new File([blob], name, { type: 'application/json' });
          if (navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share) {
            await navigator.share({ files: [file], title: '拾玖时光 · 同步包' });
            toast('选微信发给她就行');
            return;
          }
        } catch (e) {
          if (e && e.name === 'AbortError') return; // 用户取消
        }
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1500);
        toast('同步包已保存，发给她就行');
      };

      $('#set-copytext', root).onclick = async () => {
        let text = '';
        try { text = await makeSyncText(); } catch (e) { toast('生成失败，改用导出同步包'); return; }
        const hint = text.length > 9000
          ? '，比较长，微信可能折叠，建议改用导出同步包'
          : '';
        try {
          await navigator.clipboard.writeText(text);
          toast(`已复制（${text.length} 字符${hint}），粘给她就行`, 4800);
        } catch (e) {
          openTextCopy(text);
        }
      };

      $('#set-pastetext', root).onclick = () => { openTextImport(); };

      $('#set-import', root).onclick = () => $('#set-file', root).click();
      $('#set-file', root).onchange = (e) => {
        const f = e.target.files && e.target.files[0];
        if (!f) return;
        const fr = new FileReader();
        fr.onload = () => {
          let o;
          try {
            o = JSON.parse(fr.result);
            if (!o || typeof o !== 'object' || !o.config) throw new Error('bad');
          } catch (err) { toast('这个文件好像不是同步包'); return; }
          const stat = mergeState(o);
          save(); closeModal(); renderAll(); setPageHero();
          const bits = [];
          if (stat.added) bits.push(`新增 ${stat.added} 条`);
          if (stat.updated) bits.push(`更新 ${stat.updated} 条`);
          if (stat.config) bits.push('称呼已同步');
          toast(bits.length ? '已合并：' + bits.join('、') : '没有新内容，两边已经一致啦');
          if (stat.added) burst(window.innerWidth / 2, window.innerHeight / 2, '💗', 12);
        };
        fr.readAsText(f);
      };

      $('#set-clear', root).onclick = () => {
        if (!confirm('真的要清空所有记录吗？这一步不可撤回。')) return;
        // 先把每一条都记成「已删除」，否则同步一次又全回来了
        ['moments', 'anns', 'capsules', 'bucketItems'].forEach((kind) => {
          (state[kind] || []).forEach((x) => { if (x && x.id) markDeleted(kind, x.id); });
        });
        const keepSync = state.config.sync;
        const keepSeen = { ...state.seen };
        const keepDeleted = state.deleted || {};
        state = blankState();
        state.config.sync = keepSync;      // 钥匙留着，不然云端空间就断了
        state.seen = keepSeen;
        state.deleted = keepDeleted;       // 墓碑要留着，不然同步又把清掉的东西还回来
        state.config.me = $('#set-me', root) ? ($('#set-me', root).value.trim() || '我') : state.config.me;
        save(); closeModal(); renderAll(); setPageHero();
        toast('已经清空，从今天重新开始');
      };

      $('#set-save', root).onclick = () => {
        state.config.me = $('#set-me', root).value.trim() || '我';
        state.config.you = $('#set-you', root).value.trim() || '你';
        state.config.secret = $('#set-secret', root).value.trim();
        state.config.secretMsg = $('#set-secretmsg', root).value.trim();
        state.config.theme = theme;
        const st = $('#set-start', root).value;
        if (st) state.config.start = st;
        save(); closeModal(); applyTheme(); renderAll();
        toast(`改好了 · ${THEME_LABEL[theme] || '随时刻'}`);
      };

      // 取消 / 关闭时把预览中的主题还原
      return () => { applyTheme(); };
    });
  }

  /* ==================== 纪念卡海报 ==================== */
  /* 纪念卡：一张纸、一枚印、一个数字 */
  function drawPoster() {
    const W = 750, H = 1334;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    const days = Math.max(1, todayIndex());
    const sd = startDate();
    const th = resolveTheme();

    const pal = th === 'night'
      ? { bg: '#171420', glow: '#241c30', ink: '#f2e9db', dim: 'rgba(242,233,219,.66)', faint: 'rgba(242,233,219,.36)', seal: '#e2604a', sealInk: '#fdf6ed', gold: '#d8b57c' }
      : th === 'rose'
        ? { bg: '#fdf5f3', glow: '#f6e6e4', ink: '#2c1a1d', dim: 'rgba(44,26,29,.66)', faint: 'rgba(44,26,29,.4)', seal: '#a63a54', sealInk: '#fdf5f3', gold: '#8a5f47' }
        : { bg: '#fbf6ec', glow: '#f1e6d2', ink: '#241d18', dim: 'rgba(36,29,24,.66)', faint: 'rgba(36,29,24,.4)', seal: '#b7402b', sealInk: '#fdf6ec', gold: '#8d6b38' };

    const FS = '"Songti SC","STSong","SimSun","宋体",serif';
    const FK = '"Kaiti SC","STKaiti","KaiTi","楷体",serif';

    // 纸底
    ctx.fillStyle = pal.bg; ctx.fillRect(0, 0, W, H);
    const g = ctx.createRadialGradient(W * 0.5, H * 0.1, 40, W * 0.5, H * 0.1, W * 1.05);
    g.addColorStop(0, hexA(pal.glow, 0.95));
    g.addColorStop(1, hexA(pal.glow, 0));
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    // 纤维
    let seed = 20261019;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    ctx.save();
    ctx.fillStyle = pal.ink;
    for (let i = 0; i < 1100; i++) {
      ctx.globalAlpha = rnd() * 0.05 + 0.01;
      ctx.fillRect(rnd() * W, rnd() * H, 1 + rnd() * 2, 1);
    }
    ctx.restore();
    ctx.globalAlpha = 1;
    if (th === 'night') {
      for (let i = 0; i < 80; i++) {
        ctx.globalAlpha = rnd() * 0.55 + 0.12;
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(rnd() * W, rnd() * H, rnd() * 1.4 + 0.3, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // 双线框
    ctx.strokeStyle = hexA(pal.ink, 0.22); ctx.lineWidth = 1.5;
    ctx.strokeRect(34, 34, W - 68, H - 68);
    ctx.strokeStyle = hexA(pal.ink, 0.10); ctx.lineWidth = 1;
    ctx.strokeRect(46, 46, W - 92, H - 92);

    ctx.textAlign = 'center';

    // 品牌
    ctx.fillStyle = pal.faint;
    ctx.font = `400 20px ${FS}`;
    ctx.letterSpacing = '10px';
    ctx.fillText('拾 玖 · 时 光', W / 2, 128);
    ctx.letterSpacing = '0px';
    ctx.strokeStyle = hexA(pal.seal, 0.55); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(W / 2 - 26, 156); ctx.lineTo(W / 2 + 26, 156); ctx.stroke();

    // 第 N 天
    ctx.fillStyle = pal.dim;
    ctx.font = `400 30px ${FS}`;
    ctx.letterSpacing = '6px';
    ctx.fillText('我们在一起的第', W / 2, 306);
    ctx.letterSpacing = '0px';

    const num = String(days);
    ctx.fillStyle = pal.ink;
    ctx.font = `400 ${num.length > 3 ? 200 : 264}px ${FS}`;
    ctx.fillText(num, W / 2, 578);
    ctx.font = `400 34px ${FS}`;
    ctx.fillStyle = pal.dim;
    ctx.fillText('天', W / 2, 650);

    // 起点
    ctx.fillStyle = pal.faint;
    ctx.font = `400 24px ${FS}`;
    ctx.fillText(`始于 ${cnDate(sd)}`, W / 2, 726);

    // 名字
    const me = state.config.me, you = state.config.you;
    ctx.font = `400 44px ${FS}`;
    const wMe = ctx.measureText(me).width, wYou = ctx.measureText(you).width;
    const gap = 52, total = wMe + gap * 2 + wYou;
    let x = W / 2 - total / 2;
    ctx.textAlign = 'left';
    ctx.fillStyle = pal.ink;
    ctx.fillText(me, x, 830);
    ctx.fillStyle = pal.seal;
    ctx.font = `400 26px ${FS}`;
    ctx.fillText('♥', x + wMe + gap - 10, 824);
    ctx.font = `400 44px ${FS}`;
    ctx.fillStyle = pal.ink;
    ctx.fillText(you, x + wMe + gap * 2, 830);
    ctx.textAlign = 'center';

    // 分隔
    ctx.strokeStyle = hexA(pal.ink, 0.14); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(W * 0.22, 892); ctx.lineTo(W * 0.78, 892); ctx.stroke();

    // 下一站
    const nx = nextMilestone();
    const left = Math.max(0, daysUntil(nx.date));
    ctx.fillStyle = pal.gold;
    ctx.font = `400 26px ${FS}`;
    ctx.letterSpacing = '4px';
    ctx.fillText(`下一站 · ${nx.name}`, W / 2, 956);
    ctx.letterSpacing = '0px';
    ctx.fillStyle = pal.ink;
    ctx.font = `400 54px ${FS}`;
    ctx.fillText(left === 0 ? '就是今天' : `还有 ${left} 天`, W / 2, 1024);

    // 今日情话
    const q = String($('#h-quote').textContent || '').trim().replace(/^[“"]/, '').replace(/[”"]$/, '');
    if (q) {
      ctx.fillStyle = pal.dim;
      ctx.font = `400 26px ${FK}`;
      wrapText(ctx, `「${q}」`, W / 2, 1116, W - 250, 46);
    }

    // 一枚印
    ctx.save();
    ctx.translate(W - 100, 116);
    ctx.rotate(6 * Math.PI / 180);
    ctx.fillStyle = pal.seal;
    roundRect(ctx, -31, -31, 62, 62, 6);
    ctx.fill();
    ctx.fillStyle = pal.sealInk;
    ctx.font = `400 24px ${FS}`;
    ctx.textAlign = 'center';
    ctx.fillText('拾', 0, -4);
    ctx.fillText('玖', 0, 24);
    ctx.restore();

    // 页脚
    ctx.fillStyle = pal.faint;
    ctx.font = `400 18px ${FS}`;
    ctx.letterSpacing = '6px';
    ctx.fillText('1 0 · 1 9   2 3 : 4 5', W / 2, H - 66);

    return cv;
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function wrapText(ctx, text, cx, y, maxW, lh) {
    const chars = String(text).split('');
    let line = '';
    let yy = y;
    for (let i = 0; i < chars.length; i++) {
      const test = line + chars[i];
      if (ctx.measureText(test).width > maxW && line) {
        ctx.fillText(line, cx, yy);
        line = chars[i];
        yy += lh;
      } else line = test;
    }
    if (line) ctx.fillText(line, cx, yy);
  }

  function hexA(hex, a) {
    const h = hex.replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  function openPoster() {
    const cv = drawPoster();
    openModal(`
      <h3>我们的纪念卡</h3>
      <p class="modal-sub">保存下来，可以发给她，也可以存进相册。</p>
      <div class="poster-wrap" id="poster-holder"></div>
      <div class="modal-actions">
        <button class="btn" data-close="1" type="button">关闭</button>
        <button class="btn btn-primary" id="poster-save" type="button">保存图片</button>
      </div>
    `, (root) => {
      const holder = $('#poster-holder', root);
      cv.style.width = '100%';
      holder.appendChild(cv);
      $('#poster-save', root).onclick = () => {
        cv.toBlob((blob) => {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `拾玖时光-第${Math.max(1, todayIndex())}天.png`;
          document.body.appendChild(a); a.click(); a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 1500);
          toast('已保存到下载文件夹');
        }, 'image/png');
      };
    });
  }

  /* ==================== 路由 ==================== */
  const PAGES = ['home', 'days', 'memories', 'capsule', 'bucket'];
  let currentPage = 'home';

  function go(page) {
    if (!page) return;
    currentPage = page;
    $$('.page').forEach((p) => p.classList.toggle('is-active', p.dataset.page === page));
    $$('.tab').forEach((t) => t.classList.toggle('is-on', t.dataset.page === page));
    if (location.hash.slice(1) !== page) {
      try { location.hash = page; } catch (e) { }
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
    renderPage(page);
  }

  function route() {
    const h = location.hash.slice(1);
    if (h === 'poster') {
      go('home');
      setTimeout(openPoster, 260);
      return;
    }
    if (h === 'sync') {
      go('home');
      setTimeout(openSyncModal, 260);
      return;
    }
    go(PAGES.indexOf(h) >= 0 ? h : 'home');
  }

  function renderPage(page) {
    if (page === 'home') renderHome();
    else if (page === 'days') renderDays();
    else if (page === 'memories') renderMemories();
    else if (page === 'capsule') renderCapsules();
    else if (page === 'bucket') renderBucket();
  }

  function renderAll() {
    renderHome(); renderDays(); renderMemories(); renderCapsules(); renderBucket();
  }

  function setPageHero() { return applyTheme(); }

  /* ==================== 事件绑定 ==================== */
  function bind() {
    // 导航
    $('#tabbar').addEventListener('click', (e) => {
      const b = e.target.closest('.tab'); if (!b) return;
      go(b.dataset.page);
    });
    document.addEventListener('click', (e) => {
      const g = e.target.closest('[data-goto]');
      if (g) { go(g.dataset.goto); }
    });

    // 顶栏
    $('#btn-settings').onclick = openSettings;
    $('#btn-poster').onclick = openPoster;

    // 首页
    $('#h-add').onclick = () => openMomentModal('heart');
    $('#h-checkin').onclick = openCheckin;
    $('#h-quote-next').onclick = () => {
      const cur = $('#h-quote').textContent;
      let q = cur;
      let guard = 0;
      while (q === cur && guard++ < 12) q = D.QUOTES[Math.floor(Math.random() * D.QUOTES.length)];
      $('#h-quote').dataset.pinned = '1';
      setQuote(q, true);
    };
    $('#banner-fix').onclick = openSettings;
    $('#banner-x').onclick = () => { state.seen.banner = true; save(); $('#banner-year').hidden = true; };

    // 纪念日
    $('#btn-add-ann').onclick = openAnnModal;
    $('#ann-list').addEventListener('click', (e) => {
      const del = e.target.closest('[data-del-ann]');
      if (del) {
        if (!confirm('删除这个纪念日？')) return;
        markDeleted('anns', del.dataset.delAnn);
        state.anns = state.anns.filter((a) => a.id !== del.dataset.delAnn);
        save(); renderDays(); toast('已删除');
        return;
      }
      if (e.target.closest('#ann-add-tile')) openAnnModal();
    });

    // 拾光集
    $('#btn-add-mem').onclick = () => openMomentModal('memory');
    $('#mem-chips').addEventListener('click', (e) => {
      const c = e.target.closest('.chip'); if (!c) return;
      memFilter = c.dataset.filter;
      $$('.chip', $('#mem-chips')).forEach((x) => x.classList.toggle('is-on', x === c));
      renderMemories();
    });
    $('#timeline').addEventListener('click', (e) => {
      const del = e.target.closest('[data-del-mem]');
      const photo = e.target.closest('.tl-img');
      if (photo && !del) {
        openLightbox(photo.getAttribute('src'), photo.dataset.cap || '');
        return;
      }
      if (!del) return;
      if (!confirm('删掉这一条？')) return;
      markDeleted('moments', del.dataset.delMem);
      state.moments = state.moments.filter((m) => m.id !== del.dataset.delMem);
      save(); renderAll(); toast('已删除');
    });

    // 胶囊
    $('#btn-add-capsule').onclick = openCapsuleModal;
    $('#capsule-list').addEventListener('click', (e) => {
      const op = e.target.closest('[data-open]');
      if (op) {
        const c = state.capsules.find((x) => x.id === op.dataset.open);
        if (!c) return;
        c.opened = true;
        save(); renderCapsules();
        toast('拆开了 💌');
        burstAt(op);
        return;
      }
      const del = e.target.closest('[data-del-cap]');
      if (del) {
        if (!confirm('删除这封信？')) return;
        markDeleted('capsules', del.dataset.delCap);
        state.capsules = state.capsules.filter((c) => c.id !== del.dataset.delCap);
        save(); renderCapsules(); renderHome(); toast('已删除');
      }
    });

    // 每日一问
    /* 把今天的答案落盘；silent=true 时只存不重画（正在打字，别打断） */
    const saveQaAnswer = (silent) => {
      const box = $('#q-answer');
      const a = box.value.trim();
      if (!a) return false;
      const tKey = ymd(new Date());
      const qIndex = Math.abs(Math.floor(Date.now() / DAY)) % D.QUESTIONS.length;
      const exist = state.qa.find((x) => x.date === tKey);
      if (exist) {
        exist.a = a;
        exist.q = D.QUESTIONS[qIndex];
        if (!exist.by) exist.by = state.config.me || '';
      } else {
        state.qa.push({ id: uid(), date: tKey, q: D.QUESTIONS[qIndex], a, by: state.config.me || '' });
      }
      save();
      if (!silent) { renderCapsules(); toast('收下了 · 今天的答案'); burstAt($('#q-save')); }
      return true;
    };

    // 边写边存：哪怕忘了按「收下」，几秒后也已经进本地了
    let qaTimer = null;
    $('#q-answer').addEventListener('input', () => {
      qaDraft = { date: ymd(new Date()), text: $('#q-answer').value };
      clearTimeout(qaTimer);
      qaTimer = setTimeout(() => saveQaAnswer(true), 700);
    });
    $('#q-answer').addEventListener('blur', () => {
      clearTimeout(qaTimer);
      saveQaAnswer(true);
    });

    $('#q-save').onclick = () => {
      if (!saveQaAnswer(false)) { toast('还没写呢'); return; }
      qaDraft = null;
    };

    // 小事
    $('#btn-random').onclick = randomPick;
    $('#b-chips').addEventListener('click', (e) => {
      const c = e.target.closest('[data-cat]'); if (!c) return;
      bucketCat = c.dataset.cat;
      renderBucket();
    });
    $('#bucket-list').addEventListener('click', (e) => {
      if (e.target.closest('#bk-add')) { openBucketItemModal(null); return; }
      const ed = e.target.closest('[data-edit]');
      if (ed) { openBucketItemModal(ed.dataset.edit); return; }
      const b = e.target.closest('[data-bk]');
      if (b) toggleBucket(b.dataset.bk, b);
    });

    // 彩蛋：暗号
    let buf = '';
    document.addEventListener('keydown', (e) => {
      if (e.key.length !== 1) return;
      if (document.activeElement && /INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
      buf = (buf + e.key).slice(-24);
      const sec = (state.config.secret || '').trim();
      if (sec && buf.endsWith(sec)) {
        buf = '';
        showSecret();
      }
    });

    // 品牌长按彩蛋
    let brandClicks = 0, brandTimer = null;
    $('#brand').addEventListener('click', () => {
      brandClicks++;
      clearTimeout(brandTimer);
      brandTimer = setTimeout(() => { brandClicks = 0; }, 1800);
      if (brandClicks >= 7) {
        brandClicks = 0;
        burst(window.innerWidth / 2, 120, '✨', 22);
        toast('10·19  23:45 —— 时间从此有了名字');
      }
    });
  }

  function showSecret() {
    const msg = state.config.secretMsg || '我一直在。';
    openModal(`
      <div style="text-align:center;padding:10px 0 6px">
        <div style="font-size:34px">💌</div>
        <p style="margin-top:14px;font-family:Georgia,'Songti SC',serif;font-size:17px;line-height:2">${esc(msg)}</p>
        <p style="font-size:11.5px;color:var(--faint);margin-top:16px;letter-spacing:.2em">只有知道暗号的人才会看到这里</p>
      </div>
      <div class="modal-actions" style="justify-content:center">
        <button class="btn btn-primary" data-close="1" type="button">收下</button>
      </div>
    `);
    burst(window.innerWidth / 2, window.innerHeight / 2, '💗', 18);
  }

  /* ==================== 星空背景 ==================== */
  function initSky() {
    const cv = $('#sky');
    const ctx = cv.getContext('2d');
    let W = 0, H = 0, stars = [], shooting = null, raf = null;

    function resize() {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      W = cv.clientWidth; H = cv.clientHeight;
      cv.width = W * dpr; cv.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.round(Math.min(160, (W * H) / 14000));
      stars = Array.from({ length: count }, () => ({
        x: Math.random() * W,
        y: Math.random() * H,
        r: Math.random() * 1.3 + 0.25,
        a: Math.random() * 0.6 + 0.15,
        tw: Math.random() * Math.PI * 2,
        sp: Math.random() * 0.014 + 0.004
      }));
    }

    function loop() {
      // 只有墨夜那套纸需要星星，白天就别空转了
      if (document.documentElement.dataset.theme !== 'night') {
        raf = requestAnimationFrame(loop);
        return;
      }
      ctx.clearRect(0, 0, W, H);
      for (const s of stars) {
        s.tw += s.sp;
        const a = s.a * (0.55 + 0.45 * Math.sin(s.tw));
        ctx.globalAlpha = a;
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
        s.y -= 0.045;
        if (s.y < -2) { s.y = H + 2; s.x = Math.random() * W; }
      }
      ctx.globalAlpha = 1;

      if (!shooting && Math.random() < 0.0035) {
        shooting = { x: Math.random() * W * 0.7, y: Math.random() * H * 0.4, vx: 3.4, vy: 1.7, life: 1 };
      }
      if (shooting) {
        const st = shooting;
        st.x += st.vx * 4; st.y += st.vy * 4; st.life -= 0.014;
        const g = ctx.createLinearGradient(st.x, st.y, st.x - 90, st.y - 45);
        g.addColorStop(0, `rgba(255,255,255,${Math.max(0, st.life)})`);
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.strokeStyle = g; ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.moveTo(st.x, st.y); ctx.lineTo(st.x - 90, st.y - 45); ctx.stroke();
        if (st.life <= 0 || st.x > W + 100) shooting = null;
      }
      raf = requestAnimationFrame(loop);
    }

    resize();
    window.addEventListener('resize', resize);
    const reduce = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)').matches : false;
    if (!reduce) loop();
    else { for (const s of stars) { ctx.globalAlpha = s.a; ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill(); } }
  }

  /* ==================== 启动 ==================== */
  function init() {
    applyTheme();
    bind();
    // 星空只是背景：画不出来也不能把整册拖垮
    try { initSky(); } catch (e) { console.warn('星空没点亮：', e); }
    renderAll();
    route();

    // 自动同步：打开 App 对齐一次，从后台切回来再对齐一次
    try {
      if (autoSyncReady()) setTimeout(function () { autoSync('open'); }, 2500);
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'visible') autoSync('focus');
      });
    } catch (e) { console.warn('自动同步没挂上：', e); }

    // 一点跟着指针走的暖光（桌面端）
    if (window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
      let raf = null;
      window.addEventListener('pointermove', (e) => {
        if (raf) return;
        raf = requestAnimationFrame(() => {
          const root = document.documentElement;
          root.style.setProperty('--mx', e.clientX + 'px');
          root.style.setProperty('--my', e.clientY + 'px');
          raf = null;
        });
      }, { passive: true });
    }

    window.addEventListener('hashchange', () => {
      const h = location.hash.slice(1);
      if (h === 'poster' || h === 'sync') { route(); return; }
      if (h !== currentPage) go(PAGES.indexOf(h) >= 0 ? h : 'home');
    });

    // 用网址打开时注册离线缓存：加到主屏幕以后断网也能翻这一册
    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').catch(() => {});
      });
    }

    // 秒针
    setInterval(() => {
      if (currentPage === 'home') {
        const ms = elapsedMs();
        const rem = Math.abs(ms) % DAY;
        $('#h-h').textContent = pad(Math.floor(rem / 3600000));
        $('#h-m').textContent = pad(Math.floor((rem % 3600000) / 60000));
        $('#h-s').textContent = pad(Math.floor((rem % 60000) / 1000));
        // 跨天时整页刷新数字
        if (Math.floor(Math.abs(ms) / DAY) !== lastShownDay) renderHome();
      }
    }, 1000);

    // 每分钟刷新倒数；主题选「随时刻」时顺手换纸
    setInterval(() => {
      if (currentPage === 'days') renderDays();
      if (currentPage === 'capsule') renderCapsules();
      if (normalizeTheme(state.config.theme) === 'auto') applyTheme();
    }, 60000);

    console.log('%c拾玖 · 时光', 'color:#b7402b;font-size:14px', '已加载 · 一册纸上的纪念册 · 数据保存在本地');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
