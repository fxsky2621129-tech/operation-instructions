import { useState } from 'react';
import { nationalRoadGroups, regionalRoadGroups } from './routeRoads';

export function RoutePicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [selected, setSelected] = useState('');
  const next = value.trim() ? `${value.trimEnd()} → ${selected}` : selected;
  return <fieldset className="place-picker"><legend>経路・主な道路</legend>
    <label className="field"><span>経路に追加する道路</span><select value={selected} onChange={e => setSelected(e.target.value)}>
      <option value="">道路を選択してください</option>
      {regionalRoadGroups.map(group => <optgroup key={group.region} label={`高速道路・有料道路など：${group.region}`}>{group.roads.map(road => <option key={road}>{road}</option>)}</optgroup>)}
      {nationalRoadGroups.map(group => <optgroup key={group.label} label={group.label}>{group.roads.map(road => <option key={road}>{road}</option>)}</optgroup>)}
      <optgroup label="一般道"><option>一般道</option></optgroup>
    </select></label>
    <div className="button-row"><button type="button" disabled={!selected || next.length > 3000} onClick={() => { onChange(next); setSelected(''); }}>＋ 経路に追加</button></div>
    {selected && next.length > 3000 && <p role="status">経路は3,000文字以内で入力してください。</p>}
    <p className="muted">通る順に道路を選び「経路に追加」を押してください。登録済みの経路の末尾に追加します。</p>
    <label className="field"><span>経路・主な道路（確認・直接編集）</span><textarea value={value} onChange={e => onChange(e.target.value)} maxLength={3000} rows={3}/></label>
    <small className="muted">高速道路などは北海道から九州・沖縄への地域順、国道は番号順です。県道番号、IC名、方向、候補にない道路は直接入力できます。</small>
  </fieldset>;
}

