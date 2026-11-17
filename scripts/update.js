// 공모주 대시보드(okc5280/gongmozu index.html) 데이터 갱신 스크립트.
// 사용법 (Aside REPL):
//   const code = await fs.readFile('<this file>', 'utf8');
//   const AF = Object.getPrototypeOf(async function(){}).constructor;
//   const res = await new AF('ctx', code)({ fetch });
//   // res = { html, changed, changes: [...], dataDate }
// 소스: 160(일육공) API + 종목 상세 페이지. 수량/점수는 추정하지 않는다.

const { fetch } = ctx;
const KST = new Date(Date.now() + 9 * 3600e3);
const dataDate = KST.toISOString().slice(0, 10);

// 1) 현재 index.html (GitHub API가 가장 최신, 실패 시 Pages)
let src = null;
try {
  const r = await fetch('https://api.github.com/repos/okc5280/gongmozu/contents/index.html?ref=main&t=' + Date.now(), { headers: { Accept: 'application/vnd.github.raw' } });
  if (r.ok) { const t = await r.text(); if (t.includes('const D=[')) src = t; }
} catch (e) {}
if (!src) src = await (await fetch('https://okc5280.github.io/gongmozu/?v=' + Date.now())).text();
const m = src.match(/const D=(\[.*?\]);/s);
if (!m) throw new Error('index.html에서 const D 데이터를 찾지 못함');
const D = JSON.parse(m[1]);
const before = JSON.stringify(D);

// 2) 160 API (2026년 1~12월)
const all = [];
for (let mo = 1; mo <= 12; mo++) {
  const mm = String(mo).padStart(2, '0');
  const last = new Date(2026, mo, 0).getDate();
  const j = await (await fetch(`https://api.metalogos.site/schedule/external?startDate=2026-${mm}-01&endDate=2026-${mm}-${last}`)).json();
  all.push(...(j?.data?.ipoStocks || []));
}
const S = Object.values(Object.fromEntries(all.map(s => [s.code, s])));
if (S.length < 10) throw new Error('160 API 응답이 비정상적으로 적음: ' + S.length);

const norm = b => b.replace('IM증권', '아이엠증권').replace('유진증권', '유진투자증권');
const d10 = x => (x ? x.slice(0, 10) : null);
const addBiz = (ds, n) => { let x = new Date(ds + 'T00:00:00Z'); while (n > 0) { x = new Date(x.getTime() + 864e5); const w = x.getUTCDay(); if (w && w < 6) n--; } return x.toISOString().slice(0, 10); };
const changes = [];

// 공식 철회신고서와 해당 공모의 청약일을 직접 대조한 증거만 허용합니다.
// 일정 누락, 점수 부재, 유사한 회사명은 철회 근거가 아닙니다.
function applyVerifiedWithdrawals(rows, proofs, today) {
  if (!Array.isArray(proofs)) throw new Error('철회 증거 목록 형식 오류');
  const validDay = x => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) && !isNaN(Date.parse(x+'T00:00:00Z')) && new Date(x+'T00:00:00Z').toISOString().slice(0,10) === x;
  const accepted = [], seen = new Set();
  // 모든 증거를 먼저 검증하고 나서 데이터에 적용합니다.
  for (const p of proofs) {
    if (!p || seen.has(p.code)) throw new Error('중복되거나 비어 있는 철회 증거');
    seen.add(p.code);
    const r = rows.find(x => x.cd === p.code);
    if (!r || r.n !== p.name || JSON.stringify(r.s) !== JSON.stringify(p.offeringDates)) throw new Error('철회 종목·회사명·청약일 불일치: '+(p.name||''));
    let u; try { u = new URL(p.sourceUrl); } catch { throw new Error('철회 공시 URL 오류'); }
    if (u.protocol !== 'https:' || u.hostname !== 'dart.fss.or.kr' || u.pathname !== '/dsaf001/main.do' || !/^\d{14}$/.test(u.searchParams.get('rcpNo')||'') || u.username || u.password) throw new Error('확인된 DART 철회신고서 원문만 허용');
    if (p.verified !== true || p.documentTitle !== '철회신고서' || !validDay(p.announcedOn) || p.announcedOn > today || typeof p.evidenceSummary !== 'string' || p.evidenceSummary.length > 800 || !/철회/.test(p.evidenceSummary) || !/청약|잔여|공모/.test(p.evidenceSummary)) throw new Error('철회 확정 근거 부족: '+r.n);
    const delta = (Date.parse(r.s[0])-Date.parse(p.announcedOn))/86400000;
    if (delta < -30 || delta > 120) throw new Error('이번 공모와 공시 시점 대조 필요: '+r.n);
    accepted.push({r,p});
  }
  const changed = [];
  for (const {r,p} of accepted) {
    if (r.wd?.status === 'withdrawn') continue;
    r.wd = {status:'withdrawn',announcedOn:p.announcedOn,confirmedOn:today,sourceName:'DART 철회신고서',sourceUrl:p.sourceUrl,offeringDates:[...r.s],evidenceSummary:p.evidenceSummary};
    changed.push(r.n+' 공모 철회 확정 ('+p.announcedOn+' 공시)');
  }
  return changed;
}

changes.push(...applyVerifiedWithdrawals(D, ctx.verifiedWithdrawals || [], dataDate));

async function detail(code) {
  try {
    const h = await (await fetch('https://metalogos.ai/160ipo/stock/' + code)).text();
    const body = h.replace(/<script[\s\S]*?<\/script>/g, '');
    const dm = body.match(/<h2[^>]*>([\s\S]*?)<\/h2>[\s\S]*?<h3[^>]*>([\s\S]*?)<\/h3>/);
    const desc = dm ? dm[2].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#x27;|&#39;/g, "'").trim() : '';
    const tx = body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    const o = tx.match(/시가\s*([+-]?\s*\d+)\s*%/), c = tx.match(/종가\s*([+-]?\s*\d+)\s*%/);
    return { desc, o: o ? +o[1].replace(/\s/g, '') : null, c: c ? +c[1].replace(/\s/g, '') : null };
  } catch (e) { return { desc: '', o: null, c: null }; }
}

