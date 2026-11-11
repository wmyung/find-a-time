/* 시간정하기 — 화면 밝기(자동·밝게·어둡게). 첫 그리기 전에 읽도록 <head> 에서 불러온다. */
'use strict';
(function () {
  let lang = null; try { lang = localStorage.getItem('meet:lang'); } catch (e) { /* 개인 창 */ }
  if (lang !== 'ko' && lang !== 'en') lang = document.documentElement.lang === 'en' ? 'en' : 'ko';
  const EN = lang === 'en';
  const K = 'meet:theme', L = EN ? { auto: 'Theme: Auto', light: 'Theme: Light', dark: 'Theme: Dark' } : { auto: '화면: 자동', light: '화면: 밝게', dark: '화면: 어둡게' }, NEXT = { auto: 'light', light: 'dark', dark: 'auto' };
  let cur = 'auto';
  try { const v = localStorage.getItem(K); if (v === 'light' || v === 'dark') cur = v; } catch (e) { /* 개인 창 */ }
  const apply = () => {
    if (cur === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', cur);
    const b = document.getElementById('themebtn');
    if (b) { b.textContent = L[cur]; b.setAttribute('aria-label', L[cur] + (EN ? ' (tap to change)' : ' (누르면 바뀝니다)')); }
  };
  apply();
  document.addEventListener('DOMContentLoaded', () => {
    const b = document.getElementById('themebtn'); if (!b) return;
    b.addEventListener('click', () => {
      cur = NEXT[cur];
      try { cur === 'auto' ? localStorage.removeItem(K) : localStorage.setItem(K, cur); } catch (e) { /* 무시 */ }
      apply();
    });
    apply();
  });
})();
