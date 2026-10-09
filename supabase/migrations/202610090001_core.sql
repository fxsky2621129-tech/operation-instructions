-- All operational writes use one authenticated, transactional RPC.
-- The service_role key is never needed by the browser.
create schema if not exists app_private;
revoke all on schema app_private from public;

create table public.organizations (id uuid primary key default gen_random_uuid(), name text not null);
create table public.depots (id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations, name text not null, unique(id, organization_id));
create table public.memberships (
  user_id uuid not null references auth.users, organization_id uuid not null,
  depot_id uuid not null, display_name text not null check(length(trim(display_name)) between 1 and 100),
  role text not null check(role in ('manager','driver','dispatcher','admin','auditor')),
  valid_from timestamptz not null default now(), valid_until timestamptz,
  audit_from timestamptz, audit_until timestamptz,
  primary key(user_id, depot_id),
  foreign key(depot_id, organization_id) references public.depots(id, organization_id),
  check(valid_until is null or valid_until > valid_from),
  check(role <> 'auditor' or (audit_from is not null and audit_until is not null and audit_until >= audit_from))
);
create table public.trips (
  id uuid primary key, organization_id uuid not null, depot_id uuid not null,
  driver_id uuid not null references auth.users, created_at timestamptz not null default now(),
  revision integer not null default 0, document jsonb not null,
  foreign key(depot_id, organization_id) references public.depots(id, organization_id)
);
create table public.instruction_versions (
  id uuid primary key, trip_id uuid not null references public.trips on delete restrict,
  version_number integer not null, snapshot jsonb not null, issuer_id uuid not null references auth.users,
  issued_at timestamptz not null, hash text not null, unique(trip_id, version_number)
);
create table public.company_copies (
  version_id uuid primary key references public.instruction_versions on delete restrict,
  snapshot jsonb not null, saved_at timestamptz not null
);
create table public.audit_events (
  id uuid primary key default gen_random_uuid(), trip_id uuid not null references public.trips on delete restrict,
  operation_id uuid not null, actor_id uuid not null references auth.users,
  action text not null, received_at timestamptz not null, detail jsonb not null
);
create table app_private.operations (
  actor_id uuid not null, operation_id uuid not null, fingerprint text not null,
  trip_id uuid not null references public.trips on delete restrict,
  result jsonb not null, primary key(actor_id, operation_id)
);

create function app_private.active_member(target_depot uuid) returns public.memberships
language sql stable security definer set search_path = '' as $$
  select m from public.memberships m where m.user_id = auth.uid() and m.depot_id = target_depot and m.valid_from <= now() and (m.valid_until is null or m.valid_until > now())
$$;
create function public.can_read_trip(target public.trips) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.memberships m where m.user_id = auth.uid()
    and m.depot_id = target.depot_id and m.organization_id = target.organization_id
    and m.valid_from <= now() and (m.valid_until is null or m.valid_until > now())
    and (m.role in ('manager','dispatcher') or (m.role = 'driver' and target.driver_id = auth.uid())
      or (m.role = 'auditor' and target.created_at >= m.audit_from and target.created_at <= m.audit_until)))