for (const s of S) {
  const brokers = (s.securities || []).map(b => [norm(b.name), b.minSubscriptionCount]).filter(x => x[1]);
  const st = d10(s.offeringStartDate), en = d10(s.offeringEndDate);
  if (!st || !en) continue;
  let r = D.find(x => x.cd === s.code) || D.find(x => x.n === s.name) ||
    D.find(x => x.s[0] === st && brokers.some(b => x.k.map(norm).includes(b[0])));
  const isNew = !r;
  if (isNew) {
    r = { n: s.name, k: [], s: [st, en], r: addBiz(en, 2), re: true, l: null, p: 0, pf: false, q: 10, qa: false, sp: s.gubun !== 'normal', cd: s.code, sc: null, o: null, c: null, d: '' };
    D.push(r);
    changes.push(`신규 종목: ${s.name} (청약 ${st.slice(5)}~${en.slice(5)})`);
  }
  // 이미 철회된 공모는 재등장만으로 철회를 해제하거나 날짜를 옮기지 않습니다.
  if (r.wd?.status === "withdrawn") {
    if (JSON.stringify(r.s) !== JSON.stringify([st,en])) changes.push(`확인 필요: ${r.n} 철회 후 새 일정 발견 (공식 재추진 확인 전 기존 철회 유지)`);
    continue;
  }
  r.cd = s.code;
  // 청약일 변경
  if (r.s[0] !== st || r.s[1] !== en) {
    if (!isNew) changes.push(`${r.n} 청약일 변경: ${r.s[0].slice(5)}~${r.s[1].slice(5)} → ${st.slice(5)}~${en.slice(5)}`);
    r.s = [st, en];
    changes.push(`확인 필요: ${r.n} 청약일 변경, 환불일은 원천 확인 전 기존 값 유지`);
  }
  // 증권사/최소수량 (160 실제 값)
  if (brokers.length) {
    const kq = JSON.stringify(brokers);
    if (JSON.stringify(r.kq || []) !== kq) {
      if (!isNew && r.kq) changes.push(`${r.n} 최소수량/증권사 변경: ${brokers.map(b => b[0].replace(/투자증권|증권/, '') + ' ' + b[1] + '주').join(', ')}`);
      r.kq = brokers;
    }
    r.k = brokers.map(b => b[0]);
    r.q = Math.min(...brokers.map(b => b[1]));
    r.qa = false;
  }
  // 공모가
  if (s.offeringPrice) {
    if (!r.pf || r.p !== s.offeringPrice) { if (!isNew) changes.push(`${r.n} 확정 공모가 ${s.offeringPrice.toLocaleString()}원`); }
    r.p = s.offeringPrice; r.pf = true;
  } else if (!r.pf && s.offeringUpPrice) { r.p = s.offeringUpPrice; }
  // 상장일
  const ld = d10(s.listingDate);
  if (ld && r.l !== ld) { changes.push(`${r.n} 상장일 ${ld.slice(5)}`); r.l = ld; }
  // 매력지수
  const sc = s.ipoAdsInfo?.score ?? null;
  if (sc != null && r.sc !== sc) { changes.push(`${r.n} 160 매력지수 ${sc}점`); r.sc = sc; }
  // 상세 페이지: 설명 / 시초가·종가
  const needDesc = !r.d && !r.sp;
  const listed = s.status === 'listing' && r.l && r.l <= dataDate;
  const needRet = listed && (r.o == null || r.c == null);
  if (needDesc || needRet) {
    const dt = await detail(s.code);
    if (needDesc && dt.desc) r.d = dt.desc;
    if (needRet && dt.o != null) { r.o = dt.o; r.c = dt.c; changes.push(`${r.n} 상장일 시초가 ${dt.o > 0 ? '+' : ''}${dt.o}% / 종가 ${dt.c > 0 ? '+' : ''}${dt.c}%`); }
  }
  if (r.sp && !r.d) r.d = '기업인수목적회사(스팩)';
}

const codes = new Set(S.map(s => s.code));
const gone = D.filter(r => r.cd && !codes.has(r.cd) && r.wd?.status !== 'withdrawn' && !(r.l && r.l < dataDate && r.o != null));
const hinted = D.filter(r => r.wd?.status !== 'withdrawn' && S.some(s => s.code === r.cd && /철회|withdraw|cancel/i.test(String(s.koreanStatus||'')+' '+String(s.status||''))));
const withdrawalCandidates = [...new Map([...gone,...hinted].map(r=>[r.cd,r])).values()].map(r => ({ code:r.cd, name:r.n, offeringDates:[...r.s], listingDate:r.l, reason:codes.has(r.cd)?'160 상태 확인 필요':'160 일정에서 누락' }));
for (const r of gone) changes.push(`확인 필요: ${r.n} 이(가) 160 일정에서 사라짐 (철회/연기 가능성, 표에는 유지)`);

D.sort((a, b) => a.s[0].localeCompare(b.s[0]) || a.n.localeCompare(b.n));
const changed = JSON.stringify(D) !== before;
let html = src.replace(/const D=\[.*?\];/s, 'const D=' + JSON.stringify(D) + ';');
html = html.replace(/데이터 기준일 \d{4}-\d{2}-\d{2}/, '데이터 기준일 ' + dataDate);
return { html, changed, changes, dataDate, count: D.length, withdrawalCandidates };
