import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

test('PostgreSQL migration, role isolation, atomic publication, immutable versions and retention', async t => {
  const db = new PGlite();
  await db.exec(`create schema auth; create table auth.users(id uuid primary key);
    create role anon; create role authenticated;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to anon,authenticated; grant execute on function auth.uid() to anon,authenticated;`);
  await db.exec(await readFile(new URL('../supabase/migrations/202610090001_core.sql', import.meta.url), 'utf8'));
  const org = randomUUID(), depot = randomUUID(), otherDepot = randomUUID();
  const manager = randomUUID(), driver = randomUUID(), anotherDriver = randomUUID(), dispatcher = randomUUID(), admin = randomUUID(), stranger = randomUUID();
  await db.query('insert into organizations values($1,$2)', [org, 'テスト会社']);
  await db.query('insert into depots values($1,$2,$3),($4,$2,$5)', [depot, org, '営業所1', otherDepot, '営業所2']);
  for (const [id, role, dep] of [[manager,'manager',depot],[driver,'driver',depot],[anotherDriver,'driver',depot],[dispatcher,'dispatcher',depot],[admin,'admin',depot],[stranger,'manager',otherDepot]]) {
    await db.query('insert into auth.users values($1)', [id]);
    await db.query('insert into memberships(user_id,organization_id,depot_id,display_name,role) values($1,$2,$3,$4,$5)', [id,org,dep,role+' テスト',role]);
  }
  const setActor = async id => { await db.exec('reset role'); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id ?? '']); await db.exec(`set role ${id ? 'authenticated' : 'anon'}`); };
  const plan = { driverName: '偽装した氏名', crew: '', vehicle: 'テスト 0000', startPlace: '東京', startAt:'2026-01-01T06:00', endPlace:'東京', endAt:'2026-01-02T20:00', dutyStart:'2026-01-01T05:30', dutyEnd:'2026-01-02T20:30', returnProvisional:true, route:'東京→名古屋→東京', cautions:'制限を確認', exchange:'なし', safety:'休息と勤務記録を確認', fallback:'指定待機場所で連絡', nextContact:'2026-01-02T08:00', officePhone:'', stops:[
    {id:'1',kind:'pickup',place:'積地',arrive:'2026-01-01T07:00',depart:'2026-01-01T08:00',notes:''},
    {id:'2',kind:'break',place:'SA',arrive:'2026-01-01T10:00',depart:'2026-01-01T10:30',notes:''},
    {id:'3',kind:'rest',place:'宿泊地',arrive:'2026-01-01T18:00',depart:'2026-01-02T05:00',notes:''}
  ]};
  const tripId = randomUUID(); let doc;
  const make = (action, payload, revision = doc?.revision ?? 0) => ({ operationId:randomUUID(),tripId,expectedRevision:revision,action,payload });
  const execute = async cmd => (await db.query('select apply_operation($1::jsonb) result',[JSON.stringify(cmd)])).rows[0].result;
  await setActor(manager); const create = make('create',{depotId:depot,driverId:driver,plan}); doc = await execute(create);
  await t.test('driver display name comes from membership, never the request', () => assert.equal(doc.plan.driverName,'driver テスト'));
  await t.test('idempotent create returns the same result and rejects changed content', async () => {
    assert.deepEqual(await execute(create),doc);
    await assert.rejects(execute({...create,payload:{...create.payload,driverId:anotherDriver}}), /異なる内容/);
  });
  const publish = () => make('publish',{baseVersion:doc.versions.length,draftRevision:doc.draftRevision,reason:'安全確認',safetyReviewed:true,requestIds:[]});
  await t.test('drivers, dispatchers and administrators cannot issue through RPC', async () => {
    for (const id of [driver,dispatcher,admin]) { await setActor(id); await assert.rejects(execute(publish()), /発行|権限/); }
    await setActor(manager);
  });
  await t.test('anonymous reads and direct updates are denied', async () => {
    await setActor(null); await assert.rejects(db.query('select * from trips'),/permission/);
    await assert.rejects(execute(publish()), /permission/);
    await setActor(driver); await assert.rejects(db.query("update trips set revision = 900 where id=$1",[tripId]), /permission/);
    await setActor(manager);
  });
  await t.test('publication snapshot, company copy and audit commit atomically', async () => {
    doc = await execute(publish()); assert.equal(doc.versions.length,1);
    const copies = await db.query('select count(*)::int n from company_copies'); assert.equal(copies.rows[0].n,1);
    const versions = await db.query('select count(*)::int n from instruction_versions'); assert.equal(versions.rows[0].n,1);
    assert.equal(doc.audit.at(-1).action,'publish');
  });
  await t.test('other drivers and other depots cannot read', async () => {
    for (const id of [anotherDriver,stranger]) { await setActor(id); assert.equal((await db.query('select * from trips')).rows.length,0); await assert.rejects(execute(make('actual',{kind:'drive',place:'X',startAt:'2026-01-01T07:00',endAt:'2026-01-01T08:00'})),/権限/); }
    await setActor(manager);
  });
  await t.test('stale revisions and edited drafts cannot be published', async () => {
    await assert.rejects(execute(make('publish',publish().payload,0)), /更新/);
    await assert.rejects(execute(make('publish',{...publish().payload,draftRevision:50})), /下書き/);
    doc = await execute(make('savePlan',{baseVersion:1,plan:{...doc.plan,cautions:'変更した注意箇所'}}));
    doc = await execute(publish()); assert.equal(doc.versions.length,2);
    assert.equal(doc.versions[0].snapshot.cautions,'制限を確認');
    assert.notEqual(doc.versions[0].hash,doc.versions[1].hash);
  });
  const v2 = doc.versions[1].id;
  await t.test('old-version acknowledgment and future records are rejected', async () => {
    await setActor(driver);
    await assert.rejects(execute(make('ack',{versionId:doc.versions[0].id,actualAt:new Date().toISOString(),notes:'旧版'})),/最新/);
    await assert.rejects(execute(make('ack',{versionId:v2,actualAt:'2099-01-01T00:00',notes:'未来'})),/実日時/);
    await setActor(manager);
    await assert.rejects(execute(make('voice',{versionId:v2,actualAt:new Date().toISOString(),method:'line',recipient:'driver',notes:'既読'})),/方法/);
    await assert.rejects(execute(make('voice',{versionId:v2,actualAt:new Date().toISOString(),recipient:'driver',notes:'方法なし'})),/方法/);
  });
  await t.test('confirmed records are version-bound and replay-safe', async () => {
    const at = () => new Date().toISOString();
    doc = await execute(make('voice',{versionId:v2,actualAt:at(),method:'phone',recipient:'driver',notes:'変更指示'}));
    await setActor(driver); const ack = make('ack',{versionId:v2,actualAt:at(),notes:'変更記録'}); doc = await execute(ack);
    assert.deepEqual(await execute(ack),doc); assert.equal(doc.driverRecords.length,1);
    await assert.rejects(execute({...ack,payload:{...ack.payload,notes:'別内容'}}),/異なる内容/);
    doc = await execute(make('deviceSaved',{versionId:v2,savedAt:at(),deviceId:'device-1'}));
    doc = await execute(make('actual',{kind:'dutyStart',place:'会社',startAt:'2026-01-01T05:30',endAt:'2026-01-01T05:30',notes:''}));
    doc = await execute(make('actual',{kind:'dutyEnd',place:'会社',startAt:'2026-01-02T20:30',endAt:'2026-01-02T20:30',notes:''}));
    await setActor(manager); doc = await execute(make('close',{actualsReviewed:true}));
    assert.equal(doc.status,'closed'); assert.match(doc.retainUntil,/2027-01-02/); assert.match(doc.policyRetainUntil,/2029-01-02/);
  });
  await t.test('immutable archives and retention protect against direct and privileged writes', async () => {
    await assert.rejects(execute(make('savePlan',{plan:doc.plan,baseVersion:2})),/保存確定/);
    await assert.rejects(db.query('delete from trips where id=$1',[tripId]),/permission/);
    await db.exec('reset role');
    await assert.rejects(db.query('delete from trips where id=$1',[tripId]),/保存期限/);
    await assert.rejects(db.exec("update instruction_versions set snapshot='{}'"),/上書き/);
    await assert.rejects(db.exec('delete from audit_events'),/削除/);
  });
  await t.test('invalid plans roll back without orphan copies, versions or audit events', async () => {
    await setActor(manager);
    const newId = randomUUID(); const created = await execute({...make('create',{depotId:depot,driverId:driver,plan:{...plan,dutyEnd:'2026-01-08T05:31'}}),tripId:newId});
    const before = (await db.query('select count(*)::int n from instruction_versions')).rows[0].n;
    await assert.rejects(execute({...make('publish',{baseVersion:0,draftRevision:0,reason:'超過',safetyReviewed:true,requestIds:[]},created.revision),tripId:newId}),/144/);
    assert.equal((await db.query('select count(*)::int n from instruction_versions')).rows[0].n,before);
    assert.equal((await db.query('select document from trips where id=$1',[newId])).rows[0].document.versions.length,0);
  });
  await db.close();
});
