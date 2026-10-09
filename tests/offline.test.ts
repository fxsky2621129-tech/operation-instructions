import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { clearUser, read, saveCarry, update, write } from '../src/offline';
import { sampleStore } from '../src/seed';

describe('durable and account-scoped offline storage', () => {
  it('keeps a complete snapshot, all versions, and a saved timestamp', async () => {
    const trip = sampleStore().trips[0]; const at = await saveCarry('person-A', trip);
    const cached = await read<{trip: typeof trip; savedAt: string}>(`person-A:carry:${trip.id}`);
    expect(cached?.trip).toEqual(trip); expect(cached?.savedAt).toBe(at);
    expect(await read(`person-B:carry:${trip.id}`)).toBeUndefined();
  });
  it('serializes simultaneous mutations without losing either result', async () => {
    await write('counter', { n: 0 });
    await Promise.all(Array.from({length: 10}, () => update<{n:number}>('counter', v => ({n: v!.n + 1}))));
    expect(await read('counter')).toEqual({n:10});
  });
  it('keeps the stored state intact when compare-and-swap rejects a conflict', async () => {
    await write('cas', { revision: 4, payload: 'latest' });
    await expect(update<{ revision: number; payload: string }>('cas', v => { if (v!.revision !== 3) throw Error('conflict'); return {revision:5,payload:'old edit'}; })).rejects.toThrow('conflict');
    expect(await read('cas')).toEqual({revision:4,payload:'latest'});
  });
  it('clears only the signed-out user including their authentication cache', async () => {
    await write('person-A:outbox', ['pending']); await write('person-B:outbox', ['keep']); await write('auth:user-A', ['membership']);
    await clearUser('person-A'); await clearUser('auth:user-A');
    expect(await read('person-A:outbox')).toBeUndefined(); expect(await read('auth:user-A')).toBeUndefined();
    expect(await read('person-B:outbox')).toEqual(['keep']);
  });
});
