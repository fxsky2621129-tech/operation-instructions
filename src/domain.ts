import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';

export type Role = 'manager' | 'driver' | 'dispatcher' | 'admin' | 'auditor';
export type Member = { id: string; name: string; orgId: string; depotId: string; role: Role };
export type Stop = { id: string; kind: 'pickup' | 'delivery' | 'via' | 'break' | 'rest' | 'wait'; place: string; arrive: string; depart: string; notes: string };
export type Plan = {
  driverName: string; crew: string; vehicle: string;
  startPlace: string; startAt: string; endPlace: string; endAt: string;
  dutyStart: string; dutyEnd: string; returnProvisional: boolean;
  route: string; cautions: string; exchange: string; safety: string;
  fallback: string; nextContact: string; officePhone: string; stops: Stop[];
};
export type Load = { name: string; pickup: string; pickupAt: string; delivery: string; deliveryAt: string; weight: string; quantity: string; source: string; receivedAt: string; handling: string; contact: string };
export type Request = { id: string; authorId: string; author: string; load: Load; reason: string; baseVersion: number; submittedAt: string; status: 'submitted' | 'returned' | 'rejected' | 'issued'; response?: string; versionId?: string };
export type Version = { id: string; number: number; snapshot: Plan; reason: string; issuedAt: string; issuer: string; hash: string; companyCopy: { snapshot: Plan; savedAt: string }; requestIds: string[] };
export type Voice = { id: string; versionId: string; actorId: string; manager: string; actualAt: string; receivedAt: string; method: 'phone' | 'voice'; recipient: string; notes: string };
export type DriverRecord = { id: string; versionId: string; driverId: string; driver: string; actualAt: string; receivedAt: string; notes: string };
export type Receipt = { id: string; versionId: string; driverId: string; deviceId: string; savedAt: string; receivedAt: string };
export type Actual = { id: string; kind: Stop['kind'] | 'drive' | 'dutyStart' | 'dutyEnd'; place: string; startAt: string; endAt: string; notes: string; actor: string; receivedAt: string };
export type Audit = { id: string; action: string; actor: string; actorId?: string; fingerprint?: string; at: string };
export type Trip = { id: string; orgId: string; depotId: string; driverId: string; createdAt: string; revision: number; draftRevision: number; draftBaseVersion: number; status: 'draft' | 'active' | 'closed'; plan: Plan; versions: Version[]; requests: Request[]; voices: Voice[]; driverRecords: DriverRecord[]; receipts: Receipt[]; actuals: Actual[]; audit: Audit[]; closedAt?: string; retainUntil?: string; policyRetainUntil?: string; legalHold: boolean };
export type Store = { members: Member[]; trips: Trip[] };
export type Action = 'create' | 'savePlan' | 'submitRequest' | 'decideRequest' | 'publish' | 'voice' | 'ack' | 'deviceSaved' | 'actual' | 'close';
export type Command = { operationId: string; tripId: string; expectedRevision: number; action: Action; payload: Record<string, unknown> };
export const roleLabels: Record<Role, string> = { manager: '運行管理者', driver: 'ドライバー', dispatcher: '配車担当', admin: 'システム管理者', auditor: '監査閲覧者' };
export const kindLabels: Record<Actual['kind'], string> = { pickup: '荷積み', delivery: '荷卸し', via: '経過地', break: '休憩', rest: '休息', wait: '待機', drive: '運転', dutyStart: '勤務開始', dutyEnd: '勤務終了' };
export const emptyPlan = (): Plan => ({ driverName: '', crew: '', vehicle: '', startPlace: '', startAt: '', endPlace: '', endAt: '', dutyStart: '', dutyEnd: '', returnProvisional: true, route: '', cautions: '', exchange: '交替なし', safety: '', fallback: '', nextContact: '', officePhone: '', stops: [] });
export const emptyLoad = (): Load => ({ name: '', pickup: '', pickupAt: '', delivery: '', deliveryAt: '', weight: '', quantity: '', source: '', receivedAt: '', handling: '', contact: '' });
export function timestamp(value: string): number {
  // datetime-local is always interpreted as Japan time, regardless of the PC timezone.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/.test(value)) return NaN;
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  const check = new Date(0); check.setUTCFullYear(year, month - 1, day); check.setUTCHours(0, 0, 0, 0);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return NaN;
  const iso = /(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? value : `${value}+09:00`;
  return Date.parse(iso);
}
export function duration(plan: Plan) { return (timestamp(plan.dutyEnd) - timestamp(plan.dutyStart)) / 3_600_000; }
export function validatePlan(p: Plan): string[] {
  const errors: string[] = [];
  const required: [keyof Plan, string][] = [['driverName', '運転者名'], ['vehicle', '車両番号'], ['startPlace', '出庫地点'], ['endPlace', '帰庫地点'], ['route', '運行経路'], ['cautions', '注意箇所'], ['exchange', '交替地点・交替の有無'], ['safety', '安全事項・休息計画'], ['fallback', '次便未確定時の行動']];
  for (const [key, name] of required) if (typeof p[key] !== 'string' || !(p[key] as string).trim()) errors.push(`${name}を入力してください。`);
  for (const [key, label] of [['startAt', '出庫日時'], ['endAt', '帰庫日時'], ['dutyStart', '最初の勤務開始'], ['dutyEnd', '最後の勤務終了'], ['nextContact', '次回連絡日時']] as const) if (!Number.isFinite(timestamp(p[key] ?? ''))) errors.push(`${label}が不正です。`);
  if (timestamp(p.endAt) <= timestamp(p.startAt)) errors.push('帰庫は出庫より後にしてください。');
  if (timestamp(p.dutyStart) > timestamp(p.startAt) || timestamp(p.dutyEnd) < timestamp(p.endAt) || timestamp(p.dutyEnd) <= timestamp(p.dutyStart)) errors.push('勤務開始・終了は出庫・帰庫を含む時刻にしてください。');
  if (timestamp(p.nextContact) < timestamp(p.startAt) || timestamp(p.nextContact) > timestamp(p.endAt)) errors.push('次回連絡は運行期間内にしてください。');
  if (duration(p) > 144) errors.push('一の運行が144時間を超えています。計画を見直してください。');
  if (!Array.isArray(p.stops) || !p.stops.length) errors.push('主な経過地と発着時刻を登録してください。');
  let previous = timestamp(p.startAt);
  for (const [i, stop] of (p.stops ?? []).entries()) {
    const a = timestamp(stop.arrive), d = timestamp(stop.depart);
    if (!stop.place.trim() || !Number.isFinite(a) || !Number.isFinite(d) || d < a || (stop.kind !== 'via' && d === a) || a < previous || d > timestamp(p.endAt)) errors.push(`行程${i + 1}の地点・発着順序・作業時間を確認してください。`);
    previous = d;
  }
  if (!p.stops?.some(s => s.kind === 'break')) errors.push('休憩地点と時間を登録してください。');
  if (!p.stops?.some(s => s.kind === 'rest')) errors.push('休息を休憩と分けて登録してください。');
  return errors;
}
export function validateLoad(load: Load): string[] {
  const errors: string[] = [];
  for (const [key, label] of [['name', '荷物名'], ['pickup', '積地'], ['delivery', '卸地'], ['source', '配車連絡元']] as const) if (!load[key]?.trim()) errors.push(`${label}を入力してください。`);
  for (const key of ['pickupAt', 'deliveryAt', 'receivedAt'] as const) if (!Number.isFinite(timestamp(load[key]))) errors.push('荷物の日時を確認してください。');
  if (timestamp(load.deliveryAt) < timestamp(load.pickupAt)) errors.push('卸日時は積日時以降にしてください。');
  return errors;
}
export function latest(trip: Trip) { return trip.versions.at(-1); }
export function progress(trip: Trip, version = latest(trip)) {
  if (!version) return { company: false, voice: false, driver: false, device: false, complete: false };
  const voice = trip.voices.some(v => v.versionId === version.id);
  const driver = trip.driverRecords.some(r => r.versionId === version.id && r.driverId === trip.driverId);
  const device = trip.receipts.some(r => r.versionId === version.id && r.driverId === trip.driverId);
  return { company: !!version.companyCopy, voice, driver, device, complete: voice && driver && device };
}
function requireValue(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
export function canRead(trip: Trip, actor: Member) { return trip.orgId === actor.orgId && trip.depotId === actor.depotId && (actor.role === 'driver' ? actor.id === trip.driverId : ['manager', 'dispatcher', 'auditor'].includes(actor.role)); }
export function addYears(iso: string, years: number) {
  const d = new Date(timestamp(iso)); const month = d.getUTCMonth(); d.setUTCFullYear(d.getUTCFullYear() + years);
  if (d.getUTCMonth() !== month) d.setUTCDate(0);
  return d.toISOString();
}
export function retentionDeadline(iso: string, years: number) {
  // Preserve the entire anniversary day in JST, not just the end-of-duty clock time.
  const d = new Date(timestamp(iso) + 9 * 3600000); d.setUTCHours(24, 0, 0, 0);
  const month = d.getUTCMonth(); d.setUTCFullYear(d.getUTCFullYear() + years); if (d.getUTCMonth() !== month) d.setUTCDate(0);
  return new Date(d.getTime() - 9 * 3600000).toISOString();
}
export function applyCommand(original: Trip | undefined, cmd: Command, actor: Member, members: Member[], now: string): Trip {
  requireValue(/^[\da-f-]{36}$/i.test(cmd.operationId), '操作IDが不正です。');
  const p = cmd.payload;
  let t: Trip;
  if (cmd.action === 'create') {
    requireValue(!original, '同じ運行が既にあります。');
    requireValue(['manager', 'dispatcher'].includes(actor.role), '運行作成の権限がありません。');
    const driver = members.find(m => m.id === p.driverId && m.role === 'driver' && m.orgId === actor.orgId && m.depotId === actor.depotId);
    requireValue(driver, '同じ営業所のドライバーを選んでください。');
    const plan = { ...structuredClone(p.plan as Plan), driverName: driver.name };
    t = { id: cmd.tripId, orgId: actor.orgId, depotId: actor.depotId, driverId: driver.id, createdAt: now, revision: 0, draftRevision: 0, draftBaseVersion: 0, status: 'draft', plan, versions: [], requests: [], voices: [], driverRecords: [], receipts: [], actuals: [], audit: [], legalHold: false };
  } else {
    requireValue(original && canRead(original, actor), 'この運行にアクセスできません。');
    requireValue(original.revision === cmd.expectedRevision, '他の操作で更新されました。再読込して差分を確認してください。');
    requireValue(original.status !== 'closed', '保存確定済みの運行は変更できません。');
    t = structuredClone(original);
  }
  const current = latest(t);
  const manager = actor.role === 'manager';
  const driver = actor.role === 'driver' && actor.id === t.driverId;
  const actualDate = (key: string) => { const at = String(p[key] ?? ''); requireValue(Number.isFinite(timestamp(at)) && timestamp(at) <= timestamp(now), '実日時は現在以前の有効な日時を入力してください。'); return at; };
  switch (cmd.action) {
    case 'create': break;
    case 'savePlan': {
      requireValue(manager || actor.role === 'dispatcher', '下書き編集の権限がありません。');
      requireValue(p.baseVersion === (current?.number ?? 0), '基準版が古いため再確認してください。');
      t.plan = { ...structuredClone(p.plan as Plan), driverName: t.plan.driverName };
      t.draftRevision++; t.draftBaseVersion = current?.number ?? 0;
      break;
    }
    case 'submitRequest': {
      requireValue(driver || actor.role === 'dispatcher', '荷物申請の権限がありません。');
      requireValue(p.baseVersion === (current?.number ?? 0), '基準版が古いため再確認してください。');
      const load = p.load as Load; requireValue(!validateLoad(load).length, validateLoad(load).join('\n'));
      requireValue(String(p.reason ?? '').trim(), '変更理由を入力してください。');
      t.requests.push({ id: cmd.operationId, authorId: actor.id, author: actor.name, load: structuredClone(load), reason: String(p.reason), baseVersion: Number(p.baseVersion), submittedAt: now, status: 'submitted' }); break;
    }
    case 'decideRequest': {
      requireValue(manager, '申請審査の権限がありません。');
      const r = t.requests.find(r => r.id === p.requestId); requireValue(r?.status === 'submitted', '審査対象の申請がありません。');
      requireValue(['returned', 'rejected'].includes(String(p.status)) && String(p.response ?? '').trim(), '差戻し・却下理由を入力してください。');
      r.status = p.status as 'returned' | 'rejected'; r.response = String(p.response); break;
    }
    case 'publish': {
      requireValue(manager, '運行管理者のみ指示書を発行できます。');
      requireValue(p.baseVersion === (current?.number ?? 0) && p.draftRevision === t.draftRevision && t.draftBaseVersion === (current?.number ?? 0), '審査対象の版・下書きが変わりました。再確認してください。');
      requireValue(p.safetyReviewed === true && String(p.reason ?? '').trim(), '計画確認と発行理由が必要です。');
      const errors = validatePlan(t.plan); requireValue(!errors.length, errors.join('\n'));
      const ids = (p.requestIds ?? []) as string[];
      requireValue(Array.isArray(ids) && new Set(ids).size === ids.length, '申請IDが不正です。');
      for (const id of ids) {
        const r = t.requests.find(r => r.id === id); requireValue(r?.status === 'submitted' && r.baseVersion === (current?.number ?? 0), '申請の基準版を再確認してください。');
        requireValue(t.plan.stops.some(s => s.kind === 'pickup' && s.place === r.load.pickup && timestamp(s.arrive) === timestamp(r.load.pickupAt)) && t.plan.stops.some(s => s.kind === 'delivery' && s.place === r.load.delivery && timestamp(s.arrive) === timestamp(r.load.deliveryAt)), '処理する荷物の積卸地点・予定日時を下書きへ反映してください。');
      }
      const snapshot = structuredClone(t.plan); const hash = bytesToHex(sha256(JSON.stringify(snapshot)));
      const v: Version = { id: cmd.operationId, number: (current?.number ?? 0) + 1, snapshot, reason: String(p.reason), issuedAt: now, issuer: actor.name, hash, companyCopy: { snapshot: structuredClone(snapshot), savedAt: now }, requestIds: ids };
      t.versions.push(v); t.status = 'active'; t.draftBaseVersion = v.number;
      for (const id of ids) { const r = t.requests.find(r => r.id === id)!; r.status = 'issued'; r.versionId = v.id; }
      break;
    }
    case 'voice': {
      requireValue(manager && current && p.versionId === current.id, '運行管理者が最新の版を指定してください。');
      requireValue(['phone', 'voice'].includes(String(p.method)) && String(p.notes ?? '').trim() && String(p.recipient ?? '').trim(), '通話方法・相手・内容を入力してください。');
      const at = actualDate('actualAt'); requireValue(timestamp(at) >= timestamp(current.issuedAt), '指示日時は発行日時以降にしてください。');
      t.voices.push({ id: cmd.operationId, versionId: current.id, actorId: actor.id, manager: actor.name, actualAt: at, receivedAt: now, method: p.method as 'phone' | 'voice', recipient: String(p.recipient), notes: String(p.notes) }); break;
    }
    case 'ack': {
      requireValue(driver && current && p.versionId === current.id, '本人が最新の版を確認してください。');
      requireValue(String(p.notes ?? '').trim(), '確認した変更内容を入力してください。');
      const at = actualDate('actualAt'); requireValue(timestamp(at) >= timestamp(current.issuedAt), '確認日時は発行日時以降にしてください。');
      requireValue(!t.driverRecords.some(r => r.versionId === current.id && r.driverId === actor.id), 'この版は記録済みです。');
      t.driverRecords.push({ id: cmd.operationId, versionId: current.id, driverId: actor.id, driver: actor.name, actualAt: at, receivedAt: now, notes: String(p.notes) }); break;
    }
    case 'deviceSaved': {
      requireValue(driver && current && p.versionId === current.id && String(p.deviceId ?? '').trim(), '本人が最新の版を端末保存してください。');
      const savedAt = actualDate('savedAt'); requireValue(timestamp(savedAt) >= timestamp(current.issuedAt), '保存日時は発行日時以降にしてください。');
      t.receipts.push({ id: cmd.operationId, versionId: current.id, driverId: actor.id, deviceId: String(p.deviceId), savedAt, receivedAt: now }); break;
    }
    case 'actual': {
      requireValue(driver, '実績は本人が入力してください。');
      requireValue(Object.keys(kindLabels).includes(String(p.kind)) && String(p.place ?? '').trim(), '実績種別と地点を入力してください。');
      const startAt = actualDate('startAt'), endAt = actualDate('endAt'); requireValue(timestamp(endAt) >= timestamp(startAt), '終了は開始以降にしてください。');
      if (p.kind === 'dutyStart' || p.kind === 'dutyEnd') requireValue(!t.actuals.some(a => a.kind === p.kind), '勤務開始・終了は既に記録されています。');
      t.actuals.push({ id: cmd.operationId, kind: p.kind as Actual['kind'], place: String(p.place), startAt, endAt, notes: String(p.notes ?? ''), actor: actor.name, receivedAt: now }); break;
    }
    case 'close': {
      requireValue(manager && current && progress(t).complete, '最新指示の会社・通話・本人記録・端末保存が揃っていません。');
      requireValue(!t.requests.some(r => r.status === 'submitted'), '未処理の変更申請があります。');
      const start = t.actuals.find(a => a.kind === 'dutyStart'), end = t.actuals.find(a => a.kind === 'dutyEnd');
      requireValue(start && end && timestamp(end.endAt) > timestamp(start.startAt), '勤務開始・終了の実績を確認してください。');
      requireValue(p.actualsReviewed === true, '最終実績の確認が必要です。');
      t.closedAt = end.endAt; t.retainUntil = retentionDeadline(end.endAt, 1); t.policyRetainUntil = retentionDeadline(end.endAt, 3); t.status = 'closed'; break;
    }
  }
  t.revision++; t.audit.push({ id: cmd.operationId, action: cmd.action, actor: actor.name, actorId: actor.id, fingerprint: commandHash(cmd), at: now }); return t;
}
export function commandHash(cmd: Command) {
  const canonical = (v: unknown): unknown => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, val]) => [k, canonical(val)])) : v;
  const { expectedRevision: _, ...semantic } = cmd;
  return bytesToHex(sha256(JSON.stringify(canonical(semantic))));
}
export function difference(previous: Plan | undefined, next: Plan): { label: string; before: string; after: string }[] {
  const labels: Partial<Record<keyof Plan, string>> = { vehicle: '車両', crew: '交替要員', startPlace: '出庫地点', startAt: '出庫日時', endPlace: '帰庫地点', endAt: '帰庫日時', dutyStart: '勤務開始', dutyEnd: '勤務終了', route: '経路', cautions: '注意箇所', exchange: '交替地点', safety: '安全事項', fallback: '未確定時の行動', nextContact: '次回連絡', officePhone: '会社連絡先', returnProvisional: '帰庫の確定度', stops: '行程・休憩・休息' };
  return Object.entries(labels).filter(([k]) => JSON.stringify(previous?.[k as keyof Plan]) !== JSON.stringify(next[k as keyof Plan])).map(([k, label]) => ({ label: label!, before: previous ? stringifyField(previous[k as keyof Plan]) : '初版', after: stringifyField(next[k as keyof Plan]) }));
}
function stringifyField(v: unknown) { if (Array.isArray(v)) return v.map((s: Stop) => `${kindLabels[s.kind]} ${s.place} ${s.arrive} → ${s.depart}`).join('\n'); if (typeof v === 'boolean') return v ? '暫定' : '確定'; return String(v ?? ''); }
export function csvCell(value: string) { const safe = /^[=+\-@\t\r\n]/.test(value) ? `'${value}` : value; return `"${safe.replaceAll('"', '""')}"`; }
