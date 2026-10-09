import { applyCommand, emptyPlan, type Member, type Store } from './domain';
export const demoMembers: Member[] = [
  { id: '10000000-0000-4000-8000-000000000001', orgId: 'demo-company', depotId: 'demo-depot', name: '田中 管理者（架空）', role: 'manager' },
  { id: '10000000-0000-4000-8000-000000000002', orgId: 'demo-company', depotId: 'demo-depot', name: '佐藤 運転者（架空）', role: 'driver' },
  { id: '10000000-0000-4000-8000-000000000003', orgId: 'demo-company', depotId: 'demo-depot', name: '鈴木 配車担当（架空）', role: 'dispatcher' },
  { id: '10000000-0000-4000-8000-000000000004', orgId: 'demo-company', depotId: 'demo-depot', name: '監査閲覧者（架空）', role: 'auditor' },
];
export function sampleStore(): Store {
  const today = new Date(); const day = new Date(today.toLocaleDateString('en-CA', { timeZone: 'Asia/Tokyo' }) + 'T00:00:00+09:00');
  // Examples are deliberately in the past so recording a real-time demo call is possible.
  day.setUTCDate(day.getUTCDate() - 1);
  const date = day.toLocaleDateString('en-CA', { timeZone: 'Asia/Tokyo' });
  const nextDay = new Date(day.getTime() + 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Tokyo' });
  const plan = { ...emptyPlan(), driverName: demoMembers[1].name, vehicle: '品川 100 あ 0000（架空）', startPlace: '東京営業所（架空）', startAt: `${date}T06:00`, endPlace: '東京営業所（架空）', endAt: `${nextDay}T20:00`, dutyStart: `${date}T05:30`, dutyEnd: `${nextDay}T20:30`, route: '東京営業所 → 東名高速 → 名古屋方面 → 東名高速 → 東京営業所（暫定）', cautions: '積卸先の高さ・重量制限を出発前に再確認。悪天候時は会社へ連絡。', safety: '翌日05:00まで休息。次便は未確定。拘束・運転時間は別の勤務記録と照合する。', fallback: '次便が未承認なら指定待機地点で停車し、会社に連絡。未指示の積地へ移動しない。', nextContact: `${nextDay}T08:00`, officePhone: '', stops: [
    { id: 'stop-1', kind: 'pickup' as const, place: '東京・サンプル倉庫（架空）', arrive: `${date}T07:00`, depart: `${date}T08:00`, notes: '一般雑貨 2t、フォークリフト荷役（例）' },
    { id: 'stop-2', kind: 'break' as const, place: '足柄SA（例）', arrive: `${date}T10:00`, depart: `${date}T10:30`, notes: '休憩30分' },
    { id: 'stop-3', kind: 'delivery' as const, place: '名古屋・サンプル倉庫（架空）', arrive: `${date}T14:00`, depart: `${date}T15:00`, notes: '卸先・入場方法は例示' },
    { id: 'stop-4', kind: 'rest' as const, place: '会社指定の休息施設（架空）', arrive: `${date}T18:00`, depart: `${nextDay}T05:00`, notes: '業務から離れた連続11時間の休息予定' },
    { id: 'stop-5', kind: 'wait' as const, place: '会社指定待機地点（架空）', arrive: `${nextDay}T05:00`, depart: `${nextDay}T08:00`, notes: '次便未確定。08:00に会社へ連絡' },
    { id: 'stop-6', kind: 'break' as const, place: '帰路の会社指定SA（例）', arrive: `${nextDay}T14:00`, depart: `${nextDay}T14:30`, notes: '帰路は暫定。会社が決定してから変更指示' },
  ] };
  const tripId = '20000000-0000-4000-8000-000000000001';
  let trip = applyCommand(undefined, { operationId: '30000000-0000-4000-8000-000000000001', tripId, action: 'create', expectedRevision: 0, payload: { driverId: demoMembers[1].id, plan } }, demoMembers[0], demoMembers, `${date}T05:00:00+09:00`);
  trip = applyCommand(trip, { operationId: '30000000-0000-4000-8000-000000000002', tripId, action: 'publish', expectedRevision: 1, payload: { baseVersion: 0, draftRevision: 0, safetyReviewed: true, reason: '初回の運行計画（架空デモ）', requestIds: [] } }, demoMembers[0], demoMembers, `${date}T05:15:00+09:00`);
  return { members: demoMembers, trips: [trip] };
}
