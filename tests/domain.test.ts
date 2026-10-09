import { describe, expect, it } from 'vitest';
import { addYears, applyCommand, canRead, commandHash, csvCell, duration, latest, progress, retentionDeadline, timestamp, validatePlan, type Command, type Trip } from '../src/domain';
import { demoMembers, sampleStore } from '../src/seed';

const manager = demoMembers[0], driver = demoMembers[1], dispatcher = demoMembers[2];
const command = (t: Trip, action: Command['action'], payload: Command['payload'] = {}): Command => ({ tripId: t.id, operationId: crypto.randomUUID(), expectedRevision: t.revision, action, payload });
const apply = (t: Trip, action: Command['action'], payload: Command['payload'], actor = manager) => applyCommand(t, command(t, action, payload), actor, demoMembers, new Date(Date.now() + 60000).toISOString());

describe('publication and records', () => {
  it('requires accepted loads to be reflected in the issued itinerary and preserves their source', () => {
    let t = sampleStore().trips[0];
    const pickup = t.plan.stops[0], delivery = t.plan.stops[2];
    const load = { name: '追加荷物', pickup: pickup.place + '変更', pickupAt: pickup.arrive, delivery: delivery.place, deliveryAt: delivery.arrive, weight: '1t', quantity: '1', source: '配車担当', receivedAt: new Date().toISOString(), handling: '荷役確認', contact: '' };
    t = apply(t, 'submitRequest', { baseVersion: 1, reason: '積地変更', load }, driver);
    const requestId = t.requests[0].id;
    const publication = { baseVersion: 1, draftRevision: 0, reason: '申請反映', safetyReviewed: true, requestIds: [requestId] };
    expect(() => apply(t, 'publish', publication)).toThrow('下書きへ反映');
    t = apply(t, 'savePlan', { baseVersion: 1, plan: { ...t.plan, stops: t.plan.stops.map(s => s.id === pickup.id ? { ...s, place: load.pickup } : s) } });
    t = apply(t, 'publish', { ...publication, draftRevision: 1 });
    expect(t.requests[0].status).toBe('issued'); expect(t.requests[0].versionId).toBe(latest(t)!.id);
    expect(t.requests[0].load.source).toBe('配車担当'); expect(t.versions[0].snapshot.stops[0].place).toBe(pickup.place);
  });
  it('rejects direct issue from a driver, dispatcher, or system administrator', () => {
    const t = sampleStore().trips[0]; const payload = { baseVersion: 1, draftRevision: 0, reason: '修正', safetyReviewed: true };
    for (const actor of [driver, dispatcher, { ...manager, role: 'admin' as const }]) expect(() => apply(t, 'publish', payload, actor)).toThrow();
  });
  it('keeps the first snapshot and company copy unchanged after draft edits and publication', () => {
    const t = sampleStore().trips[0], snapshot = JSON.stringify(t.versions[0]);
    const draft = apply(t, 'savePlan', { plan: { ...t.plan, cautions: '注意事項を追加' }, baseVersion: 1 });
    const issued = apply(draft, 'publish', { baseVersion: 1, draftRevision: 1, reason: '注意事項の変更', safetyReviewed: true });
    expect(JSON.stringify(issued.versions[0])).toBe(snapshot); expect(issued.versions).toHaveLength(2);
    expect(issued.versions[1].snapshot).toEqual(issued.versions[1].companyCopy.snapshot);
    expect(issued.versions[0].hash).not.toEqual(issued.versions[1].hash);
  });
  it('rejects stale trip and stale draft revision independently', () => {
    const t = sampleStore().trips[0];
    expect(() => applyCommand(t, { ...command(t, 'savePlan', { plan: t.plan, baseVersion: 1 }), expectedRevision: t.revision - 1 }, manager, demoMembers, new Date().toISOString())).toThrow('更新');
    expect(() => apply(t, 'publish', { baseVersion: 1, draftRevision: 50, reason: '修正', safetyReviewed: true })).toThrow('下書き');
    expect(() => apply(t, 'publish', { baseVersion: 0, draftRevision: 0, reason: '修正', safetyReviewed: true })).toThrow('版');
  });
  it('never transfers old acknowledgments to a newer version', () => {
    let t = sampleStore().trips[0]; const v1 = latest(t)!; const at = new Date().toISOString();
    t = apply(t, 'ack', { versionId: v1.id, notes: '初版確認', actualAt: at }, driver);
    t = apply(t, 'publish', { baseVersion: 1, draftRevision: 0, reason: '次版', safetyReviewed: true });
    expect(progress(t).driver).toBe(false);
    expect(() => apply(t, 'ack', { versionId: v1.id, notes: '旧版', actualAt: at }, driver)).toThrow('最新');
  });
  it('accepts actual record ordering and requires voice, driver, and device records to complete', () => {
    let t = sampleStore().trips[0]; const id = latest(t)!.id; const at = new Date().toISOString();
    t = apply(t, 'ack', { versionId: id, notes: '計画を確認', actualAt: at }, driver); expect(progress(t).complete).toBe(false);
    t = apply(t, 'deviceSaved', { versionId: id, deviceId: 'phone-1', savedAt: at }, driver); expect(progress(t).complete).toBe(false);
    t = apply(t, 'voice', { versionId: id, method: 'phone', notes: '直接説明', recipient: driver.name, actualAt: at }); expect(progress(t).complete).toBe(true);
    expect(() => apply(t, 'ack', { versionId: id, notes: '重複', actualAt: at }, driver)).toThrow('記録済み');
  });
  it('rejects future or pre-issue communication times and a text-only method', () => {
    const t = sampleStore().trips[0]; const payload = { versionId: latest(t)!.id, method: 'phone', notes: '説明', recipient: driver.name, actualAt: '2099-01-01T00:00' };
    expect(() => apply(t, 'voice', payload)).toThrow('実日時');
    expect(() => apply(t, 'voice', { ...payload, actualAt: '2020-01-01T00:00' })).toThrow('発行日時');
    expect(() => apply(t, 'voice', { ...payload, method: 'line', actualAt: new Date().toISOString() })).toThrow('通話方法');
  });
});
describe('time, scope and exports', () => {
  it('parses local times in JST and rejects impossible calendar dates', () => {
    expect(timestamp('2026-10-09T09:00')).toBe(timestamp('2026-10-09T00:00Z'));
    expect(timestamp('2026-02-30T09:00')).toBeNaN(); expect(timestamp('2026-13-01T00:00')).toBeNaN();
  });
  it('handles 144h boundaries, includes the whole duty interval, and does not subtract rest', () => {
    const p = sampleStore().trips[0].plan;
    p.dutyEnd = new Date(timestamp(p.dutyStart) + 144 * 3600000).toISOString(); expect(duration(p)).toBe(144); expect(validatePlan(p).some(x => x.includes('144'))).toBe(false);
    p.dutyEnd = new Date(timestamp(p.dutyStart) + 144 * 3600000 + 60000).toISOString(); expect(validatePlan(p).some(x => x.includes('144'))).toBe(true);
  });
  it('rejects empty safety fields, a backward stop and missing rest', () => {
    const p = sampleStore().trips[0].plan; p.cautions = ''; p.stops[0].depart = '2000-01-01T00:00'; p.stops = p.stops.filter(s => s.kind !== 'rest');
    expect(validatePlan(p).length).toBeGreaterThanOrEqual(3);
  });
  it('isolates other drivers and depots', () => {
    const t = sampleStore().trips[0]; expect(canRead(t, driver)).toBe(true);
    expect(canRead(t, { ...driver, id: crypto.randomUUID() })).toBe(false); expect(canRead(t, { ...manager, depotId: 'another-depot' })).toBe(false);
  });
  it('uses calendar years, preserving a full minimum year around leap day', () => {
    expect(addYears('2024-02-29T12:00Z', 1)).toBe('2025-02-28T12:00:00.000Z');
    expect(addYears('2025-03-01T12:00Z', 1)).toBe('2026-03-01T12:00:00.000Z');
    expect(retentionDeadline('2024-02-29T12:00+09:00',1)).toBe('2025-02-28T15:00:00.000Z');
    expect(retentionDeadline('2026-10-09T12:00+09:00',1)).toBe('2027-10-09T15:00:00.000Z');
  });
  it('neutralizes spreadsheet formula cells', () => { expect(csvCell('=HYPERLINK("url")')).toBe('"\'=HYPERLINK(""url"")"'); expect(csvCell('@SUM(1)')).toBe('"\'@SUM(1)"'); });
  it('idempotency fingerprint changes with content but not a rechecked revision', () => {
    const t = sampleStore().trips[0], c = command(t, 'ack', { notes: 'a', versionId: latest(t)!.id });
    expect(commandHash(c)).toBe(commandHash({ ...c, expectedRevision: c.expectedRevision + 1 }));
    expect(commandHash(c)).not.toBe(commandHash({ ...c, payload: { ...c.payload, notes: 'b' } }));
  });
});