$$;
create function public.can_read_depot(target_depot uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select (app_private.active_member(target_depot)).user_id is not null
$$;
create function public.can_read_membership(target public.memberships) returns boolean
language sql stable security definer set search_path = '' as $$
  select target.user_id = auth.uid() or (app_private.active_member(target.depot_id)).role in ('manager','dispatcher','admin')
$$;

alter table public.organizations enable row level security;
alter table public.depots enable row level security;
alter table public.memberships enable row level security;
alter table public.trips enable row level security;
alter table public.instruction_versions enable row level security;
alter table public.company_copies enable row level security;
alter table public.audit_events enable row level security;
revoke all on public.organizations, public.depots, public.memberships, public.trips, public.instruction_versions, public.company_copies, public.audit_events from anon, authenticated;
grant select on public.organizations, public.depots, public.memberships, public.trips, public.instruction_versions, public.company_copies, public.audit_events to authenticated;
create policy organizations_read on public.organizations for select to authenticated using (exists(select 1 from public.depots d where d.organization_id = organizations.id and public.can_read_depot(d.id)));
create policy depots_read on public.depots for select to authenticated using (public.can_read_depot(id));
create policy memberships_read on public.memberships for select to authenticated using (public.can_read_membership(memberships));
create policy trips_read on public.trips for select to authenticated using (public.can_read_trip(trips));
create policy versions_read on public.instruction_versions for select to authenticated using (exists(select 1 from public.trips t where t.id = trip_id and public.can_read_trip(t)));
create policy copies_read on public.company_copies for select to authenticated using (exists(select 1 from public.instruction_versions v join public.trips t on t.id = v.trip_id where v.id = version_id and public.can_read_trip(t)));
create policy audit_read on public.audit_events for select to authenticated using (exists(select 1 from public.trips t where t.id = trip_id and public.can_read_trip(t)));

create function app_private.parse_time(value text) returns timestamptz
language plpgsql immutable set search_path = '' as $$
begin
  if value is null or value !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$' then raise exception '日時が不正です。'; end if;
  if value ~ '(Z|[+-]\d{2}:\d{2})$' then return value::timestamptz; end if;
  return (value || '+09:00')::timestamptz;
end $$;
create function app_private.assert_plan(p jsonb) returns void
language plpgsql set search_path = '' as $$
declare k text; s jsonb; a timestamptz; d timestamptz; prev timestamptz;
  start_at timestamptz; end_at timestamptz; duty_start timestamptz; duty_end timestamptz; contact timestamptz;
begin
  foreach k in array array['driverName','vehicle','startPlace','endPlace','route','cautions','exchange','safety','fallback'] loop
    if jsonb_typeof(p->k) <> 'string' or coalesce(length(trim(p->>k)),0) = 0 then raise exception '必須項目がありません：%', k; end if;
  end loop;
  start_at := app_private.parse_time(p->>'startAt'); end_at := app_private.parse_time(p->>'endAt');
  duty_start := app_private.parse_time(p->>'dutyStart'); duty_end := app_private.parse_time(p->>'dutyEnd'); contact := app_private.parse_time(p->>'nextContact');
  if end_at <= start_at or duty_start > start_at or duty_end < end_at or duty_end <= duty_start or contact < start_at or contact > end_at then raise exception '勤務・運行・連絡の時刻順序を確認してください。'; end if;
  if extract(epoch from duty_end - duty_start) > 144*3600 then raise exception '一の運行が144時間を超えています。'; end if;
  if jsonb_typeof(p->'returnProvisional') is distinct from 'boolean' then raise exception '帰庫の確定度を指定してください。'; end if;
  if jsonb_typeof(p->'stops') is distinct from 'array' or jsonb_array_length(p->'stops') = 0 then raise exception '行程を登録してください。'; end if;
  prev := start_at;
  for s in select value from jsonb_array_elements(p->'stops') loop
    if coalesce(length(trim(s->>'place')),0) = 0 or coalesce(s->>'kind','') not in ('pickup','delivery','via','break','rest','wait') then raise exception '行程の地点・種別が不正です。'; end if;
    a := app_private.parse_time(s->>'arrive'); d := app_private.parse_time(s->>'depart');
    if a < prev or d < a or (s->>'kind' <> 'via' and d = a) or d > end_at then raise exception '行程の発着順序・作業時間を確認してください。'; end if; prev := d;
  end loop;
  if not exists(select 1 from jsonb_array_elements(p->'stops') as stops(value) where stops.value->>'kind' = 'break') or not exists(select 1 from jsonb_array_elements(p->'stops') as stops(value) where stops.value->>'kind' = 'rest') then raise exception '休憩・休息を分けて登録してください。'; end if;
end $$;

create function public.apply_operation(operation jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid(); op_id uuid; trip_id uuid; action text; p jsonb; row public.trips; member public.memberships; driver public.memberships;
  doc jsonb; plan jsonb; version jsonb; old_version jsonb; req jsonb; item jsonb; audit jsonb; current_number integer; fingerprint text; remembered app_private.operations;
  target_depot uuid; received timestamptz := clock_timestamp(); at timestamptz; start_time timestamptz; end_time timestamptz;
  text_key text; request_ids jsonb; updated_requests jsonb := '[]'; v_hash text;
begin
  if actor is null then raise exception 'ログインしてください。'; end if;
  if octet_length(operation::text) > 200000 then raise exception '入力が大きすぎます。'; end if;
  op_id := (operation->>'operationId')::uuid; trip_id := (operation->>'tripId')::uuid; action := operation->>'action'; p := operation->'payload';
  if op_id is null or trip_id is null or jsonb_typeof(p) is distinct from 'object' or action is null then raise exception '操作が不正です。'; end if;
  if action not in ('create','savePlan','submitRequest','decideRequest','publish','voice','ack','deviceSaved','actual','close') then raise exception '未対応の操作です。'; end if;
  fingerprint := encode(sha256(convert_to((operation - 'expectedRevision')::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended(actor::text || op_id::text,0));
  select * into row from public.trips t where t.id = trip_id for update;
  target_depot := case when row.id is null then (p->>'depotId')::uuid else row.depot_id end;
  member := app_private.active_member(target_depot);
  if member.user_id is null or (row.id is not null and not public.can_read_trip(row)) then raise exception '所属・閲覧権限がありません。'; end if;
  select * into remembered from app_private.operations where actor_id = actor and operation_id = op_id;
  if remembered.operation_id is not null then
    if remembered.fingerprint <> fingerprint then raise exception '同じ操作IDで異なる内容は送信できません。'; end if;
    return remembered.result;
  end if;
  if action = 'create' then
    if row.id is not null or member.role not in ('manager','dispatcher') then raise exception '運行作成の権限がないか、同じ運行が既にあります。'; end if;
    select * into driver from public.memberships m where m.user_id = (p->>'driverId')::uuid and m.depot_id = target_depot and m.organization_id = member.organization_id and m.role = 'driver' and m.valid_from <= received and (m.valid_until is null or m.valid_until > received);
    if driver.user_id is null then raise exception '同じ営業所のドライバーを選んでください。'; end if;
    plan := jsonb_set(p->'plan','{driverName}',to_jsonb(driver.display_name));
    if jsonb_typeof(plan) is distinct from 'object' then raise exception '計画が不正です。'; end if;
    doc := jsonb_build_object('id',trip_id,'orgId',member.organization_id,'depotId',target_depot,'driverId',driver.user_id,'createdAt',received,'revision',0,'draftRevision',0,'draftBaseVersion',0,'status','draft','plan',plan,'versions','[]'::jsonb,'requests','[]'::jsonb,'voices','[]'::jsonb,'driverRecords','[]'::jsonb,'receipts','[]'::jsonb,'actuals','[]'::jsonb,'audit','[]'::jsonb,'legalHold',false);
    insert into public.trips(id,organization_id,depot_id,driver_id,created_at,document) values(trip_id,member.organization_id,target_depot,driver.user_id,received,doc) returning * into row;
  else
    if row.id is null then raise exception '運行がありません。'; end if;
    if row.revision is distinct from (operation->>'expectedRevision')::integer then raise exception '他の操作で更新されました。再読込して差分を確認してください。'; end if;
    doc := row.document;
    if doc->>'status' = 'closed' then raise exception '保存確定後は変更できません。'; end if;
  end if;
  old_version := (doc->'versions')->-1; current_number := coalesce((old_version->>'number')::integer,0);
  case action
    when 'create' then null;
    when 'savePlan' then
      if member.role not in ('manager','dispatcher') then raise exception '下書き編集の権限がありません。'; end if;
      if (p->>'baseVersion')::integer is distinct from current_number then raise exception '基準版が古いため再確認してください。'; end if;
      if jsonb_typeof(p->'plan') is distinct from 'object' then raise exception '計画が不正です。'; end if;
      plan := jsonb_set(p->'plan','{driverName}',doc->'plan'->'driverName');
      doc := doc || jsonb_build_object('plan',plan,'draftRevision',(doc->>'draftRevision')::integer+1,'draftBaseVersion',current_number);
    when 'submitRequest' then
      if member.role <> 'dispatcher' and not (member.role = 'driver' and row.driver_id = actor) then raise exception '申請権限がありません。'; end if;
      if (p->>'baseVersion')::integer is distinct from current_number then raise exception '申請の基準版が古いため再確認してください。'; end if;
      foreach text_key in array array['name','pickup','delivery','source'] loop
        if coalesce(length(trim(p->'load'->>text_key)),0) = 0 then raise exception '荷物の必須項目がありません：%',text_key; end if;
      end loop;
      start_time := app_private.parse_time(p->'load'->>'pickupAt'); end_time := app_private.parse_time(p->'load'->>'deliveryAt');
      perform app_private.parse_time(p->'load'->>'receivedAt');
      if end_time < start_time or coalesce(length(trim(p->>'reason')),0) = 0 then raise exception '荷物の時刻・理由を確認してください。'; end if;
      item := jsonb_build_object('id',op_id,'authorId',actor,'author',member.display_name,'load',p->'load','reason',p->>'reason','baseVersion',current_number,'submittedAt',received,'status','submitted');
      doc := jsonb_set(doc,'{requests}',doc->'requests' || jsonb_build_array(item));
    when 'decideRequest' then
      if member.role <> 'manager' then raise exception '申請審査の権限がありません。'; end if;
      if coalesce(p->>'status','') not in ('returned','rejected') or coalesce(length(trim(p->>'response')),0) = 0 then raise exception '差戻し・却下理由が必要です。'; end if;
      select value into req from jsonb_array_elements(doc->'requests') where value->>'id' = p->>'requestId' and value->>'status' = 'submitted';
      if req is null then raise exception '申請がありません。'; end if;
      select jsonb_agg(case when value->>'id' = p->>'requestId' then value || jsonb_build_object('status',p->>'status','response',p->>'response') else value end) into updated_requests from jsonb_array_elements(doc->'requests');
      doc := jsonb_set(doc,'{requests}',updated_requests);
    when 'publish' then
      if member.role <> 'manager' then raise exception '運行管理者のみ発行できます。'; end if;
      if (p->>'baseVersion')::integer is distinct from current_number or (p->>'draftRevision')::integer is distinct from (doc->>'draftRevision')::integer or (doc->>'draftBaseVersion')::integer is distinct from current_number then raise exception '基準版・下書きが変わりました。'; end if;
      if p->'safetyReviewed' is distinct from 'true'::jsonb or coalesce(length(trim(p->>'reason')),0) = 0 then raise exception '計画確認と発行理由が必要です。'; end if;
      plan := doc->'plan'; perform app_private.assert_plan(plan);
      request_ids := coalesce(p->'requestIds','[]'::jsonb);
      if jsonb_typeof(request_ids) is distinct from 'array' then raise exception '申請IDが不正です。'; end if;
      if (select count(*) <> count(distinct value) from jsonb_array_elements(request_ids)) then raise exception '申請IDが重複しています。'; end if;
      for item in select value from jsonb_array_elements(request_ids) loop
        select value into req from jsonb_array_elements(doc->'requests') where value->>'id' = item#>>'{}' and value->>'status' = 'submitted' and (value->>'baseVersion')::integer = current_number;
        if req is null then raise exception '申請の基準版を再確認してください。'; end if;
        if not exists(select 1 from jsonb_array_elements(plan->'stops') as stops(value) where stops.value->>'kind' = 'pickup' and stops.value->>'place' = req->'load'->>'pickup' and app_private.parse_time(stops.value->>'arrive') = app_private.parse_time(req->'load'->>'pickupAt'))
          or not exists(select 1 from jsonb_array_elements(plan->'stops') as stops(value) where stops.value->>'kind' = 'delivery' and stops.value->>'place' = req->'load'->>'delivery' and app_private.parse_time(stops.value->>'arrive') = app_private.parse_time(req->'load'->>'deliveryAt'))
          then raise exception '処理する荷物の積卸地点・予定日時を下書きへ反映してください。'; end if;
      end loop;
      v_hash := encode(sha256(convert_to(plan::text,'UTF8')),'hex');
      version := jsonb_build_object('id',op_id,'number',current_number+1,'snapshot',plan,'reason',p->>'reason','issuedAt',received,'issuer',member.display_name,'hash',v_hash,'companyCopy',jsonb_build_object('snapshot',plan,'savedAt',received),'requestIds',request_ids);
      insert into public.instruction_versions values(op_id,trip_id,current_number+1,plan,actor,received,v_hash);
      insert into public.company_copies values(op_id,plan,received);
      select coalesce(jsonb_agg(case when request_ids ? (value->>'id') then value || jsonb_build_object('status','issued','versionId',op_id) else value end),'[]'::jsonb) into updated_requests from jsonb_array_elements(doc->'requests');
      doc := doc || jsonb_build_object('versions',doc->'versions' || jsonb_build_array(version),'requests',updated_requests,'status','active','draftBaseVersion',current_number+1);
    when 'voice' then
      if member.role <> 'manager' or old_version is null or p->>'versionId' is distinct from old_version->>'id' then raise exception '管理者が最新の版を指定してください。'; end if;
      if coalesce(p->>'method','') not in ('phone','voice') or coalesce(length(trim(p->>'notes')),0) = 0 or coalesce(length(trim(p->>'recipient')),0) = 0 then raise exception '通話方法・相手・内容が必要です。'; end if;
      at := app_private.parse_time(p->>'actualAt'); if at > received or at < (old_version->>'issuedAt')::timestamptz then raise exception '通話実日時を確認してください。'; end if;
      item := jsonb_build_object('id',op_id,'versionId',old_version->>'id','actorId',actor,'manager',member.display_name,'actualAt',at,'receivedAt',received,'method',p->>'method','recipient',p->>'recipient','notes',p->>'notes');
      doc := jsonb_set(doc,'{voices}',doc->'voices'||jsonb_build_array(item));
    when 'ack' then
      if member.role <> 'driver' or row.driver_id <> actor or old_version is null or p->>'versionId' is distinct from old_version->>'id' then raise exception '本人が最新の版を確認してください。'; end if;
      if coalesce(length(trim(p->>'notes')),0) = 0 then raise exception '確認内容が必要です。'; end if;
      at := app_private.parse_time(p->>'actualAt'); if at > received or at < (old_version->>'issuedAt')::timestamptz then raise exception '確認実日時を確認してください。'; end if;
      if exists(select 1 from jsonb_array_elements(doc->'driverRecords') where value->>'versionId' = old_version->>'id' and value->>'driverId' = actor::text) then raise exception 'この版は記録済みです。'; end if;
      item := jsonb_build_object('id',op_id,'versionId',old_version->>'id','driverId',actor,'driver',member.display_name,'actualAt',at,'receivedAt',received,'notes',p->>'notes');
      doc := jsonb_set(doc,'{driverRecords}',doc->'driverRecords'||jsonb_build_array(item));
    when 'deviceSaved' then
      if member.role <> 'driver' or row.driver_id <> actor or old_version is null or p->>'versionId' is distinct from old_version->>'id' or coalesce(length(trim(p->>'deviceId')),0) = 0 then raise exception '本人が最新の版を端末保存してください。'; end if;
      at := app_private.parse_time(p->>'savedAt'); if at > received or at < (old_version->>'issuedAt')::timestamptz then raise exception '保存実日時を確認してください。'; end if;
      item := jsonb_build_object('id',op_id,'versionId',old_version->>'id','driverId',actor,'deviceId',p->>'deviceId','savedAt',at,'receivedAt',received);
      doc := jsonb_set(doc,'{receipts}',doc->'receipts'||jsonb_build_array(item));
    when 'actual' then
      if member.role <> 'driver' or row.driver_id <> actor then raise exception '実績は本人が入力してください。'; end if;
      if coalesce(p->>'kind','') not in ('pickup','delivery','via','break','rest','wait','drive','dutyStart','dutyEnd') or coalesce(length(trim(p->>'place')),0) = 0 then raise exception '実績種別と地点が必要です。'; end if;
      start_time := app_private.parse_time(p->>'startAt'); end_time := app_private.parse_time(p->>'endAt');
      if end_time < start_time or end_time > received then raise exception '実績の時刻順序を確認してください。'; end if;
      if (p->>'kind') in ('dutyStart','dutyEnd') and exists(select 1 from jsonb_array_elements(doc->'actuals') where value->>'kind' = p->>'kind') then raise exception '勤務開始・終了は既に記録されています。'; end if;
      item := jsonb_build_object('id',op_id,'kind',p->>'kind','place',p->>'place','startAt',start_time,'endAt',end_time,'notes',coalesce(p->>'notes',''),'actor',member.display_name,'receivedAt',received);
      doc := jsonb_set(doc,'{actuals}',doc->'actuals'||jsonb_build_array(item));
    when 'close' then
      if member.role <> 'manager' or old_version is null or p->'actualsReviewed' is distinct from 'true'::jsonb then raise exception '管理者による最終確認が必要です。'; end if;
      if not exists(select 1 from jsonb_array_elements(doc->'voices') where value->>'versionId' = old_version->>'id') or not exists(select 1 from jsonb_array_elements(doc->'driverRecords') where value->>'versionId' = old_version->>'id' and value->>'driverId' = row.driver_id::text) or not exists(select 1 from jsonb_array_elements(doc->'receipts') where value->>'versionId' = old_version->>'id' and value->>'driverId' = row.driver_id::text) then raise exception '最新指示の双方記録・直接対話・端末保存が揃っていません。'; end if;
      if exists(select 1 from jsonb_array_elements(doc->'requests') where value->>'status' = 'submitted') then raise exception '未処理申請があります。'; end if;
      select app_private.parse_time(value->>'startAt') into start_time from jsonb_array_elements(doc->'actuals') where value->>'kind' = 'dutyStart';
      select app_private.parse_time(value->>'endAt') into end_time from jsonb_array_elements(doc->'actuals') where value->>'kind' = 'dutyEnd';
      if start_time is null or end_time is null or end_time <= start_time then raise exception '勤務開始・終了の実績を確認してください。'; end if;
      doc := doc || jsonb_build_object('status','closed','closedAt',end_time,'retainUntil',(date_trunc('day',end_time at time zone 'Asia/Tokyo') + interval '1 day' + interval '1 year') at time zone 'Asia/Tokyo','policyRetainUntil',(date_trunc('day',end_time at time zone 'Asia/Tokyo') + interval '1 day' + interval '3 years') at time zone 'Asia/Tokyo');
  end case;
  audit := jsonb_build_object('id',op_id,'action',action,'actor',member.display_name,'at',received);
  doc := doc || jsonb_build_object('revision',row.revision+1,'audit',doc->'audit'||jsonb_build_array(audit));
  update public.trips t set document = doc, revision = row.revision+1 where t.id = trip_id;
  insert into public.audit_events(trip_id,operation_id,actor_id,action,received_at,detail) values(trip_id,op_id,actor,action,received,jsonb_build_object('versionId',coalesce(version->>'id',old_version->>'id'),'revision',row.revision+1));
  insert into app_private.operations values(actor,op_id,fingerprint,trip_id,doc);
  return doc;
end $$;

-- Revoke PUBLIC's default execute privilege, including internal validators.
revoke all on all functions in schema app_private from public, anon, authenticated;
revoke all on function public.apply_operation(jsonb), public.can_read_trip(public.trips), public.can_read_depot(uuid), public.can_read_membership(public.memberships) from public, anon;
grant execute on function public.apply_operation(jsonb), public.can_read_trip(public.trips), public.can_read_depot(uuid), public.can_read_membership(public.memberships) to authenticated;

create function app_private.prevent_record_change() returns trigger language plpgsql set search_path = '' as $$
begin raise exception '発行済み版・会社写し・監査記録は上書き・削除できません。'; end $$;
create trigger versions_immutable before update or delete on public.instruction_versions for each row execute function app_private.prevent_record_change();
create trigger copies_immutable before update or delete on public.company_copies for each row execute function app_private.prevent_record_change();
create trigger audit_immutable before update or delete on public.audit_events for each row execute function app_private.prevent_record_change();
-- No user-facing deletion API. Unfinished trips and retention-held trips stay protected.
create function app_private.prevent_trip_delete() returns trigger language plpgsql set search_path = '' as $$
begin
  if old.document->>'status' <> 'closed' or (old.document->>'legalHold')::boolean or (old.document->>'policyRetainUntil')::timestamptz > clock_timestamp() then raise exception '保存期限前・保留中の運行は削除できません。'; end if;
  return old;
end $$;
create trigger trip_retention before delete on public.trips for each row execute function app_private.prevent_trip_delete();
revoke all on all functions in schema app_private from public, anon, authenticated;
