import groups from './data/route-road-groups.json';

export const regionalRoadGroups = groups;
// 国交省の一般国道路線番号。統合等で欠番になった番号は含めない。
export const nationalRoadNumbers = Array.from({ length: 507 }, (_, i) => i + 1)
  .filter(n => !(n >= 59 && n <= 100) && !(n >= 109 && n <= 111) && !(n >= 214 && n <= 216));
export const nationalRoadGroups = [
  { label: '国道1～58号', min: 1, max: 58 },
  { label: '国道101～199号', min: 101, max: 199 },
  { label: '国道200～299号', min: 200, max: 299 },
  { label: '国道300～399号', min: 300, max: 399 },
  { label: '国道400～507号', min: 400, max: 507 },
].map(group => ({ label: group.label, roads: nationalRoadNumbers.filter(n => n >= group.min && n <= group.max).map(n => `国道${n}号`) }));

