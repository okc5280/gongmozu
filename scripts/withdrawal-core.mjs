// 공식 철회신고서와 해당 공모의 청약일을 직접 대조한 증거만 허용합니다.
// 일정 누락, 점수 부재, 유사한 회사명은 철회 근거가 아닙니다.
export function applyVerifiedWithdrawals(rows, proofs, today) {
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
