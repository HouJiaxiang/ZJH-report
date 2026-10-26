begin;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

-- The mutation engine is internal. Only the checked gateway may invoke it.
alter function public.room_action(text,text,text,jsonb,uuid) set schema private;
alter function private.room_action(text,text,text,jsonb,uuid) rename to apply_room_action;
revoke all on function private.apply_room_action(text,text,text,jsonb,uuid) from public, anon, authenticated;

create function private.checked_room_action(p_room_id text, p_actor text, p_action text, p_args jsonb, p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid text := auth.uid()::text;
  r jsonb;
begin
  if uid is null or uid is distinct from p_actor then raise exception '无法验证本机成员身份' using errcode = '42501'; end if;
  select content into r from public.rooms where id = p_room_id for update;
  if r is null then raise exception '房间不存在'; end if;
  if r->>'protocol' is distinct from '2' then raise exception '旧版房间已归档，请创建新房间；旧积分不会被覆盖'; end if;
  -- Re-entering an existing active membership does not create another player or reset scores.
  if p_action = 'join' and r->'players' ? uid
     and not coalesce((r->'players'->uid->>'removed')::boolean,false)
     and not coalesce((r->>'closed')::boolean,false) then return r; end if;
  return private.apply_room_action(p_room_id, uid, p_action, p_args, p_request_id);
end;
$$;
revoke all on function private.checked_room_action(text,text,text,jsonb,uuid) from public, anon;
grant execute on function private.checked_room_action(text,text,text,jsonb,uuid) to authenticated;

create function public.room_action(p_room_id text, p_actor text, p_action text, p_args jsonb, p_request_id uuid)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.checked_room_action(p_room_id,p_actor,p_action,p_args,p_request_id);
$$;
revoke all on function public.room_action(text,text,text,jsonb,uuid) from public, anon;
grant execute on function public.room_action(text,text,text,jsonb,uuid) to authenticated;

create table private.room_creations (
  user_id uuid not null,
  request_id uuid not null,
  room_id text not null references public.rooms(id),
  arguments jsonb not null,
  primary key (user_id, request_id)
);
alter table private.room_creations enable row level security;
revoke all on private.room_creations from public, anon, authenticated;

create function private.create_room(p_request_id uuid, p_nickname text, p_ante integer, p_avatar text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  nickname text := btrim(p_nickname);
  code text;
  r jsonb;
  receipt private.room_creations;
  args jsonb := jsonb_build_object('nickname',p_nickname,'ante',p_ante,'avatar',p_avatar);
begin
  if uid is null then raise exception '访客身份尚未建立' using errcode = '42501'; end if;
  if p_request_id is null or nickname is null or length(nickname) not between 1 and 20 or p_ante is null or p_ante not between 1 and 1000000 then
    raise exception '昵称或底注无效';
  end if;
  -- A lost create response must not generate a second room on retry.
  perform pg_advisory_xact_lock(hashtextextended(uid::text,0));
  select * into receipt from private.room_creations where user_id=uid and request_id=p_request_id;
  if found then
    if receipt.arguments is distinct from args then raise exception '请求编号冲突'; end if;
    select content into r from public.rooms where id=receipt.room_id;
    return r;
  end if;
  if (select count(*) from public.rooms where content->>'hostId'=uid::text and not coalesce((content->>'closed')::boolean,false)) >= 10 then
    raise exception '你创建的未解散房间过多，请先解散不用的房间';
  end if;
  for attempt in 1..30 loop
    code := (1000+floor(random()*9000))::integer::text;
    r := jsonb_build_object('id',code,'protocol',2,'hostId',uid::text,'status','waiting','pot',0,'ante',p_ante,
      'roundCount',0,'revision',0,'createdAt',floor(extract(epoch from clock_timestamp())*1000),
      'players',jsonb_build_object(uid::text,jsonb_build_object('id',uid::text,'nickname',nickname,
        'avatar',left(coalesce(p_avatar,''),10),'balance',0,'status','active','cardStatus','blind','isOnline',true,'isHost',true)),
      'logs','[]'::jsonb);
    begin
      insert into public.rooms(id,content) values(code,r);
      insert into private.room_creations values(uid,p_request_id,code,args);
      return r;
    exception when unique_violation then
      -- Retry code collisions without replacing any room or history.
    end;
  end loop;
  raise exception '房间号暂时不可用，请稍后重试';
end;
$$;
revoke all on function private.create_room(uuid,text,integer,text) from public, anon;
grant execute on function private.create_room(uuid,text,integer,text) to authenticated;
create function public.create_room(p_request_id uuid,p_nickname text,p_ante integer,p_avatar text)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.create_room(p_request_id,p_nickname,p_ante,p_avatar);
$$;
revoke all on function public.create_room(uuid,text,integer,text) from public, anon;
grant execute on function public.create_room(uuid,text,integer,text) to authenticated;

create function private.preview_room(p_room_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r jsonb;
begin
  if auth.uid() is null then raise exception '访客身份尚未建立' using errcode = '42501'; end if;
  select content into r from public.rooms where id=p_room_id;
  if r is null or coalesce((r->>'closed')::boolean,false) then return null; end if;
  if r->>'protocol' is distinct from '2' then raise exception '旧版房间已归档，请创建新房间'; end if;
  return jsonb_build_object('id',p_room_id,'hostName',r->'players'->(r->>'hostId')->>'nickname',
    'playerCount',(select count(*) from jsonb_each(r->'players') where not coalesce((value->>'removed')::boolean,false)),
    'pot',r->'pot','status',r->'status');
end;
$$;
revoke all on function private.preview_room(text) from public, anon;
grant execute on function private.preview_room(text) to authenticated;
create function public.preview_room(p_room_id text) returns jsonb
language sql security invoker set search_path = '' as $$ select private.preview_room(p_room_id); $$;
revoke all on function public.preview_room(text) from public, anon;
grant execute on function public.preview_room(text) to authenticated;

-- Revoke table writes as well as the permissive policies, including old-browser deletes.
revoke all on public.rooms from public, anon, authenticated;
grant select on public.rooms to authenticated;
alter table public.rooms enable row level security;
do $$ declare p record; begin
  for p in select policyname from pg_policies where schemaname='public' and tablename='rooms' loop
    execute format('drop policy %I on public.rooms',p.policyname);
  end loop;
end $$;
-- Former members retain read access to the shared ledger, but cannot mutate or receive antes.
create policy room_members_read on public.rooms for select to authenticated
using (content->>'protocol'='2' and content->'players' ? (select auth.uid()::text));
commit;
