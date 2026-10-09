import municipalityData from './data/municipalities.json';
import restAreaData from './data/rest-areas.json';
export const municipalities: Record<string, string[]> = municipalityData;
export const prefectures = Object.keys(municipalities);
export const restAreas = restAreaData;
export const roads = [...new Set(restAreas.map(a => a.road))].sort((a,b) => a.localeCompare(b,'ja'));
export const areaLabel = (a: typeof restAreas[number]) => `${a.name}（${a.direction}）`;
export const areaPlace = (a: typeof restAreas[number]) => `${a.road} / ${areaLabel(a)}`;
export function parsePlace(value: string) {
  const area = restAreas.find(a => value === areaPlace(a) || value.startsWith(areaPlace(a) + ' '));
  const road = area?.road ?? roads.find(r => value.startsWith(r + ' / ')) ?? '';
  const pref = prefectures.find(p => value.startsWith(p)) ?? '';
  const city = pref ? [...municipalities[pref]].sort((a,b)=>b.length-a.length).find(c => value.startsWith(pref + c)) ?? '' : '';
  return { pref, city, road, areaId: area?.id ?? '' };
}

