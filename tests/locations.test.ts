import {describe,it,expect} from 'vitest';
import {areaPlace,municipalities,parsePlace,prefectures,restAreas} from '../src/locations';
describe('nationwide place selections',()=>{
  it('includes all prefectures and municipality/ward candidates without duplicates',()=>{
    expect(prefectures).toHaveLength(47);
    expect(municipalities['東京都']).toContain('新宿区');
    expect(municipalities['北海道']).toContain('札幌市中央区');
    expect(municipalities['沖縄県']).toContain('那覇市');
    for(const rows of Object.values(municipalities)) expect(new Set(rows).size).toBe(rows.length);
  });
  it('preserves detailed addresses and clears stale dependent city selection',()=>{
    expect(parsePlace('東京都新宿区西新宿2-8-1').city).toBe('新宿区');
    expect(parsePlace('大阪府').city).toBe('');
    expect(parsePlace('会社指定の休息施設（架空）')).toEqual({pref:'',city:'',road:'',areaId:''});
  });
  it('keeps the route and direction in the saved place, with distinct IDs',()=>{
    expect(restAreas.length).toBeGreaterThan(900);
    expect(new Set(restAreas.map(a=>a.id)).size).toBe(restAreas.length);
    const areas=restAreas.filter(a=>a.name.includes('海老名') && a.road==='東名高速道路');
    expect(areas.some(a=>a.direction==='上り')).toBe(true);
    expect(areas.some(a=>a.direction==='下り')).toBe(true);
    for(const a of areas) expect(parsePlace(areaPlace(a)+' 大型車駐車場').areaId).toBe(a.id);
    expect(parsePlace('道央自動車道 / ').areaId).toBe('');
    expect(restAreas.some(a=>a.name.includes('輪厚') && a.road==='道央自動車道')).toBe(true);
    expect(restAreas.some(a=>a.name.includes('伊芸') && a.road==='沖縄自動車道')).toBe(true);
  });
});

