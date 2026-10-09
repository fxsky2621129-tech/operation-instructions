import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
function harness() {
  const listeners: Record<string, (event: any) => void> = {};
  const entries = new Map<string, Response>(), fetched: string[] = [];
  let offline = false;
  const normalized = (url: string | URL | { url: string }) => typeof url === 'object' && 'url' in url ? url.url : String(url);
  const cache = {
    async put(url: string | URL, response: Response) { entries.set(String(url), response); },
    async addAll(urls: string[]) { for (const url of urls) entries.set(url, new Response('cached-asset')); },
    async match(url: string | URL | {url:string}, options?: {ignoreVary?:boolean}) { if (typeof url === 'object' && 'url' in url && url.url.endsWith('.js') && !options?.ignoreVary) return undefined; return entries.get(normalized(url)); },
  };
  const caches = { open: async () => cache, keys: async () => ['operation-shell-v1'], delete: async () => true, match: cache.match };
  const self = { location: { href: 'https://example.test/operation/sw.js' }, addEventListener: (type: string, handler: typeof listeners[string]) => { listeners[type] = handler; }, clients: { claim: async () => {} } };
  const fetch = async (request: string | URL | {url:string}) => { fetched.push(normalized(request)); if (offline) throw Error('offline'); return new Response('<html><script src="./assets/main.js"></script><link href="./assets/main.css" rel="stylesheet"></html>'); };
  runInNewContext(readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8'), {self,caches,fetch,URL});
  return { entries, fetched, offline: () => {offline=true;}, async install() { let work: Promise<void> | undefined; listeners.install({waitUntil:(p:Promise<void>) => {work=p;}}); await work; }, request(url:string,mode='navigate',method='GET') { let response:Promise<Response> | undefined; listeners.fetch({request:{url,mode,method},respondWith:(r:Promise<Response>)=>{response=r;}}); return response; } };
}
describe('offline shell and private data boundaries', () => {
  it('keeps the cached index paired with its release assets while an update waits', async () => {
    const h = harness(); await h.install(); const before = h.fetched.length;
    const response = await h.request('https://example.test/operation/');
    expect(await response!.text()).toContain('./assets/main.js'); expect(h.fetched.length).toBe(before);
  });
  it('precaches built JS/CSS and serves the shell during network failure in a subdirectory', async () => {
    const h = harness(); await h.install(); expect(h.entries.has('https://example.test/operation/assets/main.js')).toBe(true);
    h.offline(); const response = await h.request('https://example.test/operation/'); expect(await response!.text()).toContain('<html>');
    expect(await (await h.request('https://example.test/operation/assets/main.js','cors'))!.text()).toBe('cached-asset');
  });
  it('never handles authentication, private APIs, queries or other origins', async () => {
    const h = harness(); await h.install(); const before = h.fetched.length;
    expect(h.request('https://project.supabase.co/rest/v1/trips','cors')).toBeUndefined();
    expect(h.request('https://example.test/operation/api?token=private','cors')).toBeUndefined();
    expect(h.request('https://example.test/operation/','navigate','POST')).toBeUndefined();
    expect(h.fetched.length).toBe(before);
  });
});
