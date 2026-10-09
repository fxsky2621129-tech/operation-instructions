import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { applyCommand, commandHash, canRead, type Command, type Member, type Store, type Trip } from './domain';
import { read, write, update, clearUser, type Pending } from './offline';
import { sampleStore } from './seed';

const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
export const configInvalid = !!url !== !!key || !!key && (key.startsWith('sb_secret_') || (() => { try { return JSON.parse(atob(key.split('.')[1])).role === 'service_role'; } catch { return false; } })());
export const cloud: SupabaseClient | undefined = url && key && !configInvalid ? createClient(url, key) : undefined;
export const demo = !url && !key;
export class AccessError extends Error {}
const DEMO_KEY = 'demo:store';
export class Repository {
  constructor(readonly actor: Member) {}
  get scope() { return `${demo ? 'demo' : new URL(url!).host}:${this.actor.id}:${this.actor.depotId}`; }
  async load(): Promise<Store> {
    if (demo) { const data = await read<Store>(DEMO_KEY); if (data) return data; const seed = sampleStore(); await update<Store>(DEMO_KEY, existing => existing ?? seed); return (await read<Store>(DEMO_KEY))!; }
    if (!navigator.onLine) { const cached = await read<Store>(`${this.scope}:store`); if (!cached) throw new Error('保存版がありません。オンラインで読み込んでください。'); return cached; }
    // Authorization is validated remotely on every online load, not inferred from local session roles.
    const { error: authError } = await cloud!.auth.getUser(); if (authError) { if (authError.status === 401 || authError.status === 403) throw new AccessError('認証が失効しています。再ログインしてください。'); throw authError; }
    const [trips, members] = await Promise.all([cloud!.from('trips').select('document').eq('depot_id', this.actor.depotId), cloud!.from('memberships').select('*').eq('depot_id', this.actor.depotId)]);
    if (trips.error) throw trips.error; if (members.error) throw members.error;
    const data: Store = { trips: trips.data.map(r => r.document as Trip), members: members.data.filter(r => Date.parse(r.valid_from) <= Date.now() && (!r.valid_until || Date.parse(r.valid_until) > Date.now())).map(mapMember) };
    if (!data.members.some(m => m.id === this.actor.id && m.role === this.actor.role)) throw new AccessError('所属・権限を再確認してください。');
    await write(`${this.scope}:store`, data); return data;
  }
  async send(cmd: Command): Promise<Trip> {
    if (!navigator.onLine) throw new Error('オフラインです。変更操作は未送信として保存してください。');
    if (demo) {
      const store = await update<Store>(DEMO_KEY, value => {
        const data = value ?? sampleStore(); const original = data.trips.find(t => t.id === cmd.tripId);
        const remembered = data.trips.flatMap(t => t.audit).find(a => a.id === cmd.operationId && a.actorId === this.actor.id);
        if (remembered) {
          if (!original || !canRead(original, this.actor) || remembered.fingerprint !== commandHash(cmd)) throw new Error('同じ操作IDで異なる内容は送信できません。');
          return data;
        }
        const trip = applyCommand(original, cmd, this.actor, data.members, new Date().toISOString());
        return { ...data, trips: [...data.trips.filter(t => t.id !== trip.id), trip] };
      }); return store.trips.find(t => t.id === cmd.tripId)!;
    }
    const { data, error } = await cloud!.rpc('apply_operation', { operation: cmd }); if (error) throw new Error(error.message); return data as Trip;
  }
  async pending() { return ((await read<Pending[]>(`${this.scope}:outbox`)) ?? []).filter(p => p.status !== 'cancelled'); }
  async cancel(operationId: string) {
    await update<Pending[]>(`${this.scope}:outbox`, q => (q ?? []).map(p => p.command.operationId === operationId ? { ...p, status: 'cancelled', message: '利用者が内容を確認して取り下げ。記録は端末に保持。' } : p));
  }
  async queue(command: Command) {
    if (!['submitRequest', 'ack', 'actual', 'deviceSaved'].includes(command.action)) throw new Error('この操作はオンラインで行ってください。');
    await update<Pending[]>(`${this.scope}:outbox`, queue => [...(queue ?? []).filter(p => p.command.operationId !== command.operationId), { command, status: 'pending', queuedAt: new Date().toISOString() }]);
  }
  async sync() {
    for (const item of await this.pending()) {
      if (item.status === 'conflict') continue;
      try {
        // Never silently rebase a request or acknowledgment onto a different version.
        await this.send(item.command);
        await update<Pending[]>(`${this.scope}:outbox`, q => (q ?? []).filter(p => p.command.operationId !== item.command.operationId));
      } catch (error) {
        if (!navigator.onLine || error instanceof TypeError) break;
        await update<Pending[]>(`${this.scope}:outbox`, q => (q ?? []).map(p => p.command.operationId === item.command.operationId ? { ...p, status: 'conflict', message: (error as Error).message } : p));
      }
    }
  }
  async retry(operationId: string, revision: number) {
    await update<Pending[]>(`${this.scope}:outbox`, q => (q ?? []).map(p => p.command.operationId === operationId ? { ...p, command: { ...p.command, expectedRevision: revision }, status: 'pending', message: undefined } : p));
    await this.sync();
  }
  async signOut() { await clearUser(this.scope); if (cloud) await cloud.auth.signOut(); }
}
export function mapMember(row: Record<string, unknown>): Member { return { id: String(row.user_id), name: String(row.display_name), orgId: String(row.organization_id), depotId: String(row.depot_id), role: row.role as Member['role'] }; }
export async function login(email: string, password: string) { const { error } = await cloud!.auth.signInWithPassword({ email, password }); if (error) throw new Error('ログインできません。メールアドレスとパスワードを確認してください。'); }
export async function activeMemberships(): Promise<Member[]> {
  const { data: { session } } = await cloud!.auth.getSession(); if (!session) return [];
  if (!navigator.onLine) return (await read<Member[]>(`auth:${session.user.id}`)) ?? [];
  const { error: authError } = await cloud!.auth.getUser(); if (authError) { await cloud!.auth.signOut(); return []; }
  const { data, error } = await cloud!.from('memberships').select('*').eq('user_id', session.user.id); if (error) throw error;
  const active = data.filter(r => Date.parse(r.valid_from) <= Date.now() && (!r.valid_until || Date.parse(r.valid_until) > Date.now())).map(mapMember);
  await write(`auth:${session.user.id}`, active); return active;
}
