/* 시간정하기 — 한국어·영어 일정 맞추기. 가입·비밀번호 없음.
   칸은 UTC 분(epoch/60000)으로 저장하고, 보는 사람 시간대로 바꿔 그린다(서머타임은 날짜마다 따로). */
'use strict';
(function () {
  // ---------- 언어 (서버가 <html lang> 을 방문자 나라로 정하고, 저장된 선택(meet:lang)이 우선) ----------
  const LANG = (() => { let v = null; try { v = localStorage.getItem('meet:lang'); } catch (e) { /* 개인 창 */ } if (v === 'ko' || v === 'en') return v; return document.documentElement.lang === 'en' ? 'en' : 'ko'; })();
  document.documentElement.lang = LANG;
  window.MEET_LANG = LANG;
  const L = (ko, en) => LANG === 'en' ? en : ko;
  const cnt = (n, one, many) => n + ' ' + (n === 1 ? one : many);   // 영어 단수·복수
  const BRAND = L('시간정하기', 'Find a time');
  // ---------- 작은 도구 ----------
  const $ = (s, r) => (r || document).querySelector(s);
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat(Infinity)) if (c != null && c !== false) el.append(c.nodeType ? c : String(c));
    return el;
  }
  const WD = L(['일', '월', '화', '수', '목', '금', '토'], ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
  const WDF = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MONF = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const pad = n => String(n).padStart(2, '0');
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  let toastT = 0;
  function toast(msg, bad) {
    const t = $('#toast');
    t.textContent = msg; t.className = 'toast show' + (bad ? ' bad' : '');
    clearTimeout(toastT); toastT = setTimeout(() => { t.className = 'toast'; }, 2800);
  }
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) { /* 개인 창 */ } },
  };
  async function api(method, url, body, ms) {
    let sig; try { if (ms && AbortSignal.timeout) sig = AbortSignal.timeout(ms); } catch (e) { /* 옛 브라우저 */ }
    const r = await fetch(url, { method, signal: sig, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    let d = null; try { d = await r.json(); } catch (e) { /* 빈 응답 */ }
    if (!r.ok) throw new Error((LANG === 'en' && d && d.error_en) || (d && d.error) || (L('오류 ', 'Error ') + r.status));
    return d;
  }
  const TAB = Math.random().toString(36).slice(2, 10).padEnd(8, '0');   // 이 창의 id(같은 창에서 보낸 저장의 순서 비교용)
  let SEQ = 0;                       // 이 창에서 보낸 저장 순번(모임을 다시 열어도 이어짐)
  const lastOk = {}, lastSent = {}, sentSeq = {};  // '모임|이름' → 저장 성공 순번 / 아직 확인 안 된 마지막 보낸 값 / 마지막 보낸 순번

  // ---------- 시간대 ----------
  const fmtCache = {};
  function fmtFor(tz) {
    return fmtCache[tz] || (fmtCache[tz] = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short' }));
  }
  const WDE = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  function partsAt(tz, ms) {   // 그 시간대의 날짜·분·요일
    const p = {};
    for (const x of fmtFor(tz).formatToParts(new Date(ms))) p[x.type] = x.value;
    const hh = (+p.hour) % 24;
    return { date: p.year + '-' + p.month + '-' + p.day, y: +p.year, mo: +p.month, d: +p.day, min: hh * 60 + (+p.minute), wd: WDE[p.weekday] };
  }
  function offsetMin(tz, ms) {
    const p = partsAt(tz, ms);
    return Math.round((Date.UTC(p.y, p.mo - 1, p.d, 0, p.min) - Math.floor(ms / 60000) * 60000) / 60000);
  }
  function localToUtc(tz, dateStr, min) {   // 그 시간대의 날짜+분 → UTC ms
    const [y, mo, d] = dateStr.split('-').map(Number);
    const guess = Date.UTC(y, mo - 1, d, 0, min);
    const offs = [...new Set([-86400000, -43200000, 0, 43200000, 86400000].map(k => offsetMin(tz, guess + k)))];
    const cand = offs.map(o => guess - o * 60000);
    const hit = t => { const p = partsAt(tz, t); return p.date === dateStr && p.min === min; };
    const c = cand.filter(hit).sort((a, b) => a - b);
    if (c.length) return c[0];            // 두 번 오는 시각(서머타임 끝)은 앞의 것
    return Math.max(...cand);             // 없는 시각(서머타임 시작)은 뒤로 밀린 시각(2:00 → 3:00)
  }
  function validTz(tz) { try { fmtFor(tz); return true; } catch (e) { return false; } }
  const TZK = {
    'Asia/Seoul': '한국 (서울)', 'Asia/Tokyo': '일본 (도쿄)', 'Asia/Shanghai': '중국 (베이징·상하이)', 'Asia/Hong_Kong': '홍콩', 'Asia/Taipei': '대만 (타이베이)',
    'Asia/Singapore': '싱가포르', 'Asia/Ho_Chi_Minh': '베트남 (호찌민)', 'Asia/Saigon': '베트남 (호찌민)', 'Asia/Bangkok': '태국 (방콕)', 'Asia/Jakarta': '인도네시아 (자카르타)',
    'Asia/Manila': '필리핀 (마닐라)', 'Asia/Kolkata': '인도', 'Asia/Calcutta': '인도', 'Asia/Dubai': 'UAE (두바이)', 'Europe/London': '영국 (런던)', 'Europe/Paris': '프랑스 (파리)',
    'Europe/Berlin': '독일 (베를린)', 'Europe/Amsterdam': '네덜란드', 'Europe/Madrid': '스페인', 'Europe/Rome': '이탈리아', 'Europe/Zurich': '스위스',
    'America/New_York': '미국 동부 (뉴욕·보스턴)', 'America/Chicago': '미국 중부 (시카고·휴스턴)', 'America/Denver': '미국 산악 (덴버)', 'America/Phoenix': '미국 (애리조나)',
    'America/Los_Angeles': '미국 서부 (LA·샌프란시스코·시애틀)', 'America/Anchorage': '미국 (알래스카)', 'Pacific/Honolulu': '미국 (하와이)', 'America/Toronto': '캐나다 동부 (토론토)',
    'America/Vancouver': '캐나다 서부 (밴쿠버)', 'America/Sao_Paulo': '브라질 (상파울루)', 'America/Mexico_City': '멕시코', 'Australia/Sydney': '호주 동부 (시드니)',
    'Australia/Perth': '호주 서부 (퍼스)', 'Pacific/Auckland': '뉴질랜드', 'UTC': '세계 표준시 (UTC)',
  };
  const TZE = {
    'Asia/Seoul': 'Korea (Seoul)', 'Asia/Tokyo': 'Japan (Tokyo)', 'Asia/Shanghai': 'China (Beijing, Shanghai)', 'Asia/Hong_Kong': 'Hong Kong', 'Asia/Taipei': 'Taiwan (Taipei)',
    'Asia/Singapore': 'Singapore', 'Asia/Ho_Chi_Minh': 'Vietnam (Ho Chi Minh City)', 'Asia/Saigon': 'Vietnam (Ho Chi Minh City)', 'Asia/Bangkok': 'Thailand (Bangkok)', 'Asia/Jakarta': 'Indonesia (Jakarta)',
    'Asia/Manila': 'Philippines (Manila)', 'Asia/Kolkata': 'India', 'Asia/Calcutta': 'India', 'Asia/Dubai': 'UAE (Dubai)', 'Europe/London': 'UK (London)', 'Europe/Paris': 'France (Paris)',
    'Europe/Berlin': 'Germany (Berlin)', 'Europe/Amsterdam': 'Netherlands', 'Europe/Madrid': 'Spain', 'Europe/Rome': 'Italy', 'Europe/Zurich': 'Switzerland',
    'America/New_York': 'US Eastern (New York, Boston)', 'America/Chicago': 'US Central (Chicago, Houston)', 'America/Denver': 'US Mountain (Denver)', 'America/Phoenix': 'US (Arizona)',
    'America/Los_Angeles': 'US Pacific (LA, San Francisco, Seattle)', 'America/Anchorage': 'US (Alaska)', 'Pacific/Honolulu': 'US (Hawaii)', 'America/Toronto': 'Canada Eastern (Toronto)',
    'America/Vancouver': 'Canada Pacific (Vancouver)', 'America/Sao_Paulo': 'Brazil (São Paulo)', 'America/Mexico_City': 'Mexico', 'Australia/Sydney': 'Australia Eastern (Sydney)',
    'Australia/Perth': 'Australia Western (Perth)', 'Pacific/Auckland': 'New Zealand', 'UTC': 'Coordinated Universal Time (UTC)',
  };
  const TZ_TOP = ['Asia/Seoul', 'America/New_York', 'America/Chicago', 'America/Los_Angeles', 'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Asia/Tokyo', 'Asia/Shanghai',
    'Asia/Singapore', 'Asia/Ho_Chi_Minh', 'Asia/Kolkata', 'Australia/Sydney', 'America/Toronto', 'America/Vancouver', 'Pacific/Honolulu', 'Pacific/Auckland', 'UTC'];
  function gmt(tz) {
    const o = offsetMin(tz, Date.now()), s = o < 0 ? '−' : '+', a = Math.abs(o);
    return 'GMT' + s + Math.floor(a / 60) + (a % 60 ? ':' + pad(a % 60) : '');
  }
  function tzName(tz) { return (L(TZK, TZE))[tz] || tz.replace(/_/g, ' '); }
  const myTz = (() => { try { const z = Intl.DateTimeFormat().resolvedOptions().timeZone; return z && validTz(z) ? z : 'Asia/Seoul'; } catch (e) { return 'Asia/Seoul'; } })();
  function tzSelect(id, cur, onchange) {
    const sel = h('select', { id, class: 'tzsel', onchange: () => onchange(sel.value) });
    const seen = new Set();
    const add = (parent, z) => { if (seen.has(z) || !validTz(z)) return; seen.add(z); parent.append(h('option', { value: z }, tzName(z) + ' · ' + gmt(z))); };
    const g1 = h('optgroup', { label: L('자주 쓰는 곳', 'Common places') });
    [myTz, cur].concat(TZ_TOP).forEach(z => add(g1, z));
    sel.append(g1);
    let all = []; try { all = Intl.supportedValuesOf('timeZone'); } catch (e) { /* 옛 브라우저 */ }
    if (all.length) { const g2 = h('optgroup', { label: L('다른 지역 (영문)', 'All time zones') }); all.forEach(z => add(g2, z)); sel.append(g2); }
    sel.value = cur;
    return sel;
  }

  // ---------- 글자 ----------
  function fmtMin(m) {
    if (m >= 1440) return L('자정', 'Midnight');
    const hh = Math.floor(m / 60), mm = m % 60;
    if (LANG === 'en') return ((hh % 12) || 12) + ':' + pad(mm) + (hh < 12 ? ' AM' : ' PM');
    return (hh < 12 ? '오전 ' : '오후 ') + ((hh % 12) || 12) + ':' + pad(mm);
  }
  function fmtHour(m) { const hh = Math.floor(m / 60) % 24, mm = m % 60; if (LANG === 'en') return ((hh % 12) || 12) + (mm ? ':' + pad(mm) : '') + (hh < 12 ? ' AM' : ' PM'); return (hh < 12 ? '오전 ' : '오후 ') + ((hh % 12) || 12) + '시' + (mm ? ' ' + mm + '분' : ''); }
  function dateLabel(ev, p) {
    if (LANG === 'en') return ev.mode === 'days' ? WDF[p.wd] : WD[p.wd] + ', ' + MON[p.mo - 1] + ' ' + p.d;
    return ev.mode === 'days' ? WD[p.wd] + '요일' : p.mo + '월 ' + p.d + '일 (' + WD[p.wd] + ')';
  }
  function slotText(ev, tz, i) {   // "11월 12일 (수) 오후 2:00 ~ 오후 2:30"
    const ms = ev.slots[i] * 60000, a = partsAt(tz, ms), b = partsAt(tz, ms + ev.step * 60000);
    const second = ms2 => { const p = partsAt(tz, ms2); return [1800000, 3600000].some(d => { const q = partsAt(tz, ms2 - d); return q.date === p.date && q.min === p.min; }) ? L(' (두 번째)', ' (2nd)') : ''; };
    const endMin = b.date === a.date ? b.min : (b.min === 0 ? 1440 : b.min);
    return dateLabel(ev, a) + ' ' + fmtMin(a.min) + second(ms) + L(' ~ ', ' – ') + fmtMin(endMin) + (b.date === a.date && endMin <= a.min ? L(' (두 번째)', ' (2nd)') : '');
  }

  // ---------- 주소 ----------
  let lastPath = '', navTok = 0;
  function route() {
    navTok++;
    if (S) { S.painting = false; flushSave(S); }   // 칠하는 중·직후에 다른 화면으로 가도 저장되게
    lastPath = location.pathname;
    window.scrollTo(0, 0);
    if (location.pathname === '/guide' || location.pathname === '/guide/') return showGuide();
    const m = location.pathname.match(/^\/m\/([a-z2-9]{8})\/?$/);
    if (m) showEvent(m[1]); else showCreate();
  }
  window.addEventListener('popstate', () => { if (location.pathname !== lastPath) route(); });
  document.addEventListener('click', e => {   // 사이트 안 링크는 새로 고침 없이
    const a = e.target.closest && e.target.closest('a[href^="/"]');
    if (!a || a.target || e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    if (a.getAttribute('href') !== location.pathname) history.pushState(null, '', a.getAttribute('href'));
    route();
  });
  function steps(items) { return h('ol', { class: 'howto' }, items.map(x => h('li', null, x))); }

  // =====================================================================
  // 모임 만들기 (짜임: 이름 / 왼쪽 날짜 / 오른쪽 시간)
  // =====================================================================
  function showCreate() {
    stopPoll();
    document.title = BRAND;
    let today = partsAt(myTz, Date.now());
    const st = { mode: 'dates', dates: new Set(), days: new Set([1, 2, 3, 4, 5]), start: 9 * 60, end: 18 * 60, step: 30, tz: myTz, ym: [today.y, today.mo] };
    const app = $('#app'); app.textContent = '';

    const title = h('input', { id: 'f-title', class: 'title-in', maxlength: 80, placeholder: L('예: 11월 연구실 회의', 'e.g. November team meeting'), autocomplete: 'off' });
    const cal = h('div', { class: 'cal' });
    const daysBox = h('div', { class: 'days hide' });
    const summary = h('p', { class: 'summary', 'aria-live': 'polite' });
    const dateHelp = h('p', { class: 'note' });
    const segBtn = (mode, label) => h('button', { type: 'button', role: 'radio', 'data-mode': mode, onclick: () => setMode(mode) }, label);
    const seg = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': L('날짜 고르는 방법', 'How to pick dates') }, segBtn('dates', L('날짜', 'Dates')), segBtn('days', L('매주 요일', 'Days of the week')));
    function setMode(mode) {   // 날짜 / 매주 요일 — 고른 값은 둘 다 남겨 두고, 만들 때는 지금 보이는 쪽만 씀
      st.mode = mode;
      seg.querySelectorAll('button').forEach(b => { const on = b.dataset.mode === mode; b.classList.toggle('on', on); b.setAttribute('aria-checked', on ? 'true' : 'false'); b.tabIndex = on ? 0 : -1; });
      cal.classList.toggle('hide', mode !== 'dates'); daysBox.classList.toggle('hide', mode !== 'days');
      dateHelp.textContent = mode === 'dates' ? L('날짜를 누르거나 쭉 끌어서 골라 주세요. 한 번 더 누르면 빠져요.', 'Tap or drag to pick dates. Tap again to remove one.') : L('매주 모이는 요일을 골라 주세요. 한 번 더 누르면 빠져요.', 'Pick the days of the week you meet. Tap again to remove one.');
      upd();
    }
    seg.addEventListener('keydown', e => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) { e.preventDefault(); setMode(st.mode === 'dates' ? 'days' : 'dates'); seg.querySelector('.on').focus(); } });

    // 달력: 누르거나 끌어서 고르기. 끌면 처음 누른 날부터 지금 날까지 한 번에.
    let drag = null;
    function drawCal() {
      cal.textContent = '';
      today = partsAt(st.tz, Date.now());
      const [y, mo] = st.ym;
      const first = new Date(Date.UTC(y, mo - 1, 1)), n = new Date(Date.UTC(y, mo, 0)).getUTCDate();
      cal.append(h('div', { class: 'calhead' },
        h('b', { 'aria-live': 'polite' }, L(y + '년 ' + mo + '월', MONF[mo - 1] + ' ' + y)),
        h('span', { class: 'navs' },
          h('button', { type: 'button', class: 'nav', 'aria-label': L('이전 달', 'Previous month'), onclick: () => { st.ym = mo === 1 ? [y - 1, 12] : [y, mo - 1]; drawCal(); } }, '‹'),
          h('button', { type: 'button', class: 'nav', 'aria-label': L('다음 달', 'Next month'), onclick: () => { st.ym = mo === 12 ? [y + 1, 1] : [y, mo + 1]; drawCal(); } }, '›'))));
      const g = h('div', { class: 'calgrid' });
      WD.forEach((w, i) => g.append(h('div', { class: 'wd' + (i === 0 ? ' sun' : i === 6 ? ' sat' : '') }, w)));
      for (let i = 0; i < first.getUTCDay(); i++) g.append(h('div', { class: 'blank' }));
      for (let d = 1; d <= n; d++) {
        const ds = y + '-' + pad(mo) + '-' + pad(d), wd = (first.getUTCDay() + d - 1) % 7, past = ds < today.date;
        g.append(h('div', { class: 'day' + (st.dates.has(ds) ? ' on' : '') + (past ? ' past' : '') + (ds === today.date ? ' today' : '') + (wd === 0 ? ' sun' : wd === 6 ? ' sat' : ''),
          'data-d': past ? null : ds, role: 'button', 'aria-pressed': st.dates.has(ds) ? 'true' : 'false', 'aria-label': L(mo + '월 ' + d + '일 ' + WD[wd] + '요일', WDF[wd] + ', ' + MONF[mo - 1] + ' ' + d) + (ds === today.date ? L(', 오늘', ', today') : '') + (past ? L(', 지난 날짜', ', past date') : ''), 'aria-disabled': past ? 'true' : null }, h('span', null, String(d))));
      }
      g.addEventListener('pointerdown', e => {
        const c = e.target.closest('[data-d]'); if (!c) return;
        e.preventDefault(); try { g.setPointerCapture(e.pointerId); } catch (x) { /* 무시 */ }
        drag = { on: !st.dates.has(c.dataset.d), from: c.dataset.d, snap: new Set(st.dates) }; apply(c.dataset.d);
      });
      g.addEventListener('pointermove', e => {
        if (!drag) return;
        const c = document.elementFromPoint(e.clientX, e.clientY), d = c && c.closest && c.closest('[data-d]');
        if (d && g.contains(d)) apply(d.dataset.d);
      });
      const end = () => { drag = null; };
      g.addEventListener('pointerup', end); g.addEventListener('pointercancel', end);
      function apply(to) {
        const a = drag.from < to ? drag.from : to, b = drag.from < to ? to : drag.from;
        g.querySelectorAll('[data-d]').forEach(el => {
          const ds = el.dataset.d, on = (ds >= a && ds <= b) ? drag.on : drag.snap.has(ds);
          if (on) st.dates.add(ds); else st.dates.delete(ds);
          el.classList.toggle('on', on); el.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
        upd();
      }
      cal.append(g);
    }
    drawCal();

    [1, 2, 3, 4, 5, 6, 0].forEach(i => {
      const b = h('button', { type: 'button', class: 'dbtn' + (st.days.has(i) ? ' on' : '') + (i === 0 ? ' sun' : i === 6 ? ' sat' : ''), 'aria-pressed': st.days.has(i) ? 'true' : 'false', onclick: () => {
        st.days.has(i) ? st.days.delete(i) : st.days.add(i);
        b.classList.toggle('on', st.days.has(i)); b.setAttribute('aria-pressed', st.days.has(i) ? 'true' : 'false'); upd();
      } }, WD[i]);
      daysBox.append(b);
    });

    const hourOpts = (sel, last) => { for (let m = 0; m <= 1440; m += 60) if (last ? m > 0 : m < 1440) sel.append(h('option', { value: m }, fmtMin(m))); };
    const sSel = h('select', { id: 'f-start', onchange: () => { st.start = +sSel.value; upd(); } }); hourOpts(sSel, false); sSel.value = st.start;
    const eSel = h('select', { id: 'f-end', onchange: () => { st.end = +eSel.value; upd(); } }); hourOpts(eSel, true); eSel.value = st.end;
    const stepSel = h('select', { id: 'f-step', onchange: () => { st.step = +stepSel.value; upd(); } },
      h('option', { value: 15 }, L('15분', '15 min')), h('option', { value: 30 }, L('30분', '30 min')), h('option', { value: 60 }, L('1시간', '1 hour')));
    stepSel.value = st.step;
    const tzWrap = h('span');
    const tzNote = h('p', { class: 'note' });
    function drawTz() {
      tzWrap.textContent = '';
      tzWrap.append(tzSelect('f-tz', st.tz, z => {
        st.tz = z; today = partsAt(z, Date.now());
        for (const d of [...st.dates]) if (d < today.date) st.dates.delete(d);   // 그 시간대로는 이미 지난 날 빼기
        drawTz(); drawCal(); upd();
      }));
      tzNote.textContent = L(tzName(st.tz) + ' 시간 기준이에요. 해외에 있는 사람에게는 그 나라 시간으로 바뀌어 보여서, 시차를 따로 계산하지 않아도 돼요.', 'Times are in ' + tzName(st.tz) + ' time. People abroad see them in their own time zone, so nobody has to work out the time difference.');
    }
    drawTz();

    const go = h('button', { type: 'button', class: 'primary', onclick: create }, L('모임 만들기', 'Create event'));
    function upd() {
      const nd = st.mode === 'dates' ? st.dates.size : st.days.size;
      const per = st.end > st.start ? Math.ceil((st.end - st.start) / st.step) : 0;
      let msg, ok = false;
      if (st.end <= st.start) msg = L('끝나는 시간이 시작 시간보다 늦어야 해요.', 'The end time has to be after the start time.');
      else if (!nd) msg = st.mode === 'dates' ? L('날짜를 하나 이상 골라 주세요.', 'Pick at least one date.') : L('요일을 하나 이상 골라 주세요.', 'Pick at least one day.');
      else if (st.mode === 'dates' && nd > 62) msg = L('날짜는 62일까지 고를 수 있어요.', 'You can pick up to 62 dates.');
      else if (nd * per > 3000) msg = L('칸이 ' + nd * per + '개로 너무 많아요. 날짜를 줄이거나 칸 간격을 늘려 주세요.', 'That makes ' + nd * per + ' slots, which is too many. Pick fewer dates or use a longer slot length.');
      else { ok = true; msg = L((st.mode === 'dates' ? '날짜 ' + nd + '일' : '매주 ' + [1, 2, 3, 4, 5, 6, 0].filter(i => st.days.has(i)).map(i => WD[i]).join('·')) + ' · ' + fmtMin(st.start) + '~' + fmtMin(st.end) + ' · ' + (st.step === 60 ? '1시간' : st.step + '분') + ' 단위',
        (st.mode === 'dates' ? cnt(nd, 'date', 'dates') : 'Every ' + [1, 2, 3, 4, 5, 6, 0].filter(i => st.days.has(i)).map(i => WD[i]).join(', ')) + ' · ' + fmtMin(st.start) + ' – ' + fmtMin(st.end) + ' · ' + (st.step === 60 ? '1-hour' : st.step + '-min') + ' slots'); }
      summary.textContent = msg; go.disabled = !ok;
    }
    upd();

    async function create() {
      const t = title.value.trim();
      if (!t) { title.focus(); toast(L('모임 이름을 적어 주세요', 'Add an event name'), true); return; }
      let labels, refDates;
      if (st.mode === 'dates') { labels = [...st.dates].sort(); refDates = labels; }
      else {   // 요일: 이번 주(만든 사람 시간대의 일~토)를 기준 주로 → 지금 계절의 서머타임이 반영됨
        labels = [...st.days].sort();
        const t0 = partsAt(st.tz, Date.now()), sun = Date.UTC(t0.y, t0.mo - 1, t0.d - t0.wd);
        refDates = labels.map(i => { const d = new Date(sun + i * 86400000); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); });
      }
      const set = new Set();
      for (const ds of refDates) for (let m = st.start; m < st.end; m += st.step) set.add(Math.round(localToUtc(st.tz, ds, m) / 60000));
      const slots = [...set].sort((a, b) => a - b);
      go.disabled = true; go.textContent = L('만들고 있어요…', 'Creating…');
      const tok = navTok;
      try {
        const r = await api('POST', '/api/events', { title: t, mode: st.mode, tz: st.tz, step: st.step, slots, labels, range: [st.start, st.end] });
        store.set('meet:new:' + r.id, '1');
        if (tok !== navTok) { toast(L('모임을 만들었어요: ', 'Event created: ') + location.origin + '/m/' + r.id); return; }
        history.pushState(null, '', '/m/' + r.id);
        route();
      } catch (e) { toast(e.message, true); go.disabled = false; go.textContent = L('모임 만들기', 'Create event'); }
    }

    app.append(h('div', { class: 'page create' },
      h('div', { class: 'titlebox' }, h('label', { for: 'f-title' }, L('모임 이름', 'Event name')), title),
      h('details', { class: 'intro', open: store.get('meet:seen') ? null : true, ontoggle: () => store.set('meet:seen', '1') },
        h('summary', null, L('처음이라면 이렇게 해 보세요', 'How it works')),
        steps([
          [L('모임 이름을 적어요.', 'Name your event.')],
          [L('후보 날짜를 골라요. 매주 모이는 모임이면 ‘매주 요일’로 바꿔요.', 'Pick the dates you’re considering. For a weekly meeting, switch to “Days of the week”.')],
          [L('물어볼 시간 범위를 정하고 ‘모임 만들기’를 눌러요.', 'Choose the time range to ask about, then select “Create event”.')],
          [L('생긴 링크를 단톡방이나 문자로 보내면 끝이에요.', 'Send the link to your group chat or by text. That’s it.')],
          [L('받은 사람은 이름만 적고 되는 시간을 칠하면 돼요. 가입도 비밀번호도 없어요. ', 'Everyone adds a name and paints the times that work. No sign-up, no password. '), h('a', { href: '/guide' }, L('자세한 사용법', 'Full guide'))],
        ])),
      h('div', { class: 'two' },
        h('section', { class: 'col' },
          h('h2', null, L('언제 모일까요?', 'When could you meet?')),
          dateHelp,
          seg, cal, daysBox),
        h('section', { class: 'col' },
          h('h2', null, L('몇 시쯤이 좋을까요?', 'What times work?')),
          h('p', { class: 'note' }, L('사람들에게 물어볼 시간 범위예요.', 'The time range you’ll ask people about.')),
          h('div', { class: 'form' },
            h('label', { for: 'f-start' }, L('시작', 'Start')), sSel,
            h('label', { for: 'f-end' }, L('끝', 'End')), eSel,
            h('label', { for: 'f-step' }, L('칸 간격', 'Slot length')), stepSel,
            h('label', { for: 'f-tz' }, L('시간대', 'Time zone')), tzWrap),
          tzNote,
          h('div', { class: 'ready' }, summary, go)))));
    setMode('dates');
    title.focus();
  }

  // =====================================================================
  // 모임 화면 (짜임: 왼쪽 내 시간 / 오른쪽 모두의 시간)
  // =====================================================================
  let S = null, pollT = 0;
  function stopPoll() { clearInterval(pollT); pollT = 0; S = null; }

  async function showEvent(id) {
    stopPoll();
    const app = $('#app'), tok = navTok;
    let ev;
    try { ev = await api('GET', '/api/events/' + id); if (tok !== navTok) return; }
    catch (e) {
      if (tok !== navTok) return;
      app.textContent = '';
      app.append(h('div', { class: 'page' }, h('h2', null, e.message), h('p', null, h('a', { href: '/' }, L('새 모임 만들기', 'Create a new event')))));
      return;
    }
    if (!validTz(ev.tz)) ev.tz = 'UTC';
    const savedTz = store.get('meet:tz:' + id);
    S = { id, ev, name: store.get('meet:name:' + id) || '', mine: null, tz: savedTz && validTz(savedTz) ? savedTz : myTz,
      page: 0, focus: -1, dirty: false, inflight: 0, failed: false, chain: Promise.resolve(), saveT: 0, painting: false, lastSaved: 0,
      isNew: store.get('meet:new:' + id) === '1' };
    if (S.name) loadMine();
    document.title = ev.title + ' · ' + BRAND;
    renderEvent();
    pollT = setInterval(poll, 10000);
  }
  function loadMine() {   // 이 창에서 방금 보낸 값이 있으면 그것(서버 응답보다 새 것), 없으면 서버 값
    const k = S.id + '|' + S.name, a = lastSent[k] || (own(S.ev.people, S.name) ? S.ev.people[S.name].a : null);
    S.mine = a && a.length === S.ev.slots.length ? a.split('').map(Number) : new Array(S.ev.slots.length).fill(0);
  }
  document.addEventListener('visibilitychange', () => { if (S && !document.hidden) poll(); });
  window.addEventListener('resize', () => { if (S) { clearTimeout(S.rz); S.rz = setTimeout(() => { if (S) drawGrids(); }, 150); } });

  async function poll() {
    if (!S || document.hidden || S.painting) return;
    const st = S;
    try {
      const ev = await api('GET', '/api/events/' + st.id);
      if (S !== st || st.painting) return;
      if (!validTz(ev.tz)) ev.tz = 'UTC';
      if (JSON.stringify(ev.people) !== JSON.stringify(st.ev.people)) { st.ev = ev; drawGroup(); drawSignin(); }
    } catch (e) { /* 잠깐 끊김 */ }
  }

  function people() {   // [{name, a}], 내 것은 지금 칠하는 값으로
    const out = Object.keys(S.ev.people).map(n => ({ name: n, a: n === S.name && S.mine ? S.mine : S.ev.people[n].a.split('').map(Number), t: S.ev.people[n].t }));
    if (S.name && S.mine && !own(S.ev.people, S.name)) out.push({ name: S.name, a: S.mine, t: Date.now() / 1000 });
    return out.sort((x, y) => x.t - y.t);
  }

  function layout(tz) {   // 보는 시간대로: 열 = 그곳 날짜, 줄 = 그곳 시각
    const ev = S.ev, cols = [], colIdx = new Map(), rowsSet = new Set(), at = [], seen = new Set(), rmin = new Map();
    ev.slots.forEach(s => {
      const p = Object.assign({}, partsAt(tz, s * 60000));
      if (!colIdx.has(p.date)) { colIdx.set(p.date, cols.length); cols.push({ date: p.date, p }); }
      p.fold = seen.has(p.date + '|' + p.min);   // 서머타임이 끝나 같은 시각이 한 번 더 오는 칸
      seen.add(p.date + '|' + p.min); at.push(p);
    });
    at.forEach((p, i) => {   // 두 번째 시각 줄은 그 뒤에 오는 첫 보통 칸 바로 앞에
      if (p.fold) {
        let nx = 1440;
        for (let j = i + 1; j < at.length && at[j].date === p.date; j++) if (!at[j].fold) { nx = at[j].min; break; }
        p.row = nx - 0.5 + p.min / 10000;
      } else p.row = p.min;
      rmin.set(p.row, p.min); rowsSet.add(p.row);
    });
    const sorted = cols.slice().sort((a, b) => a.date < b.date ? -1 : 1);
    const ci = new Map(sorted.map((c, i) => [c.date, i]));
    const rows = [...rowsSet].sort((a, b) => a - b);
    const ri = new Map(rows.map((m, i) => [m, i]));
    const cell = sorted.map(() => new Array(rows.length).fill(-1));
    at.forEach((p, i) => { cell[ci.get(p.date)][ri.get(p.row)] = i; });
    return { cols: sorted, rows, cell, rmin };
  }

  function renderEvent() {
    const app = $('#app'); app.textContent = '';
    const ev = S.ev, url = location.origin + '/m/' + S.id;
    const linkIn = h('input', { id: 'f-link', class: 'link', readonly: true, value: url, onfocus: e => e.target.select() });
    const copy = h('button', { type: 'button', class: 'primary', onclick: async () => {
      const text = '[' + ev.title + '] ' + L('되는 시간을 칠해 주세요. 가입 없이 이름만 적으면 돼요.', 'Please mark the times that work for you. No sign-up needed, just add your name.') + '\n' + url;
      try { await navigator.clipboard.writeText(text); toast(L('복사했어요. 단톡방에 붙여 넣어 주세요', 'Copied. Paste it into your group chat')); }
      catch (e) { linkIn.select(); let ok = false; try { ok = document.execCommand('copy'); } catch (x) { /* 무시 */ } toast(ok ? L('링크를 복사했어요', 'Link copied') : L('복사가 안 돼요. 링크를 길게 눌러 직접 복사해 주세요', 'Couldn’t copy. Press and hold the link to copy it yourself'), !ok); }
    } }, L('링크 복사', 'Copy link'));

    S.tzBox = h('div', { class: 'tzbox' });
    S.signin = h('section', { class: 'col colme' });
    S.group = h('section', { class: 'col colall' });
    app.append(h('div', { class: 'page event' },
      h('h1', null, ev.title),
      S.isNew ? h('p', { class: 'notice' }, h('b', null, L('모임을 만들었어요.', 'Event created.')), L(' 아래 링크를 단톡방에 보내 주세요. 링크는 다시 찾을 수 없으니 꼭 남겨 두세요.', ' Send the link below to your group chat. There’s no way to look it up later, so keep it somewhere safe.')) : null,
      h('div', { class: 'invite' }, h('label', { for: 'f-link' }, L('이 링크를 보내 주세요', 'Send this link')), h('div', { class: 'row' }, linkIn, copy)),
      h('details', { class: 'intro', open: store.get('meet:seen-ev') ? null : true, ontoggle: () => store.set('meet:seen-ev', '1') },
        h('summary', null, L('이렇게 하면 돼요', 'How to use this')),
        steps([
          L([h('b', null, '내 시간'), '에 이름을 적고 ‘시작’을 눌러요. 비밀번호는 없어요.'], ['Add your name under ', h('b', null, 'Your times'), ' and select “Start”. There’s no password.']),
          [L('되는 시간을 누르거나 쭉 끌어서 초록색으로 칠해요. 한 번 더 누르면 지워지고, 칠하는 대로 저장돼요.', 'Tap or drag across the times that work to paint them green. Tap again to clear. Changes save as you go.')],
          L([h('b', null, '모두의 시간'), '은 색이 진할수록 되는 사람이 많은 시간이에요. 칸을 누르면 누가 되는지 보여요.'], [h('b', null, 'Everyone’s times'), ' shows overlap: the darker the color, the more people are free. Tap a slot to see who.']),
          L(['나중에 고치려면 이 링크에서 ', h('b', null, '같은 이름'), '을 적으면 돼요. 다른 기기에서도 마찬가지예요.'], ['To make changes later, open this link and enter ', h('b', null, 'the same name'), '. It works on any device.']),
          L(['해외에 있다면 ', h('b', null, '시간대'), '를 바꿔 보세요. 표가 그 나라 시간으로 바뀌어요. ', h('a', { href: '/guide' }, '자세한 사용법')], ['Abroad? Change the ', h('b', null, 'time zone'), ' and the table switches to local time. ', h('a', { href: '/guide' }, 'Full guide')]),
        ])),
      S.tzBox,
      h('div', { class: 'two grids' }, S.signin, S.group)));
    S.isNew = false; store.set('meet:new:' + S.id, null);
    drawTz(); drawSignin(); drawGrids();
  }

  function diffText(d, name) {   // name 은 영어 문장에서만 씀
    if (LANG === 'en') {
      if (!d) return 'the same time as ' + name;
      const a = Math.abs(d), hr = Math.floor(a / 60);
      return (hr ? cnt(hr, 'hour', 'hours') : '') + (hr && a % 60 ? ' ' : '') + (a % 60 ? (a % 60) + ' min' : '') + (d < 0 ? ' earlier than ' : ' later than ') + name;
    }
    if (!d) return '시차가 없어요';
    const a = Math.abs(d);
    return Math.floor(a / 60) + '시간' + (a % 60 ? ' ' + (a % 60) + '분' : '') + ' ' + (d < 0 ? '느려요' : '빨라요');
  }
  function setViewTz(z) { S.tz = z; store.set('meet:tz:' + S.id, z); S.page = 0; drawTz(); if (CAL && S.name) drawSignin(true); drawGrids(); }
  function drawTz() {
    const ev = S.ev, box = S.tzBox; box.textContent = '';
    box.append(h('div', { class: 'row' }, h('label', { for: 'f-vtz', class: 'lab' }, L('표 시간대', 'Table time zone')), tzSelect('f-vtz', S.tz, setViewTz)));
    if (S.tz === ev.tz) {
      box.append(h('p', { class: 'note' }, L('모임을 만든 곳 시간이에요.', 'This is the event’s time zone.') + (myTz !== ev.tz ? ' ' : ''),
        myTz !== ev.tz ? h('button', { type: 'button', class: 'linkbtn', onclick: () => setViewTz(myTz) }, L(tzName(myTz) + ' 시간으로 보기', 'View in ' + tzName(myTz) + ' time')) : null));
      return;
    }
    const t0 = ev.slots[0] * 60000, d0 = offsetMin(S.tz, t0) - offsetMin(ev.tz, t0);
    box.append(h('p', { class: 'note' }, L('모임을 만든 곳 ' + tzName(ev.tz) + '보다 ' + diffText(d0) + '. ', 'This view is ' + diffText(d0, tzName(ev.tz)) + ', where the event was created. '),
      h('button', { type: 'button', class: 'linkbtn', onclick: () => setViewTz(ev.tz) }, L('만든 곳 시간으로 보기', 'View in event time zone'))));
    let prev = d0;   // 칸마다 시차를 따로 계산해서, 기간 중 서머타임이 바뀌면 알린다
    ev.slots.forEach(s => {
      const t = s * 60000, d = offsetMin(S.tz, t) - offsetMin(ev.tz, t);
      if (d !== prev) {
        const p = partsAt(S.tz, t);
        box.append(h('p', { class: 'note warn' }, L('서머타임 때문에 ' + dateLabel(ev, p) + ' ' + fmtMin(p.min) + '부터는 시차가 ' + diffText(d) + '. 표에는 날짜마다 맞게 반영돼 있어요.', 'Because of daylight saving time, from ' + dateLabel(ev, p) + ' ' + fmtMin(p.min) + ' this view is ' + diffText(d, tzName(ev.tz)) + '. The table already accounts for this on each date.')));
        prev = d;
      }
    });
    if (ev.mode === 'days') box.append(h('p', { class: 'note warn' }, L('매주 모임은 만든 주를 기준으로 시차를 계산했어요. 서머타임이 바뀌는 철에는 1시간 어긋날 수 있으니, 날짜를 정한 뒤 한 번 더 확인해 주세요.', 'For weekly events, the time difference is based on the week the event was created. Around daylight saving changes it can be off by an hour, so check again once you’ve settled on a date.')));
  }

  // ---------- 내 달력과 비교 (파일은 이 브라우저 안에서만 읽음, 서버·저장소에 안 남김) ----------
  let CAL = null;   // { list, label, ver } — 창을 닫으면 사라짐
  function calFor() {   // 지금 모임·시간대에서 칸마다 겹치는 내 일정
    if (!CAL || !window.MeetICS) return null;
    const ev = S.ev, step = ev.step * 60000;
    let starts = ev.slots.map(x => x * 60000);
    const now = Date.now();
    const key = S.id + '|' + S.tz + '|' + CAL.ver + '|' + (ev.mode === 'days' ? Math.floor(now / 300000) : 0);   // 매주 모임은 5분마다 다시 계산(지난 칸은 다음 주로)
    if (S.calCache && S.calCache.key === key) return S.calCache;
    if (ev.mode === 'days') {   // 매주 요일 모임: 다가오는 같은 요일·시각(만든 곳 벽시계 기준)과 비교
      const W = 7;
      starts = starts.map(t => { const p = partsAt(ev.tz, t);
        const at = k => { const d = new Date(Date.UTC(p.y, p.mo - 1, p.d + k * W)); return localToUtc(ev.tz, d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()), p.min); };
        let wk = Math.max(0, Math.ceil((now - t - step) / 604800000) - 1); while (at(wk) + step <= now) wk++;   // 서머타임이 바뀌어도 아직 안 끝난 가장 가까운 같은 요일·시각
        const d = new Date(Date.UTC(p.y, p.mo - 1, p.d + wk * W)); return localToUtc(ev.tz, d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()), p.min); });
    }
    const t0 = Math.min(...starts), t1 = Math.max(...starts) + step;
    let r;
    try { r = MeetICS.expand(CAL.list, t0, t1, { validTz, localToUtc, tz: S.tz }); }
    catch (e) { toast(L('달력 일정을 계산하지 못했어요. 파일을 다시 확인해 주세요', 'Couldn’t work out your calendar events. Please check the file'), true); return null; }
    const ad = new Map(); r.allDay.forEach(x => { if (!ad.has(x.date)) ad.set(x.date, []); ad.get(x.date).push(x.title); });
    const busyAt = starts.map(t => { const a = []; for (const b of r.busy) { if (b.s >= t + step) break; if (b.e > t && !a.includes(b.title)) a.push(b.title); } return a.length ? a : null; });
    const dayAt = starts.map(t => ad.get(partsAt(S.tz, t).date) || null);
    const items = r.busy.filter(b => b.e > t0 && b.s < t1).map(b => ({ s: b.s, text: calWhen(b.s, b.e) + L(' ', ' · ') + b.title }));
    const days = new Set(starts.map(t => partsAt(S.tz, t).date));
    r.allDay.forEach(x => { if (days.has(x.date)) items.push({ s: localToUtc(S.tz, x.date, 0) - 1, text: dateLabel({ mode: 'dates' }, partsAt(S.tz, localToUtc(S.tz, x.date, 720))) + L(' 종일 ', ' · All day · ') + x.title }); });
    items.sort((a, b) => a.s - b.s);
    S.calCache = { key, busyAt, dayAt, n: items.length, items, weekly: ev.mode === 'days', from: starts[0], unknownTz: r.unknownTz, unsupported: r.unsupported };
    return S.calCache;
  }
  function calWhen(a, b) {   // "11월 16일 (월) 오전 10:00~오전 11:30"
    const p = partsAt(S.tz, a), q = partsAt(S.tz, b);
    return dateLabel({ mode: 'dates' }, p) + ' ' + fmtMin(p.min) + L('~', ' – ') + (q.date === p.date ? fmtMin(q.min) : dateLabel({ mode: 'dates' }, q) + ' ' + fmtMin(q.min));
  }
  function calInfo(i) {   // 칸을 누를 때 겹치는 일정 이름 보여 주기
    const c = calFor(); if (!S.calInfoEl) return;
    const a = (busyTitles(i, c) || []).concat(((c && c.dayAt[i]) || []).map(t => t + L(' (종일)', ' (all day)')));
    S.calInfoEl.textContent = a.length ? L('겹치는 내 일정: ', 'Overlapping events: ') + a.join(', ') : L('이 시간에는 내 일정이 없어요.', 'Nothing on your calendar at this time.');
  }
  async function loadCalFiles(files) {
    files = [...(files || [])]; if (!files.length) return;
    if (!window.MeetICS) { toast(L('달력 기능을 불러오지 못했어요. 새로고침해 주세요', 'Couldn’t load the calendar feature. Please refresh'), true); return; }
    try {
      const list = await MeetICS.read(files);
      CAL = { list, label: files.map(f => f.name).join(', '), ver: (CAL ? CAL.ver : 0) + 1 };
      if (!S) return;
      S.calCache = null; drawSignin(true); drawGrids();
      const c = calFor();
      toast(c ? L('겹치는 일정 ' + c.n + '개를 빗금으로 표시했어요', 'Marked ' + cnt(c.n, 'overlapping event', 'overlapping events') + ' with stripes') : L('달력을 불러왔어요', 'Calendar loaded'));
    } catch (e) { toast(e.message || L('달력 파일을 읽지 못했어요', 'Couldn’t read the calendar file'), true); }
  }
  function drawCalBox() {
    const file = h('input', { type: 'file', class: 'hide', multiple: true, accept: '.ics,.zip,text/calendar,application/zip', onchange: e => { loadCalFiles(e.target.files); e.target.value = ''; } });
    const c = CAL ? calFor() : null;
    const box = h('details', { class: 'calimp', open: CAL ? true : null },
      h('summary', null, L('내 달력과 비교하기', 'Compare with my calendar'), h('span', { class: 'opt' }, L('선택', 'Optional'))),
      h('p', null, ...L(['구글·애플·아웃룩 달력에서 내보낸 파일을 고르면, 일정이 있는 시간에 ', h('b', null, '빗금'), '이 생겨요. 참고만 하고, 칠하는 건 직접 해 주세요.'], ['Choose a file exported from Google, Apple or Outlook Calendar and your busy times get ', h('b', null, 'stripes'), '. They’re only a guide. You still paint your own times.'])),
      h('p', { class: 'safe' }, L('파일은 이 기기 안에서만 읽어요. 서버로 보내거나 저장하지 않고, 창을 닫으면 사라져요.', 'The file is read on this device only. It isn’t uploaded or saved, and it’s gone when you close the tab.')),
      h('div', { class: 'row' },
        h('button', { type: 'button', onclick: () => file.click() }, CAL ? L('다른 파일 고르기', 'Choose another file') : L('달력 파일 고르기', 'Choose calendar file')),
        CAL ? h('button', { type: 'button', class: 'linkbtn', onclick: () => { CAL = null; S.calCache = null; drawSignin(true); drawGrids(); } }, L('불러온 달력 지우기', 'Remove calendar')) : null),
      file,
      CAL ? h('p', { class: 'calok' }, CAL.label + ' · ' + L('겹치는 일정 ' + (c ? c.n : 0) + '개', cnt(c ? c.n : 0, 'overlapping event', 'overlapping events')) + (c && c.weekly ? L(' · 다가오는 한 주와 비교했어요', ' · Compared with the coming week') : '')) : null,
      c && c.items.length ? h('ul', { class: 'callist' }, c.items.slice(0, 30).map(x => h('li', null, x.text)), c.items.length > 30 ? h('li', null, L('외 ' + (c.items.length - 30) + '개', 'and ' + (c.items.length - 30) + ' more')) : null) : null,
      c && c.unknownTz ? h('p', { class: 'note warn' }, L('시간대를 알 수 없는 일정 ' + c.unknownTz + '개는 ' + tzName(S.tz) + ' 시간으로 봤어요. 시각이 맞는지 확인해 주세요.', cnt(c.unknownTz, 'event has', 'events have') + ' no known time zone, so ' + (c.unknownTz === 1 ? 'it was' : 'they were') + ' read as ' + tzName(S.tz) + ' time. Check that the times look right.')) : null,
      c && c.unsupported ? h('p', { class: 'note warn' }, L('반복 규칙이 복잡한 일정 ' + c.unsupported + '개는 시각이 다르거나 빠졌을 수 있어요. 원래 달력에서 확인해 주세요.', cnt(c.unsupported, 'event has', 'events have') + ' a complex repeat rule, so the times may be wrong or missing. Check your original calendar.')) : null,
      h('details', { class: 'calhow' }, h('summary', null, L('달력 파일은 어디서 받나요?', 'Where do I get a calendar file?')),
        h('ul', null,
          h('li', null, h('b', null, L('구글 캘린더', 'Google Calendar')), L(' 컴퓨터에서 calendar.google.com → 톱니바퀴(설정) → 가져오기/내보내기 → 내보내기. 받은 zip 파일을 풀지 말고 그대로 고르면 돼요.', ' On a computer, go to calendar.google.com → Settings (the gear) → Import & export → Export. Choose the zip file as it is, without unzipping it.')),
          h('li', null, h('b', null, L('애플 캘린더', 'Apple Calendar')), L(' Mac 캘린더 앱에서 달력을 고른 뒤 파일 → 내보내기. 생긴 .ics 파일을 고르면 돼요.', ' In the Calendar app on a Mac, select a calendar, then File → Export. Choose the .ics file it creates.')),
          h('li', null, h('b', null, L('아이폰만 있다면', 'Only have an iPhone?')), L(' 아이폰 캘린더 앱에는 내보내기가 없어요. 같은 iCloud 달력을 Mac에서 내보내거나, 구글 달력이라면 컴퓨터에서 구글 캘린더로 내보내 주세요.', ' The iPhone Calendar app can’t export. Export the same iCloud calendar from a Mac, or for a Google calendar, export it from Google Calendar on a computer.')),
          h('li', null, h('b', null, L('아웃룩', 'Outlook')), L(' 달력을 .ics 파일로 저장해서 고르면 돼요. 메일로 받은 초대장 .ics 도 돼요.', ' Save the calendar as an .ics file and choose it. An .ics invitation from an email works too.')),
          h('li', null, L('여러 파일을 한꺼번에 골라도 돼요. ‘한가함’으로 둔 일정과 취소된 일정은 빼고, 하루 종일 일정은 날짜 위에 ‘종일’로 보여 줘요.', 'You can choose several files at once. Events marked “free” and canceled events are left out, and all-day events show as “All day” above the date.')))));
    box.addEventListener('dragover', e => { e.preventDefault(); box.classList.add('drop'); });
    box.addEventListener('dragleave', () => box.classList.remove('drop'));
    box.addEventListener('drop', e => { e.preventDefault(); box.classList.remove('drop'); loadCalFiles(e.dataTransfer && e.dataTransfer.files); });
    return box;
  }

  // ---------- 글·사진으로 안 되는 시간 알려 주기 (서버 → AI. 글·사진은 저장하지 않음) ----------
  function aiAt(i) {   // AI 가 뺀 시간 중 이 칸과 겹치는 이유들
    const A = S.ai; if (!A || !A.busy.length) return null;
    const t = S.ev.slots[i] * 60000, p = partsAt(A.tz, t), m0 = p.min, m1 = m0 + S.ev.step, out = [];
    for (const b of A.busy) if (b.key === p.date && b.start < m1 && b.end > m0 && !out.includes(b.why)) out.push(b.why || L('안 되는 시간', 'Not free'));
    return out.length ? out : null;
  }
  function busyTitles(i, cal) {   // 달력 일정 + AI 가 뺀 시간
    const a = (cal && cal.busyAt[i]) || [], b = aiAt(i) || [];
    return a.length || b.length ? a.concat(b) : null;
  }
  function shrinkImage(file) {   // 긴 변 1600px JPEG 로 줄여서(데이터 줄이고 사진 정보도 지움)
    return new Promise((ok, bad) => {
      const fr = new FileReader();
      fr.onerror = () => bad(new Error('read'));
      fr.onload = () => {
        const im = new Image();
        im.onerror = () => bad(new Error('decode'));
        im.onload = () => {
          const k = Math.min(1, 1600 / Math.max(im.naturalWidth, im.naturalHeight)), c = document.createElement('canvas');
          c.width = Math.max(1, Math.round(im.naturalWidth * k)); c.height = Math.max(1, Math.round(im.naturalHeight * k));
          const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(im, 0, 0, c.width, c.height);
          const url = c.toDataURL('image/jpeg', 0.85);
          ok({ mime: 'image/jpeg', b64: url.slice(url.indexOf(',') + 1), url });
        };
        im.src = fr.result;
      };
      fr.readAsDataURL(file);
    });
  }
  async function aiAddImages(files) {
    const D = S.aiDraft;
    for (const f of [...(files || [])].filter(f => /^image\//.test(f.type))) {
      if (D.imgs.length >= 2) { toast(L('사진은 두 장까지 넣을 수 있어요', 'You can add up to two pictures'), true); break; }
      try { const im = await shrinkImage(f); if (im.b64.length > 3900000) throw new Error('big'); D.imgs.push(im); }
      catch (e) { toast(L('이 사진은 읽을 수 없어요', 'Couldn’t read this picture'), true); }
    }
    drawAiBox();
  }
  async function aiSend() {
    const st = S, D = st.aiDraft, text = D.text.trim();
    if (!text && !D.imgs.length) { toast(L('안 되는 시간을 적거나 사진을 넣어 주세요', 'Describe when you’re busy or add a picture'), true); return; }
    st.aiRun = true; st.ai = null; st.aiOk = false; drawAiBox(); drawGrids();   // 새로 물으면 이전 결과는 치움
    const reqTz = st.tz, tok = st.aiTok = (st.aiTok || 0) + 1;   // 결과는 보낼 때의 시간대로 해석, 이름을 바꾸면 tok 이 바뀌어 버림
    try {
      const r = await api('POST', '/api/events/' + st.id + '/ai', { text, images: D.imgs.map(x => ({ mime: x.mime, b64: x.b64 })), tz: reqTz, lang: LANG }, 60000);
      const t0 = Date.now();
      for (;;) {
        await new Promise(r2 => setTimeout(r2, 2500));
        if (S !== st || st.aiTok !== tok) return;   // 다른 화면·다른 이름으로 바뀌면 버림
        const j = await api('GET', '/api/ai/' + r.job, null, 20000);
        if (j.status === 'ok') { if (st.aiTok !== tok) return; st.ai = { tz: reqTz, busy: j.busy || [], note: j.note || '', shown: true }; st.aiOk = false; break; }
        if (j.status === 'err') throw new Error((LANG === 'en' && j.error_en) || j.error);
        if (Date.now() - t0 > 600000) throw new Error(L('AI가 너무 오래 걸려요. 다시 해 주세요', 'The AI is taking too long. Please try again'));
      }
    } catch (e) { if (S === st && st.aiTok === tok) toast(e.message, true); }
    if (st.aiTok !== tok) return;
    st.aiRun = false;
    if (S === st) { drawSignin(true); drawGrids(); }
  }
  function aiApply() {   // AI 가 뺀 시간은 '안 돼요', 나머지는 모두 '돼요'로 칠함
    if (!S.ai || !S.mine) return;
    S.ev.slots.forEach((x, i) => { S.mine[i] = aiAt(i) ? 0 : 1; });
    S.aiCheck = true; S.aiOk = false;          // 사람이 표를 다시 보도록 띠를 남김(이 기기에 기억)
    store.set('meet:aicheck:' + S.id + '|' + S.name, '1');
    markDirty(); drawSignin(true); drawGrids();
    toast(L('칠했어요. 표를 한 번 훑어보고 틀린 칸은 직접 고쳐 주세요', 'Done. Look over the grid and fix any slot that’s wrong'));
    const g = S.signin.querySelector('.aicheck'); if (g) g.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
  function aiItemText(b) {
    const ds = b.key.split('-').map(Number), p = { mo: ds[1], d: ds[2], wd: new Date(Date.UTC(ds[0], ds[1] - 1, ds[2])).getUTCDay() };
    return dateLabel(S.ev, p) + ' ' + fmtMin(b.start) + L('~', ' – ') + fmtMin(b.end) + (b.why ? ' · ' + b.why : '');
  }
  function drawAiBox() {
    const box = S.aiBox; if (!box) return;
    const saveKey = 'meet:aitext:' + S.name, saved = store.get(saveKey) || '';   // 기본 문구: 이름마다 이 기기에만
    const D = S.aiDraft || (S.aiDraft = { text: saved, imgs: [] }), A = S.ai;
    box.textContent = '';
    const ta = h('textarea', { class: 'aitext', rows: 3, maxlength: 1000, disabled: S.aiRun ? true : null,
      placeholder: L('예: 월요일은 종일 외래예요. 오후 8시 이후는 안 되고, 수·금 오후도 안 돼요.', 'e.g. I’m in clinic all day on Mondays. Nothing after 8 PM, and Wednesday and Friday afternoons don’t work.'),
      oninput: e => { D.text = e.target.value; },
      onpaste: e => { const fs = e.clipboardData && [...e.clipboardData.files]; if (fs && fs.length) { e.preventDefault(); aiAddImages(fs); } } });
    ta.value = D.text;
    const file = h('input', { type: 'file', class: 'hide', accept: 'image/*', multiple: true, onchange: e => { aiAddImages(e.target.files); e.target.value = ''; } });
    box.append(...[
      h('div', { class: 'aihead' }, h('b', null, L('말로 알려 주기', 'Just tell us')), h('span', { class: 'opt' }, 'AI')),
      h('p', { class: 'note' }, L('안 되는 시간을 편하게 적거나 일정표 사진을 넣으면, AI가 표에서 그 시간을 빼 드려요.', 'Describe when you’re busy, or add a picture of your schedule, and AI will take those times out of the grid.')),
      ta,
      h('div', { class: 'aisave' },
        h('button', { type: 'button', class: 'linkbtn', disabled: S.aiRun ? true : null, onclick: () => {
          const t = (D.text || '').trim();
          if (!t) { toast(L('저장할 문구를 먼저 적어 주세요', 'Type something to save first'), true); return; }
          store.set(saveKey, t.slice(0, 1000));
          toast(store.get(saveKey) === t.slice(0, 1000) ? L('기본 문구로 저장했어요. 다음 모임에서도 자동으로 채워져요', 'Saved. It’ll be filled in for your next events too') : L('이 브라우저에서는 저장할 수 없어요', 'This browser can’t save it'), store.get(saveKey) !== t.slice(0, 1000));
          drawAiBox();
        } }, saved ? L('기본 문구 바꾸기', 'Update my default') : L('기본 문구로 저장', 'Save as my default')),
        saved && saved !== D.text ? h('button', { type: 'button', class: 'linkbtn', disabled: S.aiRun ? true : null, onclick: () => { D.text = saved; drawAiBox(); } }, L('저장한 문구 불러오기', 'Use my default')) : null,
        saved ? h('button', { type: 'button', class: 'linkbtn', disabled: S.aiRun ? true : null, onclick: () => { store.set(saveKey, null); toast(L('저장한 문구를 지웠어요', 'Default removed')); drawAiBox(); } }, L('저장한 문구 지우기', 'Remove default')) : null,
        h('span', { class: 'note small' }, L('이 기기에만 저장돼요 · 여럿이 쓰는 기기에서는 저장하지 마세요', 'Saved on this device only · don’t save on a shared device'))),
      D.imgs.length ? h('div', { class: 'aiimgs' }, D.imgs.map((im, k) => h('span', { class: 'aiimg' }, h('img', { src: im.url, alt: L('넣은 사진 ', 'Picture ') + (k + 1) }),
        h('button', { type: 'button', 'aria-label': L('사진 빼기', 'Remove picture'), disabled: S.aiRun ? true : null, onclick: () => { D.imgs.splice(k, 1); drawAiBox(); } }, '×')))) : null,
      h('div', { class: 'row airow' },
        h('button', { type: 'button', disabled: S.aiRun || D.imgs.length >= 2 ? true : null, onclick: () => file.click() }, L('사진 넣기', 'Add picture')),
        h('button', { type: 'button', class: 'primary', disabled: S.aiRun ? true : null, onclick: aiSend }, S.aiRun ? L('읽고 있어요…', 'Reading…') : L('AI에게 맡기기', 'Ask AI'))),
      file,
      h('p', { class: 'note small' }, L('적은 글과 사진은 읽기 위해 AI(OpenAI)로 보내요. 서버에는 남기지 않아요. 하루에 쓸 수 있는 횟수가 정해져 있어요.', 'Your text and pictures are sent to an AI service (OpenAI) to be read. We don’t keep them on our server. There’s a daily limit.'))].filter(Boolean));
    if (S.aiRun) box.append(h('p', { class: 'aiwait' }, L('보통 10~30초 걸려요.', 'This usually takes 10–30 seconds.')));
    if (A) {
      const okBox = h('input', { type: 'checkbox', id: 'f-aiok', checked: S.aiOk ? true : null, onchange: e => { S.aiOk = e.target.checked; applyBtn.disabled = !S.aiOk; } });
      const applyBtn = h('button', { type: 'button', class: 'primary', disabled: S.aiOk ? null : true, onclick: aiApply }, L('이대로 칠하기', 'Paint it this way'));
      const res = h('div', { class: 'aires' },
        h('p', { class: 'note warn' }, L('AI는 잘못 읽을 수 있어요. 아래 목록과 표의 빗금이 내 일정과 맞는지 꼭 확인해 주세요.', 'AI can get things wrong. Check that the list below and the striped slots match your schedule.')),
        A.note ? h('p', { class: 'ainote' }, A.note) : null,
        A.busy.length ? h('ul', { class: 'callist' }, A.busy.map(b => h('li', null, aiItemText(b)))) : h('p', { class: 'note' }, L('뺄 시간을 찾지 못했어요. 조금 더 쉽게 적어 보세요.', 'No busy times found. Try saying it more simply.')),
        A.busy.length ? h('label', { class: 'aiok', for: 'f-aiok' }, okBox, L('목록을 확인했어요', 'I’ve checked the list')) : null,
        A.busy.length ? h('div', { class: 'row' },
          applyBtn,
          h('button', { type: 'button', class: 'linkbtn', onclick: () => { S.ai = null; S.aiOk = false; drawSignin(true); drawGrids(); } }, L('결과 지우기', 'Clear result'))) : null,
        A.busy.length ? h('p', { class: 'note small' }, L('‘이대로 칠하기’를 누르면 뺀 시간만 비우고 나머지를 모두 칠해요. 지금 칠해 둔 것은 바뀌어요. 표의 빗금은 AI가 뺀 시간이에요.', '“Paint it this way” leaves the busy times empty and paints everything else, replacing what you’ve painted. Striped slots are the times AI took out.')) : null);
      box.append(res);
    }
  }

  // ---------- 내 시간 (이름 적기 → 칠하기) ----------
  function drawSignin(force) {
    const box = S.signin;
    if (!force && S.name && box.querySelector('.mine-grid')) { box.querySelector('.count').textContent = countText(); return; }
    box.textContent = '';
    if (!S.name) {
      const had = S.nameInp && S.nameInp.value, focused = S.nameInp && document.activeElement === S.nameInp;
      const inp = S.nameInp || (S.nameInp = h('input', { id: 'f-name', maxlength: 60, placeholder: L('이름 또는 별명', 'Name or nickname'), autocomplete: 'name', onkeydown: e => { if (e.key === 'Enter' && !e.isComposing) join(inp.value); } }));
      const names = Object.keys(S.ev.people);
      box.append(h('h2', null, L('내 시간', 'Your times')),
        h('div', { class: 'signin' },
          h('label', { for: 'f-name' }, L('이름', 'Name')),
          h('div', { class: 'row' }, inp, h('button', { type: 'button', class: 'primary', onclick: () => join(inp.value) }, L('시작', 'Start'))),
          h('p', { class: 'note' }, L('전에 적었다면 같은 이름을 쓰세요. 칠해 둔 시간을 불러와 고칠 수 있어요. 비밀번호는 없어요.', 'If you’ve added your name before, use the same one to load and edit your times. There’s no password.')),
          names.length ? h('p', { class: 'note' }, L('참여한 사람: ', 'People so far: '), names.map((n, i) => [i ? ', ' : '', h('button', { type: 'button', class: 'linkbtn', onclick: () => join(n) }, n)])) : null));
      if (focused || (!had && !('ontouchstart' in window))) setTimeout(() => inp.focus(), 0);
      return;
    }
    if (store.get('meet:aicheck:' + S.id + '|' + S.name) === '1') S.aiCheck = true;
    S.statusEl = h('span', { class: 'status', 'aria-live': 'polite' });
    S.aiBox = h('section', { class: 'aibox', 'aria-label': L('말로 알려 주기', 'Just tell us') });
    S.calInfoEl = (CAL || S.ai) ? h('p', { class: 'note calinfo', 'aria-live': 'polite' }, L('마우스를 올리면 겹치는 일정이 보여요. 휴대폰에서는 아래 일정 목록을 봐 주세요.', 'Hover over a slot to see overlapping events. On a phone, see the event list below.')) : null;
    box.append(h('h2', null, L(S.name + '님의 시간', S.name + '’s times')),
      h('div', { class: 'legend' }, h('i', { class: 'sw off' }), L('안 돼요', 'Not free'), h('i', { class: 'sw on' }), L('돼요', 'Free'), (CAL || S.ai) ? [h('i', { class: 'sw busy' }), L('내 일정', 'My events')] : null, S.statusEl),
      h('p', { class: 'note' }, L('되는 시간을 누르거나 쭉 끌어서 칠해 주세요. 한 번 더 누르면 지워지고, 칠하는 대로 저장돼요.', 'Tap or drag across the times that work to paint them. Tap again to clear. Changes save as you go.')),
      S.aiBox,
      ...(S.aiCheck ? [h('div', { class: 'aicheck', role: 'status' },
        h('p', null, h('b', null, L('AI가 칠한 시간이에요.', 'AI painted these times.')), ' ', L('칸을 하나씩 훑어보고, 틀린 곳은 눌러서 고쳐 주세요. 다른 사람에게는 지금 칠한 대로 보여요.', 'Go through the slots and tap any that are wrong. Others see your times as painted now.')),
        h('button', { type: 'button', onclick: () => { S.aiCheck = false; store.set('meet:aicheck:' + S.id + '|' + S.name, null); drawSignin(true); drawGrids(); } }, L('다 확인했어요', 'I’ve checked')))] : []),
      h('div', { class: 'mine-grid' }),
      ...(S.calInfoEl ? [S.calInfoEl] : []),
      h('p', { class: 'note' }, h('span', { class: 'count' }, countText()), ' · ',
        h('button', { type: 'button', class: 'linkbtn', onclick: () => { flushSave(S); S.name = ''; S.mine = null; S.nameInp = null; S.ai = null; S.aiDraft = null; S.aiRun = false; S.aiCheck = false; S.aiOk = false; S.aiTok = (S.aiTok || 0) + 1; store.set('meet:name:' + S.id, null); drawSignin(); drawGrids(); } }, L('다른 이름으로 하기', 'Use a different name'))),
      drawCalBox());
    drawAiBox();
    showStatus();
  }
  function countText() { const k = S.mine ? S.mine.filter(Boolean).length : 0; return L(k + '칸 칠함', cnt(k, 'slot', 'slots') + ' marked'); }
  function join(raw) {
    const name0 = String(raw || '').replace(/[\x00-\x1f\x7f\u0085\u180e\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '').trim().replace(/\s+/g, ' ');   // server.py clean_text 와 같은 규칙
    const name = Array.from(name0).slice(0, 30).join('');   // 글자 수(코드 포인트)로 30자, 서버와 같게
    if (!name) { toast(L('이름을 적어 주세요', 'Add your name'), true); return; }
    S.name = name; S.nameInp = null; store.set('meet:name:' + S.id, name);
    const had = own(S.ev.people, name);
    loadMine();
    if (!had) markDirty();   // 처음 온 사람도 명단에 바로 보이게
    drawSignin(); drawGrids();
    toast(had ? L(name + '님이 칠해 둔 시간을 불러왔어요', 'Loaded the times ' + name + ' marked') : L(name + '님, 되는 시간을 칠해 주세요', 'Hi ' + name + ', mark the times that work for you'));
  }

  // ---------- 저장: 한 창의 요청은 한 줄로 세워 차례대로, 실패하면 같은 내용을 다시 보냄 ----------
  function enqueue(st, fn) { const p = st.chain.then(fn, fn); st.chain = p.catch(() => {}); return p; }
  function markDirty() { S.dirty = true; showStatus(); clearTimeout(S.saveT); const st = S; S.saveT = setTimeout(() => save(st), 400); }
  function flushSave(st) { clearTimeout(st.saveT); if (st.dirty) save(st); }
  window.addEventListener('pagehide', () => {   // 창을 닫을 때: 아직 안 보냈거나 보내는 중이면 마지막 상태를 한 번 더
    if (S && (S.dirty || S.inflight) && S.name && S.mine) {
      try { fetch('/api/events/' + S.id + '/people', { method: 'PUT', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: S.name, avail: S.mine.join(''), seq: ++SEQ, tab: TAB }) }); } catch (e) { /* 무시 */ }
    }
  });
  function save(st) {
    if (!st.name || !st.mine) return;
    clearTimeout(st.saveT);
    if (st.painting) { st.saveT = setTimeout(() => save(st), 400); return; }   // 끄는 중이면 끝난 뒤에
    st.dirty = false;
    const body = { name: st.name, avail: st.mine.join(''), seq: ++SEQ, tab: TAB };   // 지금 값을 떠서 보냄(이름을 바꿔도 안전)
    lastSent[st.id + '|' + st.name] = body.avail; sentSeq[st.id + '|' + st.name] = body.seq;
    send(st, body, 0);
  }
  function send(st, body, tries) {
    const k = st.id + '|' + body.name;
    if (tries && (sentSeq[k] || 0) > body.seq) return;   // 같은 이름으로 더 새 내용을 이미 보냄 → 옛 재시도는 버림
    st.inflight++; showStatus();
    enqueue(st, () => ((lastOk[k] || 0) > body.seq || (tries && (sentSeq[k] || 0) > body.seq)) ? Promise.resolve(st.ev) : api('PUT', '/api/events/' + st.id + '/people', body))
      // 마지막으로 보낸 것이 저장되면 그다음부터는 서버 값을 믿음(lastSent 지움)
      .then(ev => { lastOk[k] = Math.max(lastOk[k] || 0, body.seq); if (sentSeq[k] === body.seq) delete lastSent[k]; st.ev = ev; st.failed = false; st.lastSaved = Date.now(); if (S === st && !st.painting) drawGroup(); })
      .catch(e => {
        st.failed = true;
        if (S === st) toast(L('저장하지 못했어요. 잠시 뒤에 다시 저장할게요', 'Couldn’t save. Trying again in a moment'), true);
        if (tries < 8) setTimeout(() => send(st, body, tries + 1), Math.min(30000, 3000 * (tries + 1)));   // 더 새 저장이 이미 있으면 서버가 이 옛 요청을 버림
      })
      .finally(() => { st.inflight--; if (S === st) showStatus(); });
  }
  function showStatus() {
    if (!S || !S.statusEl) return;
    const el = S.statusEl;
    if (S.failed && !S.inflight) { el.textContent = L('저장 안 됨 · 인터넷 연결을 확인해 주세요', 'Not saved · Check your internet connection'); el.className = 'status bad'; }
    else if (S.inflight || S.dirty) { el.textContent = S.failed ? L('다시 저장하는 중…', 'Retrying…') : L('저장하는 중…', 'Saving…'); el.className = 'status'; }
    else if (S.lastSaved) { const d = new Date(S.lastSaved); el.textContent = L(fmtMin(d.getHours() * 60 + d.getMinutes()) + ' 저장됨', 'Saved at ' + fmtMin(d.getHours() * 60 + d.getMinutes())); el.className = 'status ok'; }
    else el.textContent = '';
  }

  // ---------- 표 ----------
  function perPage(box) {
    const w = box.clientWidth || 360;
    return Math.max(3, Math.min(10, Math.floor((w - 72) / (w < 500 ? 50 : 60))));
  }
  function drawGrids() { if (!S) return; S.L = layout(S.tz); drawMine(); drawGroup(); }
  function pager(n, total) {
    const pages = Math.ceil(total / n);
    if (S.page >= pages) S.page = pages - 1;
    if (pages <= 1) return null;
    return h('div', { class: 'pager' },
      h('button', { type: 'button', disabled: S.page === 0, onclick: () => { S.page--; drawGrids(); } }, L('‹ 앞 날짜', '‹ Earlier')),
      h('span', null, L((S.page + 1) + ' / ' + pages + ' 쪽', 'Page ' + (S.page + 1) + ' of ' + pages)),
      h('button', { type: 'button', disabled: S.page >= pages - 1, onclick: () => { S.page++; drawGrids(); } }, L('뒤 날짜 ›', 'Later ›')));
  }
  function gridEl(c0, c1, kind) {
    const LY = S.L, ev = S.ev, nc = c1 - c0, cal = kind === 'mine' ? calFor() : null;
    const g = h('div', { class: 'grid ' + kind });
    g.style.gridTemplateColumns = '72px repeat(' + nc + ', minmax(44px, 1fr))';
    g.append(h('div'));
    for (let c = c0; c < c1; c++) {
      const p = LY.cols[c].p;
      let ad = null;
      if (kind === 'mine' && cal) {   // 하루 종일 일정이 있는 날
        const t = new Set(); LY.cell[c].forEach(i => { if (i >= 0 && cal.dayAt[i]) cal.dayAt[i].forEach(x => t.add(x)); });
        if (t.size) ad = h('span', { class: 'ad', title: [...t].join(', ') }, L('종일', 'All day'));
      }
      g.append(h('div', { class: 'colh' + (p.wd === 0 ? ' sun' : p.wd === 6 ? ' sat' : '') }, ev.mode === 'days' ? WD[p.wd] : [L(p.mo + '/' + p.d, MON[p.mo - 1] + ' ' + p.d), h('br'), WD[p.wd]], ad));
    }
    const cells = [];
    LY.rows.forEach((m, r) => {
      const fold = m % 1 !== 0, mm = LY.rmin.get(m), gap = r > 0 && !fold && m - LY.rows[r - 1] > ev.step;
      const prevFold = r > 0 && LY.rows[r - 1] % 1 !== 0;
      const lab = fold ? (prevFold ? '' : L('다시 ', 'Again ') + fmtHour(mm)) : (mm % 60 === 0 || r === 0 || gap) ? fmtHour(mm) : '';   // 한 번 더 오는 시각은 첫 줄에 '다시 오전 1시'
      g.append(h('div', { class: 'rowh' + (gap ? ' gap' : '') + (fold ? ' fold' : ''), title: fold ? L('서머타임이 끝나 같은 시각이 한 번 더 옵니다', 'Daylight saving time ended, so this hour comes around twice') : null }, lab));
      for (let c = c0; c < c1; c++) {
        const i = LY.cell[c][r];
        const bz = kind === 'mine' && i >= 0 && busyTitles(i, cal);
        const el = h('div', { class: 'cell' + (i < 0 ? ' x' : '') + (gap ? ' gap' : '') + (!fold && mm % 60 === 0 ? ' hr' : '') + (bz ? ' busy' : ''), 'data-i': i >= 0 ? i : null, 'data-c': c - c0, 'data-r': r, title: bz ? L('내 일정: ', 'My events: ') + bz.join(', ') : null });
        g.append(el);
        (cells[c - c0] || (cells[c - c0] = []))[r] = el;
      }
    });
    g.cells = cells;
    return g;
  }
  function range(box) {
    const n = perPage(box), pg = pager(n, S.L.cols.length), c0 = S.page * n;
    return { pg, c0, c1: Math.min(S.L.cols.length, c0 + n) };
  }

  function drawMine() {
    const wrap = S.signin.querySelector('.mine-grid');
    if (!wrap || !S.mine) return;
    wrap.textContent = '';
    const { pg, c0, c1 } = range(S.signin), g = gridEl(c0, c1, 'mine');
    const paintCell = (el, v) => el.classList.toggle('on', v === 1);
    g.querySelectorAll('.cell[data-i]').forEach(el => paintCell(el, S.mine[+el.dataset.i]));
    let drag = null;
    g.addEventListener('pointerdown', e => {   // 누른 칸이 칠해져 있으면 지우기, 아니면 칠하기 — 끈 만큼 네모로
      const t = e.target.closest('.cell[data-i]'); if (!t) return;
      e.preventDefault(); try { g.setPointerCapture(e.pointerId); } catch (x) { /* 무시 */ }
      drag = { c: +t.dataset.c, r: +t.dataset.r, val: S.mine[+t.dataset.i] ? 0 : 1, snap: S.mine.slice() };
      calInfo(+t.dataset.i);
      S.painting = true; S.dirty = true; rect(drag.c, drag.r);
    });
    g.addEventListener('pointermove', e => {
      if (!drag) return;
      const el = document.elementFromPoint(e.clientX, e.clientY), t = el && el.closest && el.closest('.cell');
      if (t && g.contains(t)) rect(+t.dataset.c, +t.dataset.r);
    });
    g.addEventListener('pointerover', e => { if (e.pointerType === 'mouse' && !drag) { const t = e.target.closest('.cell[data-i]'); if (t) calInfo(+t.dataset.i); } });
    const st = S;
    const end = () => { if (!drag) return; drag = null; st.painting = false; if (S !== st) { flushSave(st); return; } markDirty(); drawGroup(); drawSignin(); };
    g.addEventListener('pointerup', end); g.addEventListener('pointercancel', end); g.addEventListener('lostpointercapture', end);
    function rect(c, r) {
      const ca = Math.min(drag.c, c), cb = Math.max(drag.c, c), ra = Math.min(drag.r, r), rb = Math.max(drag.r, r);
      g.cells.forEach((col, x) => col.forEach((el, y) => {
        if (el.dataset.i == null) return;
        const i = +el.dataset.i, v = (x >= ca && x <= cb && y >= ra && y <= rb) ? drag.val : drag.snap[i];
        if (S.mine[i] !== v) { S.mine[i] = v; paintCell(el, v); }
      }));
    }
    if (pg) wrap.append(pg);
    wrap.append(h('div', { class: 'gscroll' }, g));
  }

  function drawGroup() {
    if (!S || !S.L) return;
    const box = S.group, ps = people(), n = ps.length, ev = S.ev;
    const yes = ev.slots.map(() => []), no = ev.slots.map(() => []);
    ps.forEach(p => p.a.forEach((v, i) => (v === 1 ? yes : no)[i].push(p.name)));
    box.textContent = '';
    box.append(h('h2', null, L('모두의 시간 ', 'Everyone’s times '), h('small', null, L(n + '명', cnt(n, 'person', 'people')))));
    if (!n) { box.append(h('p', { class: 'note' }, L('아직 아무도 칠하지 않았어요. 링크를 보내 두면 사람들이 칠한 시간이 여기에 모여요.', 'No one has marked any times yet. Send the link, and the times people mark will collect here.'))); return; }
    box.append(h('div', { class: 'legend' }, L('0명', 'None'), [0, 1, 2, 3, 4, 5].map(k => h('i', { class: 'sw h' + k })), L(n + '명 모두', 'All ' + n)),
      h('p', { class: 'note' }, L('색이 진할수록 되는 사람이 많아요. 칸을 누르면 누가 되는지 아래에 보여요.', 'The darker the color, the more people are free. Tap a slot to see who, below.')));
    const { pg, c0, c1 } = range(box), g = gridEl(c0, c1, 'group');
    g.querySelectorAll('.cell[data-i]').forEach(el => {
      const i = +el.dataset.i, y = yes[i].length;
      el.classList.add('h' + (y ? Math.ceil(y / n * 5) : 0));
      if (y === n) el.classList.add('all');
      if (i === S.focus) el.classList.add('focus');
      el.title = L(n + '명 중 ' + y + '명 가능', y + ' of ' + n + ' free');
    });
    const detail = h('div', { class: 'detail', 'aria-live': 'polite' });
    const show = i => {
      S.focus = i;
      g.querySelectorAll('.focus').forEach(x => x.classList.remove('focus'));
      const el = g.querySelector('.cell[data-i="' + i + '"]'); if (el) el.classList.add('focus');
      detail.textContent = '';
      if (i < 0 || i >= ev.slots.length) { detail.append(h('p', { class: 'note' }, L('칸을 누르면 그 시간에 되는 사람이 여기에 보여요.', 'Tap a slot to see who’s free then.'))); return; }
      detail.append(...[h('p', { class: 'dt' }, slotText(ev, S.tz, i)),
        S.tz !== ev.tz ? h('p', { class: 'note' }, L('만든 곳 시간으로는 ', 'In the event’s time zone: ') + slotText(ev, ev.tz, i)) : null,
        h('div', { class: 'lists' },
          h('div', null, h('b', null, L('돼요 ' + yes[i].length + '명', 'Free (' + yes[i].length + ')')), h('ul', null, yes[i].map(x => h('li', null, x)))),
          h('div', null, h('b', null, L('안 돼요 ' + no[i].length + '명', 'Not free (' + no[i].length + ')')), h('ul', { class: 'no' }, no[i].map(x => h('li', null, x)))))].filter(Boolean));
    };
    g.addEventListener('pointerover', e => { if (e.pointerType === 'mouse') { const t = e.target.closest('.cell[data-i]'); if (t) show(+t.dataset.i); } });
    g.addEventListener('click', e => { const t = e.target.closest('.cell[data-i]'); if (t) show(+t.dataset.i); });
    if (pg) box.append(pg);
    box.append(h('div', { class: 'gscroll' }, g), detail);
    show(S.focus);
  }

  // =====================================================================
  // 사용법
  // =====================================================================
  function showGuide() {
    stopPoll();
    document.title = L('사용법 · 시간정하기', 'Guide · ' + BRAND);
    const app = $('#app'); app.textContent = '';
    const sec = (title, ...kids) => h('section', { class: 'gsec' }, h('h2', null, title), ...kids);
    const qa = (q, a) => h('details', { class: 'qa' }, h('summary', null, q), h('p', null, a));
    app.append(h('div', { class: 'page guide' },
      h('h1', null, L('시간정하기 사용법', 'How Find a time works')),
      h('p', { class: 'lead' }, L('여러 사람이 되는 시간을 한 표에 모아, 가장 많이 되는 시간을 찾아 줘요. 엑셀 파일을 돌리며 O·X를 적던 일을 링크 하나로 끝낼 수 있어요. 가입도 비밀번호도 없어요.', 'Collect everyone’s availability in one table and find the time that works for the most people. One link replaces the spreadsheet that gets passed around. No sign-up, no password.')),
      sec(L('모임을 만들 때', 'Creating an event'),
        steps(L([
          [h('b', null, '모임 이름'), '을 적어요. 예: 11월 연구실 회의'],
          [h('b', null, '언제 모일까요?'), '에서 후보 날짜를 눌러요. 누른 채로 쭉 끌면 여러 날이 한 번에 골라지고, 한 번 더 누르면 빠져요.'],
          ['매주 모이는 모임이라면 달력 위에서 ', h('b', null, '매주 요일'), '을 누르고 요일을 골라요.'],
          [h('b', null, '몇 시쯤이 좋을까요?'), '에서 시작과 끝 시간을 정해요. 칸 간격은 30분이 칠하기 편해요.'],
          [h('b', null, '시간대'), '는 보통 그대로 두면 돼요.'],
          [h('b', null, '모임 만들기'), '를 누르면 모임 화면이 열려요. ‘링크 복사’를 눌러 단톡방에 붙여 넣으면 끝이에요.'],
        ], [
          ['Enter an ', h('b', null, 'event name'), '. For example: November team meeting.'],
          ['Under ', h('b', null, 'When could you meet?'), ', tap the dates you’re considering. Drag to pick several days at once, and tap again to remove one.'],
          ['For a weekly meeting, select ', h('b', null, 'Days of the week'), ' above the calendar and pick the days.'],
          ['Under ', h('b', null, 'What times work?'), ', set a start and end time. A slot length of 30 minutes is easiest to paint.'],
          ['You can usually leave the ', h('b', null, 'time zone'), ' as it is.'],
          ['Select ', h('b', null, 'Create event'), ' and the event page opens. Select “Copy link” and paste it into your group chat. That’s it.'],
        ])),
        h('p', { class: 'note warn' }, L('가입이 없어서 모임 링크를 다시 찾을 방법이 없어요. 단톡방에 올려 두거나 즐겨찾기 해 두세요.', 'There are no accounts, so there’s no way to look up an event link later. Post it in your group chat or bookmark it.'))),
      sec(L('링크를 받았을 때', 'When you get a link'),
        steps(L([
          ['링크를 열어요. 카카오톡 안에서 열어도 돼요.'],
          [h('b', null, '내 시간'), '에 이름이나 별명을 적고 ', h('b', null, '시작'), '을 눌러요.'],
          [h('b', null, '되는 시간'), '을 눌러 초록색으로 칠해요. 누른 채로 끌면 네모 모양으로 한 번에 칠해져요.'],
          ['잘못 칠한 칸은 한 번 더 누르면 지워져요. 칠해진 칸에서 끌기 시작하면 끈 곳이 모두 지워져요.'],
          ['저장 버튼은 따로 없어요. 칠하는 대로 저장되고 ‘저장됨’이 보여요.'],
          ['나중에 고치려면 같은 링크에서 ', h('b', null, '같은 이름'), '을 적으면 돼요. 칠해 둔 칸이 그대로 나와요.'],
        ], [
          ['Open the link. It works inside messaging apps too.'],
          ['Under ', h('b', null, 'Your times'), ', enter your name or a nickname and select ', h('b', null, 'Start'), '.'],
          ['Tap the ', h('b', null, 'times that work'), ' to paint them green. Drag to paint a whole block at once.'],
          ['Tap a painted slot again to clear it. If you start dragging from a painted slot, everything you drag over is cleared.'],
          ['There’s no save button. Your times save as you paint, and “Saved” appears.'],
          ['To make changes later, open the same link and enter ', h('b', null, 'the same name'), '. Your painted slots will be there.'],
        ]))),
      sec(L('결과 보기', 'Seeing the results'),
        steps(L([
          [h('b', null, '모두의 시간'), '에는 사람들이 칠한 시간이 겹쳐 보여요.'],
          ['색이 진할수록 되는 사람이 많아요. 모두가 되는 칸은 테두리가 진해요.'],
          ['칸을 누르거나 마우스를 올리면, 그 시간에 ', h('b', null, '되는 사람과 안 되는 사람'), '이 표 아래에 나와요.'],
          ['날짜가 많으면 표 위의 ‘뒤 날짜 ›’로 넘겨 보세요.'],
        ], [
          [h('b', null, 'Everyone’s times'), ' shows what people painted, layered together.'],
          ['The darker the color, the more people are free. Slots where everyone is free get a bold outline.'],
          ['Tap a slot, or hover over it, to see ', h('b', null, 'who’s free and who isn’t'), ' below the table.'],
          ['With many dates, use “Later ›” above the table to move on.'],
        ]))),
      sec(L('내 달력과 비교하기', 'Comparing with your calendar'),
        steps(L([
          ['이름을 적고 시작하면 표 아래에 ', h('b', null, '내 달력과 비교하기'), '가 있어요.'],
          ['구글·애플·아웃룩 달력에서 내보낸 ', h('b', null, '달력 파일'), '(.ics, 구글은 .zip)을 고르면 일정이 있는 시간에 빗금이 생겨요. 하루 종일 일정은 날짜 위에 ‘종일’로 보여요.'],
          ['빗금은 참고용이에요. 되는 시간은 직접 칠해 주세요.'],
          [h('b', null, '구글 캘린더'), ' 컴퓨터에서 calendar.google.com → 톱니바퀴(설정) → 가져오기/내보내기 → 내보내기. 받은 zip 을 그대로 고르면 돼요.'],
          [h('b', null, '애플 캘린더'), ' Mac 캘린더 앱에서 파일 → 내보내기. 아이폰 캘린더 앱에는 내보내기가 없어서 Mac 이나 구글 캘린더를 거쳐야 해요.'],
        ], [
          ['After you add your name and start, ', h('b', null, 'Compare with my calendar'), ' appears below the table.'],
          ['Choose a ', h('b', null, 'calendar file'), ' exported from Google, Apple or Outlook Calendar (.ics, or .zip from Google) and your busy times get stripes. All-day events show as “All day” above the date.'],
          ['The stripes are only a guide. Paint your own times.'],
          [h('b', null, 'Google Calendar'), ' On a computer, go to calendar.google.com → Settings (the gear) → Import & export → Export. Choose the zip as it is.'],
          [h('b', null, 'Apple Calendar'), ' In the Calendar app on a Mac, choose File → Export. The iPhone Calendar app can’t export, so use a Mac or Google Calendar.'],
        ])),
        h('p', { class: 'note' }, L('달력 파일은 내 기기의 브라우저 안에서만 읽어요. 서버로 보내지도, 어디에 저장하지도 않고, 창을 닫으면 사라져요. 다른 사람에게는 내가 칠한 칸만 보여요.', 'Calendar files are read only in your browser. They’re never uploaded or stored, and they’re gone when you close the tab. Other people see only the slots you painted.'))),
      sec(L('시차와 서머타임', 'Time zones and daylight saving'),
        steps(L([
          ['모임은 만든 사람이 고른 시간대(보통 한국) 기준으로 만들어져요.'],
          ['해외에서 링크를 열면 기기의 시간대를 읽어 ', h('b', null, '그 나라 시간으로 바꿔서'), ' 보여 줘요. 시차를 따로 계산하지 않아도 돼요.'],
          ['다른 나라 시간으로 보고 싶다면 ‘표 시간대’에서 골라요. 칸을 누르면 만든 곳 시간도 함께 보여요.'],
          [h('b', null, '서머타임'), '은 날짜마다 따로 계산해요. 기간 중에 서머타임이 바뀌면 화면에 알려 줘요. 서머타임이 시작되는 날 없는 시각(예: 새벽 2시)은 다음 시각으로 넘어가고, 끝나는 날 두 번 오는 시각은 ‘다시 오전 1시’처럼 한 줄 더 나와요.'],
          ['‘매주 요일’ 모임은 만든 주를 기준으로 시차를 계산해요. 3월·11월처럼 서머타임이 바뀌는 철에는 날짜를 정한 뒤 한 번 더 확인해 주세요.'],
        ], [
          ['An event is built in the time zone its creator picked, usually their own.'],
          ['If you open the link from abroad, your device’s time zone is read and the table is ', h('b', null, 'shown in your local time'), '. Nobody has to work out the time difference.'],
          ['To see another time zone, choose it under “Table time zone”. When you tap a slot, the event’s own time is shown too.'],
          [h('b', null, 'Daylight saving time'), ' is worked out date by date. If it changes during the event’s dates, you’ll see a note. A time that doesn’t exist when daylight saving starts (like 2 AM) rolls forward, and a time that happens twice when it ends gets an extra row, such as “Again 1 AM”.'],
          ['“Days of the week” events use the week the event was created to work out the time difference. Around daylight saving changes, in March and November for example, check again once you’ve settled on a date.'],
        ])),
        h('p', { class: 'note' }, L('예: 서울 목요일 오전 9:00는 뉴욕 수요일 오후 7:00예요. 뉴욕이 서머타임일 때는 오후 8:00이에요.', 'Example: Thursday 9:00 AM in Seoul is Wednesday 7:00 PM in New York. When New York is on daylight saving time, it’s 8:00 PM.'))),
      sec(L('자주 묻는 질문', 'FAQ'),
        qa(L('비밀번호가 없으면 다른 사람이 내 시간을 고칠 수 있나요?', 'With no password, can someone else change my times?'), L('네. 엑셀 공유 파일처럼 링크를 아는 사람은 누구나 어떤 이름이든 고칠 수 있어요. 그 대신 가입이 필요 없어요. 링크는 모임 사람에게만 보내 주세요.', 'Yes. Like a shared spreadsheet, anyone with the link can edit any name. In return, nobody needs to sign up. Only send the link to the people in your group.')),
        qa(L('이름을 잘못 적었어요.', 'I typed my name wrong.'), L('‘다른 이름으로 하기’를 누르고 바른 이름으로 다시 칠해 주세요. 잘못 적은 이름은 그 이름으로 들어가서 칠한 칸을 모두 지우면 0칸으로 남아요.', 'Select “Use a different name” and paint again under the right one. To tidy up the wrong name, go in under it and clear every slot, and it stays at 0 slots.')),
        qa(L('다른 휴대폰이나 컴퓨터에서 고치고 싶어요.', 'I want to edit from another phone or computer.'), L('같은 링크를 열고 같은 이름을 적으면 칠해 둔 시간이 나와요.', 'Open the same link and enter the same name. Your painted times will be there.')),
        qa(L('휴대폰에서 표 위에서는 화면이 안 움직여요.', 'On my phone, the page won’t scroll over the table.'), L('표 위에서는 손가락이 칠하는 데 쓰여요. 화면을 올리고 내리려면 표 바깥(왼쪽 시각 글자나 표 위아래)을 끌어 주세요.', 'Over the table, your finger paints. To scroll the page, drag outside the table, such as on the time labels at the left or above and below the table.')),
        qa(L('달력 파일을 고르면 내 일정이 다른 사람에게 보이나요?', 'If I choose a calendar file, can others see my events?'), L('아니요. 파일은 내 브라우저 안에서만 읽고 서버로 보내지 않아요. 다른 사람에게는 내가 칠한 칸만 보여요. 새로고침하거나 창을 닫으면 다시 골라야 해요.', 'No. The file is read only in your browser and never sent to a server. Others see only the slots you painted. If you refresh or close the tab, you’ll need to choose the file again.')),
        qa(L('모임은 언제까지 남아 있나요?', 'How long does an event stay around?'), L('아무도 고치지 않은 채 1년이 지나면 자동으로 지워져요.', 'If nobody edits it for a year, it’s deleted automatically.'))),
      h('p', null, h('a', { href: '/' }, L('모임 만들러 가기', 'Create an event')))));
  }

  // ---------- 헤더 (index.html 은 한국어로 고정이라 시작할 때 언어에 맞춤) ----------
  (function () {
    const brand = $('a.brand'); if (brand) brand.textContent = BRAND;
    const g = $('.topnav a[href="/guide"]'); if (g) g.textContent = L('사용법', 'Guide');
    const nw = $('.topnav a[href="/"]'); if (nw) nw.textContent = L('새 모임', 'New event');
    const ld = $('#app .muted'); if (ld) ld.textContent = L('불러오는 중…', 'Loading…');
    const lb = $('#langbtn');
    if (lb) {
      lb.textContent = L('English', '한국어');
      lb.setAttribute('lang', L('en', 'ko'));
      lb.addEventListener('click', () => { store.set('meet:lang', L('en', 'ko')); location.reload(); });
    }
  })();

  route();
})();
