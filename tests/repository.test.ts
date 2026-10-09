import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Repository } from '../src/repository';
import { demoMembers, sampleStore } from '../src/seed';
import { latest, type Command } from '../src/domain';
import { clearUser, read, write, type Pending } from '../src/offline';

beforeEach(async () => { vi.stubGlobal('navigator', {onLine: true}); await clearUser('demo'); await write('demo:store',sampleStore()); });
const manager = new Repository(demoMembers[0]), driver = new Repository(demoMembers[1]);
async function ackCommand(): Promise<Command> { const t=(await driver.load()).trips[0]; return {operationId:crypto.randomUUID(),tripId:t.id,expectedRevision:t.revision,action:'ack',payload:{versionId:latest(t)!.id,actualAt:new Date().toISOString(),notes:'初版を確認'}}; }
describe('resends, conflicting requests and durable outbox', () => {
  it('is idempotent but rejects different content using the same operation ID', async () => {
    const c=await ackCommand(); await driver.send(c); await driver.send(c);
    expect((await driver.load()).trips[0].driverRecords).toHaveLength(1);
    await expect(driver.send({...c,payload:{...c.payload,notes:'別内容'}})).rejects.toThrow('異なる内容');
  });
  it('keeps offline acknowledgments unconfirmed until successfully synchronized', async () => {
    const c=await ackCommand(); vi.stubGlobal('navigator',{onLine:false}); await driver.queue(c);
    expect((await driver.load()).trips[0].driverRecords).toHaveLength(0);
    expect(await driver.pending()).toHaveLength(1);
    vi.stubGlobal('navigator',{onLine:true}); await driver.sync();
    expect(await driver.pending()).toHaveLength(0); expect((await driver.load()).trips[0].driverRecords).toHaveLength(1);
  });
  it('retains stale-version confirmation as a conflict and never silently rebases it', async () => {
    const c=await ackCommand(); await driver.queue(c); let t=(await manager.load()).trips[0];
    t=await manager.send({operationId:crypto.randomUUID(),tripId:t.id,expectedRevision:t.revision,action:'publish',payload:{baseVersion:1,draftRevision:0,reason:'新版',safetyReviewed:true}});
    await driver.sync(); const pending=await driver.pending(); expect(pending[0].status).toBe('conflict');
    expect(pending[0].command.payload.versionId).toBe(c.payload.versionId); expect(t.driverRecords).toHaveLength(0);
    await driver.retry(c.operationId,t.revision); expect((await driver.pending())[0].status).toBe('conflict');
    expect((await driver.load()).trips[0].driverRecords).toHaveLength(0);
  });
  it('isolates each actor queue and keeps cancelled payloads without resending', async () => {
    const c=await ackCommand(); await driver.queue(c); expect(await manager.pending()).toHaveLength(0);
    await driver.cancel(c.operationId); expect(await driver.pending()).toHaveLength(0);
    const archived=await read<Pending[]>(`${driver.scope}:outbox`); expect(archived?.[0].status).toBe('cancelled'); expect(archived?.[0].command).toEqual(c);
    await driver.sync(); expect((await driver.load()).trips[0].driverRecords).toHaveLength(0);
  });
  it('serializes simultaneous publications and rejects the losing stale operation', async () => {
    const t=(await manager.load()).trips[0]; const make=():Command=>({operationId:crypto.randomUUID(),tripId:t.id,expectedRevision:t.revision,action:'publish',payload:{baseVersion:1,draftRevision:0,reason:'同時発行',safetyReviewed:true}});
    const results=await Promise.allSettled([manager.send(make()),manager.send(make())]);
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1); expect((await manager.load()).trips[0].versions).toHaveLength(2);
  });
});
