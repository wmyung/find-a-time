/* 시간정하기 — 달력 파일(.ics, 구글 내보내기 .zip) 읽기. 전부 이 브라우저 안에서만 하고 서버로 보내지 않는다.
   MeetICS.read(files) → 일정 목록, MeetICS.expand(list, t0, t1, tz도구) → 그 기간의 바쁜 시간 */
'use strict';
(function () {
  const E = (ko, en) => (window.MEET_LANG === 'en' ? en : ko);   // 언어는 app.js 가 나중에 정하므로 던질 때 읽는다
  const MAX_FILE = 40 * 1024 * 1024, MAX_EVENTS = 50000;

  // ---------- zip (구글 캘린더 내보내기는 .ics 들을 zip 으로 줌) ----------
  const MAX_UNZIP = 150 * 1024 * 1024;   // 풀린 크기 합계 한도(지나치게 크게 압축된 파일 막기)
  async function inflateRaw(u8, budget) {
    if (typeof DecompressionStream === 'undefined') throw new Error(E('이 브라우저는 zip 을 풀 수 없어요. zip 을 먼저 풀고 .ics 파일을 골라 주세요', 'This browser can’t open zip files. Unzip it first, then choose the .ics files'));
    const rd = new Blob([u8]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader(), parts = [];
    let n = 0;
    for (;;) {
      const { done, value } = await rd.read();
      if (done) break;
      n += value.length;
      if (n > budget.left) { try { rd.cancel(); } catch (e) { /* 무시 */ } throw new Error(E('zip 안의 달력이 너무 커요', 'The calendar inside the zip is too large')); }
      parts.push(value);
    }
    budget.left -= n;
    const out = new Uint8Array(n); let o = 0; for (const x of parts) { out.set(x, o); o += x.length; }
    return out;
  }
  async function unzipIcs(buf, budget) {
    const u8 = new Uint8Array(buf), dv = new DataView(buf), texts = [];
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error(E('zip 파일을 읽지 못했어요', 'Couldn’t read the zip file'));
    const n = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const dec = new TextDecoder();
    for (let k = 0; k < n; k++) {
      if (p + 46 > u8.length || dv.getUint32(p, true) !== 0x02014b50) throw new Error(E('zip 파일이 망가졌어요. 다시 내려받아 주세요', 'The zip file looks damaged. Please download it again'));
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
      const nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lho = dv.getUint32(p + 42, true);
      const name = dec.decode(u8.subarray(p + 46, p + 46 + nl));
      p += 46 + nl + xl + cl;
      if (!/\.ics$/i.test(name)) continue;
      if (lho + 30 > u8.length || dv.getUint32(lho, true) !== 0x04034b50) throw new Error(E('zip 안의 ' + name + ' 을(를) 읽지 못했어요', 'Couldn’t read ' + name + ' inside the zip'));
      const start = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true);
      const data = u8.subarray(start, start + csize);
      if (method === 0) { if (data.length > budget.left) throw new Error(E('zip 안의 달력이 너무 커요', 'The calendar inside the zip is too large')); budget.left -= data.length; texts.push(dec.decode(data)); }
      else if (method === 8) texts.push(dec.decode(await inflateRaw(data, budget)));
      else throw new Error(E('zip 안의 ' + name + ' 을(를) 풀 수 없어요. zip 을 풀어서 .ics 파일을 직접 골라 주세요', 'Couldn’t unpack ' + name + ' inside the zip. Unzip it yourself and choose the .ics files'));
    }
    if (!texts.length) throw new Error(E('zip 안에 .ics 파일이 없어요', 'There’s no .ics file inside the zip'));
    return texts;
  }

  // ---------- ics 글자 → 일정 ----------
  const WIN = {   // 아웃룩이 쓰는 윈도 시간대 이름 → IANA (자주 쓰는 것만)
    'Korea Standard Time': 'Asia/Seoul', 'Tokyo Standard Time': 'Asia/Tokyo', 'China Standard Time': 'Asia/Shanghai', 'Taipei Standard Time': 'Asia/Taipei',
    'Singapore Standard Time': 'Asia/Singapore', 'SE Asia Standard Time': 'Asia/Bangkok', 'India Standard Time': 'Asia/Kolkata',
    'Eastern Standard Time': 'America/New_York', 'Central Standard Time': 'America/Chicago', 'Mountain Standard Time': 'America/Denver',
    'US Mountain Standard Time': 'America/Phoenix', 'Pacific Standard Time': 'America/Los_Angeles', 'Alaskan Standard Time': 'America/Anchorage',
    'Hawaiian Standard Time': 'Pacific/Honolulu', 'GMT Standard Time': 'Europe/London', 'W. Europe Standard Time': 'Europe/Berlin',
    'Romance Standard Time': 'Europe/Paris', 'Central Europe Standard Time': 'Europe/Budapest', 'AUS Eastern Standard Time': 'Australia/Sydney',
    'New Zealand Standard Time': 'Pacific/Auckland', 'UTC': 'UTC', 'Coordinated Universal Time': 'UTC',
  };
  function unescapeText(v) { return v.replace(/\\([nN])/g, ' ').replace(/\\(.)/g, '$1'); }
  function parseProp(line) {   // NAME;P=1;Q="a:b":VALUE
    let i = 0, q = false;
    for (; i < line.length; i++) { const ch = line[i]; if (ch === '"') q = !q; else if (ch === ':' && !q) break; }
    const head = line.slice(0, i), value = line.slice(i + 1), parts = head.split(';'), params = {};
    for (const x of parts.slice(1)) { const j = x.indexOf('='); if (j > 0) params[x.slice(0, j).toUpperCase()] = x.slice(j + 1).replace(/^"|"$/g, ''); }
    return { name: parts[0].toUpperCase(), params, value };
  }
  // 날짜값: {date:'YYYY-MM-DD', min, utc:bool, tz, allDay}
  function parseDT(value, params) {
    const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(value.trim());
    if (!m) return null;
    const date = m[1] + '-' + m[2] + '-' + m[3];
    if (!m[4] || (params && params.VALUE === 'DATE')) return { date, min: 0, allDay: true };
    return { date, min: (+m[4]) * 60 + (+m[5]), sec: +(m[6] || 0), utc: !!m[7], tz: params && params.TZID ? params.TZID : null, allDay: false };
  }
  function parseDuration(v) {   // P1W, P1DT2H30M, -PT15M
    const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(v.trim());
    if (!m) return null;
    const sg = m[1] === '-' ? -1 : 1;
    return { days: sg * ((+m[2] || 0) * 7 + (+m[3] || 0)), ms: sg * (((+m[4] || 0) * 60 + (+m[5] || 0)) * 60000 + (+m[6] || 0) * 1000) };
  }
  function parseText(text, out) {
    const lines = text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
    let cur = null, depth = 0;
    for (const raw of lines) {
      if (!raw) continue;
      const up = raw.toUpperCase();
      if (up === 'BEGIN:VEVENT') { cur = { exdate: [], rdate: [] }; depth = 0; continue; }
      if (!cur) continue;
      if (up.startsWith('BEGIN:')) { depth++; continue; }       // VALARM 등 안쪽은 건너뜀
      if (up === 'END:VEVENT') { if (cur.start || (cur.recid && cur.uid)) out.push(cur); cur = null; if (out.length > MAX_EVENTS) throw new Error(E('일정이 5만 개가 넘어 읽을 수 없어요', 'There are more than 50,000 events, which is too many to read')); continue; }
      if (up.startsWith('END:')) { depth = Math.max(0, depth - 1); continue; }
      if (depth) continue;
      const p = parseProp(raw);
      switch (p.name) {
        case 'DTSTART': cur.start = parseDT(p.value, p.params); break;
        case 'DTEND': cur.end = parseDT(p.value, p.params); break;
        case 'DURATION': cur.dur = parseDuration(p.value); break;
        case 'SUMMARY': cur.title = unescapeText(p.value).slice(0, 120); break;
        case 'RRULE': cur.rrule = p.value; break;
        case 'EXDATE': for (const v of p.value.split(',')) { const d = parseDT(v, p.params); if (d) cur.exdate.push(d); } break;
        case 'RDATE': if (p.params.VALUE !== 'PERIOD') for (const v of p.value.split(',')) { const d = parseDT(v, p.params); if (d) cur.rdate.push(d); } break;
        case 'RECURRENCE-ID': cur.recid = parseDT(p.value, p.params); break;
        case 'UID': cur.uid = p.value; break;
        case 'STATUS': cur.status = p.value.toUpperCase(); break;
        case 'TRANSP': cur.transp = p.value.toUpperCase(); break;
      }
    }
  }
  async function read(files) {
    const list = [], budget = { left: MAX_UNZIP };   // 고른 파일 전체의 글자 크기 한도
    let nfiles = 0;
    for (const f of files) {
      if (f.size > MAX_FILE) throw new Error(E(f.name + ': 파일이 40MB보다 커서 읽을 수 없어요', f.name + ': The file is larger than 40 MB, so it can’t be read'));
      const buf = await f.arrayBuffer(), u8 = new Uint8Array(buf, 0, Math.min(4, buf.byteLength));
      if (!(u8[0] === 0x50 && u8[1] === 0x4b)) { if (buf.byteLength > budget.left) throw new Error(E('달력 파일이 모두 합쳐 너무 커요', 'The calendar files are too large together')); budget.left -= buf.byteLength; }
      const texts = (u8[0] === 0x50 && u8[1] === 0x4b) ? await unzipIcs(buf, budget) : [new TextDecoder().decode(buf)];
      for (const t of texts) { if (!/BEGIN:VCALENDAR/i.test(t)) continue; parseText(t, list); nfiles++; }
    }
    if (!nfiles) throw new Error(E('달력 파일(.ics)이 아니에요', 'That isn’t a calendar file (.ics)'));
    return list;
  }

  // ---------- 반복 일정 펼치기 ----------
  const DAYS = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
  const dnum = ds => Date.UTC(+ds.slice(0, 4), +ds.slice(5, 7) - 1, +ds.slice(8, 10)) / 86400000;   // 날짜 → 일 번호
  const dstr = n => { const d = new Date(n * 86400000); return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0'); };
  function parseRule(s) {
    const r = {};
    for (const kv of s.split(';')) { const j = kv.indexOf('='); if (j > 0) r[kv.slice(0, j).toUpperCase()] = kv.slice(j + 1).toUpperCase(); }
    return r;
  }
  function dayMatcher(r, s0) {   // 그 날짜가 규칙에 맞는지(시작 날짜 s0 기준)
    const freq = r.FREQ, iv = Math.max(1, parseInt(r.INTERVAL, 10) || 1);
    const n0 = dnum(s0), y0 = +s0.slice(0, 4), m0 = +s0.slice(5, 7), d0 = +s0.slice(8, 10), wd0 = (n0 + 4) % 7;
    const byday = r.BYDAY ? r.BYDAY.split(',').map(x => { const m = /^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/.exec(x); return m ? { n: m[1] ? +m[1] : 0, wd: DAYS[m[2]] } : null; }).filter(Boolean) : null;
    const bymd = r.BYMONTHDAY ? r.BYMONTHDAY.split(',').map(Number).filter(x => x && Math.abs(x) <= 31) : null;
    const bymo = r.BYMONTH ? r.BYMONTH.split(',').map(Number).filter(x => x >= 1 && x <= 12) : null;
    const wkst = DAYS[r.WKST] != null ? DAYS[r.WKST] : 1;
    const weekNo = n => Math.floor((n - (((n + 4) % 7 - wkst + 7) % 7) + 3) / 7);   // 주 시작 요일 기준 주 번호
    const okDay = (n, y, mo, d, wd, scope) => {   // 같은 달(또는 해) 안에서 요일 n번째·날짜 맞추기
      if (bymd) {
        const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
        if (!bymd.some(x => (x > 0 ? x : last + 1 + x) === d)) return false;
      }
      if (byday) {
        return byday.some(b => {
          if (b.wd !== wd) return false;
          if (!b.n) return true;
          if (scope === 'Y' && !bymo) {   // 해 안의 n번째 요일
            const first = dnum(y + '-01-01'), last = dnum(y + '-12-31');
            return b.n > 0 ? Math.floor((n - first) / 7) + 1 === b.n : Math.floor((last - n) / 7) + 1 === -b.n;
          }
          const lastD = new Date(Date.UTC(y, mo, 0)).getUTCDate();
          return b.n > 0 ? Math.floor((d - 1) / 7) + 1 === b.n : Math.floor((lastD - d) / 7) + 1 === -b.n;
        });
      }
      return true;
    };
    return (n, free) => {
      if (!free && n < n0) return false;
      const ds = dstr(n), y = +ds.slice(0, 4), mo = +ds.slice(5, 7), d = +ds.slice(8, 10), wd = (n + 4) % 7;
      if (bymo && !bymo.includes(mo)) return false;
      if (freq === 'DAILY') return (n - n0) % iv === 0 && okDay(n, y, mo, d, wd, 'D');
      if (freq === 'WEEKLY') {
        if ((weekNo(n) - weekNo(n0)) % iv !== 0) return false;
        return byday ? byday.some(b => b.wd === wd) : wd === wd0;
      }
      if (freq === 'MONTHLY') {
        if (((y - y0) * 12 + mo - m0) % iv !== 0) return false;
        return (bymd || byday) ? okDay(n, y, mo, d, wd, 'M') : d === d0;
      }
      if (freq === 'YEARLY') {
        if ((y - y0) % iv !== 0) return false;
        if (byday && !bymo) return okDay(n, y, mo, d, wd, 'Y');        // 해 안의 n번째 요일
        if (bymd || byday) return okDay(n, y, mo, d, wd, 'M');        // BYMONTH 는 위에서 걸렀음, BYMONTHDAY 만 있으면 모든 달
        return (bymo || mo === m0) && d === d0;
      }
      return false;
    };
  }

  // 규칙에 맞는 날짜를 차례로(BYSETPOS 는 한 주기(주·달·해) 안에서 n번째만)
  function* dayList(r, match, n0, from, to) {
    const pos = r.BYSETPOS ? r.BYSETPOS.split(',').map(Number).filter(x => x && Math.abs(x) <= 366) : null;
    if (!pos || r.FREQ === 'DAILY') { for (let n = from; n <= to; n++) if (match(n)) yield n; return; }
    const wkst = DAYS[r.WKST] != null ? DAYS[r.WKST] : 1;
    const periodStart = n => {
      if (r.FREQ === 'WEEKLY') return n - (((n + 4) % 7 - wkst + 7) % 7);
      const ds = dstr(n); return dnum(r.FREQ === 'MONTHLY' ? ds.slice(0, 8) + '01' : ds.slice(0, 5) + '01-01');
    };
    const periodEnd = p => {
      if (r.FREQ === 'WEEKLY') return p + 6;
      const ds = dstr(p), y = +ds.slice(0, 4), mo = +ds.slice(5, 7);
      return r.FREQ === 'MONTHLY' ? dnum(dstr(Math.round(Date.UTC(y, mo, 0) / 86400000))) : dnum(y + '-12-31');
    };
    for (let p = periodStart(from); p <= to; p = periodEnd(p) + 1) {
      const set = [];
      for (let n = r.FREQ === 'WEEKLY' ? Math.max(p, n0) : p, e = periodEnd(p); n <= e; n++) if (match(n, true)) set.push(n);   // 매주는 첫 주를 시작 날짜부터, 매달·매해는 그 기간 전체에서 고름(dateutil 과 같게)
      const pick = [...new Set(pos.map(x => set[x > 0 ? x - 1 : set.length + x]).filter(x => x != null))].sort((a, b) => a - b);
      for (const n of pick) if (n >= n0 && n >= from && n <= to) yield n;
    }
  }

  // t0~t1(ms) 기간의 일정: {busy:[{s,e,title}], allDay:[{date,title}], count}
  function expand(list, t0, t1, T) {
    const zoneOf = dt => {
      if (!dt || dt.utc) return 'UTC';
      let z = dt.tz;
      if (z) {
        z = z.replace(/^"|"$/g, '');
        if (WIN[z]) z = WIN[z];
        if (!T.validTz(z)) { const m = /([A-Za-z]+\/[A-Za-z_+\-]+(?:\/[A-Za-z_+\-]+)?)$/.exec(z); z = m && T.validTz(m[1]) ? m[1] : null; }
      }
      return z || T.tz;   // 시간대 없는 '떠 있는 시각'은 보는 사람 시간대로
    };
    const toMs = (dt, zone) => (dt.utc ? Date.UTC(+dt.date.slice(0, 4), +dt.date.slice(5, 7) - 1, +dt.date.slice(8, 10), 0, dt.min) : T.localToUtc(zone, dt.date, dt.min)) + (dt.sec || 0) * 1000;
    const busy = [], allDay = [], seen = new Set();
    const overrides = new Set();   // 반복 일정 중 따로 고치거나 취소한 회차(UID|시각)
    const zoneFor = (dt, base) => (dt.utc || dt.tz) ? zoneOf(dt) : zoneOf(base);   // 시간대가 안 적힌 EXDATE·RECURRENCE-ID 는 DTSTART 시간대
    for (const e of list) if (e.recid && e.uid) overrides.add(e.uid + '|' + (e.recid.allDay ? e.recid.date : toMs(e.recid, zoneFor(e.recid, e.start || e.recid))));
    let unknownTz = 0, unsupported = 0;
    const day0 = Math.floor(t0 / 86400000) - 2, day1 = Math.ceil(t1 / 86400000) + 2;
    let count = 0;
    for (const e of list) {
      if (!e.start || e.status === 'CANCELLED' || e.transp === 'TRANSPARENT') continue;   // DTSTART 없는 것 = 회차 취소 알림(위에서 처리)
      const s = e.start, zone = zoneOf(s);
      if (s.tz && !s.utc && zone === T.tz && !T.validTz(String(s.tz).replace(/^"|"$/g, '')) && !WIN[String(s.tz).replace(/^"|"$/g, '')]) unknownTz++;
      // 끝: DTEND 시각이면 정확한 길이, 날짜 단위 DURATION(P1D 등)은 벽시계 날짜로 더함
      let durMs = 0, durDays = 0;
      if (e.end) {
        if (e.end.allDay) durDays = Math.max(s.allDay ? 1 : 0, dnum(e.end.date) - dnum(s.date));
        else if (!s.allDay) durMs = Math.max(0, toMs(e.end, zoneOf(e.end)) - toMs(s, zone));
      } else if (e.dur && e.dur.days + e.dur.ms >= 0) { durDays = Math.max(0, e.dur.days); durMs = Math.max(0, e.dur.ms); }
      if (s.allDay && !durDays) durDays = 1;
      const ex = new Set(e.exdate.map(d => d.allDay ? d.date : String(toMs(d, zoneFor(d, s)))));
      const emit = (date, at) => {   // at: RDATE 처럼 자기 시각이 있는 회차
        const st = at || { date, min: s.min, sec: s.sec, utc: s.utc };
        if (s.allDay) {
          if (ex.has(date) || (!e.recid && e.uid && overrides.has(e.uid + '|' + date))) return;
          for (let k = 0; k < durDays; k++) { const ds = dstr(dnum(date) + k); const kk = 'A' + ds + '|' + (e.title || ''); if (!seen.has(kk)) { seen.add(kk); allDay.push({ date: ds, title: e.title || E('(제목 없음)', '(Untitled)') }); } }
          count++; return;
        }
        const z = at ? zoneFor(at, s) : zone, sMs = toMs(st, z);
        if (ex.has(String(sMs)) || (!e.recid && e.uid && overrides.has(e.uid + '|' + sMs))) return;
        const eMs = (durDays ? toMs({ date: dstr(dnum(st.date) + durDays), min: st.min, sec: st.sec, utc: st.utc }, z) : sMs) + durMs;
        if (eMs <= t0 || sMs >= t1) return;
        const kk = sMs + '|' + eMs + '|' + (e.title || '');
        if (seen.has(kk)) return;
        seen.add(kk); busy.push({ s: sMs, e: Math.max(eMs, sMs + 60000), title: e.title || E('(제목 없음)', '(Untitled)') }); count++;
      };
      // 기간 근처 날짜만 따져 본다(시작 날짜 기준 벽시계 날짜; 시간대 차이를 고려해 앞뒤로 넉넉히)
      const spanDays = durDays + Math.ceil(durMs / 86400000) + 1;
      const near = n => n >= day0 - spanDays && n <= day1;
      if (!e.rrule) { if (near(dnum(s.date))) emit(s.date); }
      else {
        const r = parseRule(e.rrule);
        if (r.BYHOUR || r.BYMINUTE || r.BYSECOND || r.BYWEEKNO || r.BYYEARDAY) unsupported++;   // 하루 여러 번 등: 날짜만 맞추고 첫 시각만 씀
        if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(r.FREQ)) { unsupported++; if (near(dnum(s.date))) emit(s.date); }
        else {
          const match = dayMatcher(r, s.date), n0 = dnum(s.date);
          let untilMs = Infinity;
          if (r.UNTIL) {
            const u = parseDT(r.UNTIL, s.utc ? null : { TZID: s.tz });
            if (u) untilMs = s.allDay ? dnum(u.date) * 86400000 : u.allDay ? (dnum(u.date) + 1) * 86400000 + 14 * 3600000 : (u.utc ? toMs(u, 'UTC') : toMs(u, zone));
          }
          const cnt = parseInt(r.COUNT, 10) || 0;
          const from = cnt ? n0 : Math.max(n0, day0 - spanDays);
          let k = 0;
          for (const n of dayList(r, match, n0, from, day1)) {
            k++;
            if (cnt && k > cnt) break;
            const ds = dstr(n);
            if (untilMs !== Infinity) { const st = s.allDay ? n * 86400000 : toMs({ date: ds, min: s.min, sec: s.sec, utc: s.utc }, zone); if (st > untilMs) break; }
            if (n >= day0 - spanDays) emit(ds);
          }
        }
      }
      for (const d of e.rdate) if (!d.allDay === !s.allDay && near(dnum(d.date))) emit(d.date, d.allDay ? null : d);
    }
    busy.sort((a, b) => a.s - b.s);
    return { busy, allDay, count, unknownTz, unsupported };
  }

  window.MeetICS = { read, expand };
})();
