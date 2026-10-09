import { describe, it, expect } from 'vitest';
import { nationalRoadNumbers, nationalRoadGroups, regionalRoadGroups } from '../src/routeRoads';
import { roads } from '../src/locations';

describe('route road candidates', () => {
  it('contains all 459 national road numbers and excludes abolished numbers', () => {
    expect(nationalRoadNumbers).toHaveLength(459);
    expect(nationalRoadNumbers[0]).toBe(1);
    expect(nationalRoadNumbers.at(-1)).toBe(507);
    for (const n of [58, 101, 108, 112, 213, 217, 246, 357, 507]) expect(nationalRoadNumbers).toContain(n);
    for (const n of [59, 100, 109, 110, 111, 214, 215, 216]) expect(nationalRoadNumbers).not.toContain(n);
    expect(nationalRoadGroups.flatMap(g => g.roads)).toEqual(nationalRoadNumbers.map(n => `国道${n}号`));
  });
  it('keeps every existing named road once, in north-to-south regional groups', () => {
    expect(regionalRoadGroups.map(g => g.region)).toEqual(['北海道', '東北', '関東', '北陸・甲信越', '東海', '近畿', '中国', '四国', '九州', '沖縄']);
    const names = regionalRoadGroups.flatMap(g => g.roads);
    expect(new Set(names).size).toBe(names.length);
    const existing = roads.flatMap(r => r.split(';').map(s => s.trim())).filter(s => s && !/^国道\d+号$/.test(s));
    expect(new Set(names)).toEqual(new Set(existing));
    expect(regionalRoadGroups[0].roads).toContain('道央自動車道');
    expect(regionalRoadGroups[8].roads).toContain('九州自動車道');
    expect(regionalRoadGroups[9].roads).toContain('沖縄自動車道');
  });
});

