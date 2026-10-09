let status = '画面の保存準備中';
const listeners = new Set<() => void>();
export const shellStatus = () => status;
export const subscribeShell = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const update = (value: string) => { status = value; listeners.forEach(listener => listener()); };
export async function prepareShell() {
  if (!import.meta.env.PROD) { update('開発モード：画面のオフライン保存は本番ビルドで確認してください。'); return; }
  if (!('serviceWorker' in navigator)) { update('このブラウザーは画面のオフライン保存に対応していません。'); return; }
  try {
    const registration = await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`);
    const installing = registration.installing;
    installing?.addEventListener('statechange', () => {
      if (installing.state === 'redundant' && !registration.active) update('画面の保存に失敗しました。接続中に再読み込みしてください。');
    });
    await navigator.serviceWorker.ready;
    update('画面のオフライン保存は準備済み。指示書は別途「この端末に保存」してください。');
  } catch { update('画面の保存に失敗しました。このブラウザーで通信停止時の再表示は利用できません。'); }
}
