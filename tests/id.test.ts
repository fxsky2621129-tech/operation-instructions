import { expect, it, vi } from 'vitest';
import { newId } from '../src/id';
it('creates distinct version 4 IDs when randomUUID is unavailable on the Wi-Fi demo', () => {
  vi.stubGlobal('crypto', { getRandomValues: crypto.getRandomValues.bind(crypto) });
  try {
    const a = newId(), b = newId();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/); expect(a).not.toBe(b);
  } finally { vi.unstubAllGlobals(); }
});
