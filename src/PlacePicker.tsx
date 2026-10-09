import { useState } from 'react';
import { areaLabel, areaPlace, municipalities, parsePlace, prefectures, restAreas, roads } from './locations';

export function PlacePicker({label,value,onChange}: {label:string;value:string;onChange:(value:string)=>void}) {
  const selected = parsePlace(value);
  const [mode,setMode] = useState(selected.road ? 'highway' : 'municipality');
  const areas = restAreas.filter(a=>a.road===selected.road);
  return <fieldset className="place-picker"><legend>{label}</legend>
    <label className="field"><span>{label}の選択方法</span><select value={mode} onChange={e=>setMode(e.target.value)}><option value="municipality">都道府県・市区町村</option><option value="highway">全国の高速道路・SA/PA</option></select></label>
    {mode==='municipality' ? <div className="form-grid">
      <label className="field"><span>{label}の都道府県</span><select value={selected.pref} onChange={e=>onChange(e.target.value)}><option value="">選択してください</option>{prefectures.map(p=><option key={p}>{p}</option>)}</select></label>
      <label className="field"><span>{label}の市区町村</span><select disabled={!selected.pref} value={selected.city} onChange={e=>onChange(selected.pref+e.target.value)}><option value="">選択してください</option>{(municipalities[selected.pref]??[]).map(c=><option key={c}>{c}</option>)}</select></label>
    </div> : <div className="form-grid">
      <label className="field"><span>{label}の高速道路・路線</span><select value={selected.road} onChange={e=>onChange(e.target.value ? e.target.value+' / ' : '')}><option value="">路線を選択してください</option>{roads.map(r=><option key={r}>{r}</option>)}</select></label>
      <label className="field"><span>{label}のSA・PA（方向）</span><select disabled={!selected.road} value={selected.areaId} onChange={e=>{const a=areas.find(x=>x.id===e.target.value);onChange(a ? areaPlace(a) : selected.road+' / ');}}><option value="">SA・PAを選択してください</option>{areas.map(a=><option key={a.id} value={a.id}>{areaLabel(a)}</option>)}</select></label>
    </div>}
    <label className="field"><span>{label}（住所・施設名の追記／直接入力）</span><input value={value} maxLength={1000} onChange={e=>onChange(e.target.value)} /></label>
    <small className="muted">選択した地点に番地・会社名などを追記できます。別の候補を選ぶと地点全体が置き換わります。</small>
  </fieldset>;
}

