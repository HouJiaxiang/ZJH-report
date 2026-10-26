begin;
lock table public.rooms in share row exclusive mode;

-- History and retry receipts are one atomic append, never client-writable.
create table private.room_events (
  sequence bigint generated always as identity primary key,
  room_id text not null references public.rooms(id),
  request_id uuid not null,
  request_command jsonb not null,
  event jsonb not null,
  unique(room_id, request_id)
);
create index room_events_history_idx on private.room_events(room_id, sequence desc);
alter table private.room_events enable row level security;
revoke all on private.room_events from public, anon, authenticated;
revoke all on sequence private.room_events_sequence_seq from public, anon, authenticated;

-- Only verified protocol-2 rooms are compacted. Legacy rooms remain untouched.
-- Invalid or duplicate receipts abort the migration instead of silently dropping history.
insert into private.room_events(room_id, request_id, request_command, event)
select r.id, (l.entry->>'id')::uuid, l.entry->'_command', l.entry - '_command'
from public.rooms r
cross join lateral jsonb_array_elements(r.content->'logs') with ordinality l(entry, ordinal)
where r.content->>'protocol' = '2'
order by r.id, l.ordinal;

update public.rooms
set content = jsonb_set(content, '{logs}',
      case when jsonb_array_length(content->'logs') > 0
        then jsonb_build_array((content->'logs'->-1) - '_command')
        else '[]'::jsonb end)
    || jsonb_build_object('revision', coalesce((content->>'revision')::bigint,0) + 1),
    updated_at = clock_timestamp()
where content->>'protocol' = '2';

create or replace function private.apply_room_action(
  p_room_id text, p_actor text, p_action text, p_args jsonb, p_request_id uuid
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  r jsonb;
  player jsonb;
  target_player jsonb;
  target_id text := p_args->>'target';
  member record;
  amount numeric;
  ante numeric;
  nickname text;
  message text;
  event_type text := 'system';
  previous jsonb;
  command jsonb := jsonb_build_object('actor', p_actor, 'action', p_action, 'args', p_args);
  event jsonb;
begin
  if p_actor is null or p_actor = '' or p_request_id is null or p_args is null then
    raise exception '无效的操作请求';
  end if;
  -- The room row lock serializes ALL mutations, including settlement and membership changes.
  select content into r from public.rooms where id = p_room_id for update;
  if not found then raise exception '房间不存在'; end if;
  select request_command into previous from private.room_events
    where room_id = p_room_id and request_id = p_request_id;
  if previous is not null then
    if previous is distinct from command then raise exception '请求编号冲突'; end if;
    return r;
  end if;
  if coalesce((r->>'closed')::boolean, false) then raise exception '房间已解散'; end if;
  player := r->'players'->p_actor;
  if p_action <> 'join' and (player is null or coalesce((player->>'removed')::boolean, false)) then
    raise exception '你已不在房间中';
  end if;
  if p_action in ('start', 'settle', 'kick', 'disband') and r->>'hostId' is distinct from p_actor then
    raise exception '只有房主可以执行此操作';
  end if;
  if p_action in ('start', 'bet', 'fold', 'look', 'settle') and
     (p_args->>'round')::integer is distinct from (r->>'roundCount')::integer then
    raise exception '轮次已变化，请刷新后操作';
  end if;
  if p_action in ('bet', 'fold', 'look', 'settle') and r->>'status' <> 'playing' then
    raise exception '本轮尚未开始或已经结算';
  end if;
  if p_action in ('bet', 'fold', 'look') and player->>'status' <> 'active' then
    raise exception '弃牌后不能继续操作';
  end if;
  if p_action in ('join', 'start', 'kick', 'leave', 'disband') and
     (r->>'status' <> 'waiting' or (r->>'pot')::numeric <> 0) then
    raise exception '请先结算本轮';
  end if;
  if p_action in ('bet', 'transfer') then
    amount := (p_args->>'amount')::numeric;
    if amount is null or amount < 1 or amount > 1000000 or amount <> trunc(amount) then
      raise exception '积分必须是 1 到 1000000 的整数';
    end if;
  end if;
  if p_action in ('join', 'rename') then
    nickname := btrim(p_args->>'nickname');
    if nickname is null or length(nickname) not between 1 and 20 then
      raise exception '昵称须为 1 到 20 个字符';
    end if;
  end if;
  if p_action in ('transfer', 'settle', 'kick') then
    target_player := r->'players'->target_id;
    if target_player is null or coalesce((target_player->>'removed')::boolean, false) then
      raise exception '目标成员不在房间中';
    end if;
  end if;

  case p_action
  when 'join' then
    if player is not null and not coalesce((player->>'removed')::boolean,false) then raise exception '该成员已存在'; end if;
    if (select count(*) from jsonb_each(r->'players') where not coalesce((value->>'removed')::boolean, false)) >= 15 then
      raise exception '房间已满（限 15 人）';
    end if;
    player := jsonb_build_object('id', p_actor, 'nickname', nickname, 'avatar', left(coalesce(p_args->>'avatar', ''), 10),
      'balance', coalesce((player->>'balance')::numeric,0), 'status', 'active', 'cardStatus', 'blind', 'isOnline', true, 'isHost', false);
    r := jsonb_set(r, array['players', p_actor], player);
    message := nickname || ' 加入了房间';
  when 'start' then
    if (select count(*) from jsonb_each(r->'players') where not coalesce((value->>'removed')::boolean, false)) < 2 then
      raise exception '至少需要两位成员';
    end if;
    ante := (r->>'ante')::numeric;
    if (r->>'roundCount')::integer = 0 and p_args->>'ante' is not null then ante := (p_args->>'ante')::numeric; end if;
    if ante is null or ante < 1 or ante > 1000000 or ante <> trunc(ante) then raise exception '底注须为有效的正整数'; end if;
    r := r || jsonb_build_object('ante', ante, 'status', 'playing', 'roundCount', (r->>'roundCount')::integer + 1);
    amount := 0;
    for member in select key, value from jsonb_each(r->'players') loop
      if not coalesce((member.value->>'removed')::boolean, false) then
        r := jsonb_set(r, array['players', member.key], member.value || jsonb_build_object(
          'balance', (member.value->>'balance')::numeric - ante, 'status', 'active', 'cardStatus', 'blind'));
        amount := amount + ante;
      end if;
    end loop;
    r := jsonb_set(r, '{pot}', to_jsonb(amount));
    message := '第 ' || (r->>'roundCount') || ' 轮开始，已扣底注';
  when 'bet' then
    r := jsonb_set(r, array['players', p_actor, 'balance'], to_jsonb((player->>'balance')::numeric - amount));
    r := jsonb_set(r, '{pot}', to_jsonb((r->>'pot')::numeric + amount));
    message := (player->>'nickname') || ' 下注 ' || amount;
    event_type := 'bet';
  when 'fold' then
    r := jsonb_set(r, array['players', p_actor, 'status'], '"folded"');
    message := (player->>'nickname') || ' 弃牌'; event_type := 'fold';
  when 'look' then
    r := jsonb_set(r, array['players', p_actor, 'cardStatus'], '"seen"');
    message := (player->>'nickname') || ' 看牌'; event_type := 'look';
  when 'settle' then
    amount := (r->>'pot')::numeric;
    r := jsonb_set(r, array['players', target_id, 'balance'], to_jsonb((target_player->>'balance')::numeric + amount));
    r := r || jsonb_build_object('pot', 0, 'status', 'waiting');
    message := (target_player->>'nickname') || ' 赢走池底 (' || amount || ')'; event_type := 'win';
  when 'transfer' then
    if target_id = p_actor then raise exception '不能给自己转账'; end if;
    r := jsonb_set(r, array['players', p_actor, 'balance'], to_jsonb((player->>'balance')::numeric - amount));
    r := jsonb_set(r, array['players', target_id, 'balance'], to_jsonb((target_player->>'balance')::numeric + amount));
    message := (player->>'nickname') || ' 转给 ' || (target_player->>'nickname') || ' ' || amount; event_type := 'transfer';
  when 'rename' then
    r := jsonb_set(r, array['players', p_actor, 'nickname'], to_jsonb(nickname));
    message := (player->>'nickname') || ' 改名为 ' || nickname;
  when 'kick', 'leave' then
    if p_action = 'leave' then target_id := p_actor; target_player := player;
    elsif target_id = p_actor then raise exception '房主不能踢出自己'; end if;
    -- Archive, never delete balances or past ledger entries.
    r := jsonb_set(r, array['players', target_id], target_player || jsonb_build_object('removed', true, 'isHost', false, 'isOnline', false));
    if target_id = r->>'hostId' then
      select key into target_id from jsonb_each(r->'players') where not coalesce((value->>'removed')::boolean, false) order by key limit 1;
      if target_id is null then r := r || '{"closed":true}'::jsonb;
      else
        r := jsonb_set(r, '{hostId}', to_jsonb(target_id));
        r := jsonb_set(r, array['players', target_id, 'isHost'], 'true');
      end if;
    end if;
    message := (target_player->>'nickname') || case when p_action = 'kick' then ' 被房主移出房间' else ' 离开了房间' end;
  when 'disband' then
    r := r || '{"closed":true}'::jsonb;
    message := '房主解散了房间';
  else raise exception '不支持的操作';
  end case;

  if abs((r->>'pot')::numeric) > 9000000000000 or exists (
    select 1 from jsonb_each(r->'players') where abs((value->>'balance')::numeric) > 9000000000000
  ) then raise exception '积分已超过安全上限'; end if;
  event := jsonb_build_object('id', p_request_id, 'timestamp', floor(extract(epoch from clock_timestamp()) * 1000),
    'userId', p_actor, 'userName', player->>'nickname', 'action', message, 'type', event_type, '_command', command);
  if amount is not null then event := event || jsonb_build_object('amount', amount); end if;
  insert into private.room_events(room_id, request_id, request_command, event)
    values (p_room_id, p_request_id, command, event - '_command');
  -- Keep the realtime/RPC payload independent of the number of past actions.
  r := jsonb_set(r, '{logs}', jsonb_build_array(event - '_command'));
  r := jsonb_set(r, '{revision}', to_jsonb(coalesce((r->>'revision')::bigint, 0) + 1));
  update public.rooms set content = r, updated_at = clock_timestamp() where id = p_room_id;
  return r;
end;
$$;
revoke all on function private.apply_room_action(text,text,text,jsonb,uuid) from public, anon, authenticated;

create function private.room_history(p_room_id text, p_before bigint default null, p_limit integer default 50)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid text := auth.uid()::text;
  entries jsonb;
  extra boolean;
begin
  if uid is null or not exists (
    select 1 from public.rooms where id=p_room_id and content->>'protocol'='2' and content->'players' ? uid
  ) then raise exception '无权查看房间记录' using errcode='42501'; end if;
  if p_limit is null or p_limit not between 1 and 100 or p_before <= 0 then
    raise exception '分页参数无效';
  end if;
  -- Cursor pagination uses the room/sequence index, never an OFFSET over old pages.
  with batch as materialized (
    select sequence,event from private.room_events
    where room_id=p_room_id and sequence < coalesce(p_before,9223372036854775807)
    order by sequence desc limit p_limit + 1
  ), page as (
    select * from batch order by sequence desc limit p_limit
  )
  select coalesce((select jsonb_agg(jsonb_build_object('cursor',sequence::text,'event',event) order by sequence desc) from page),'[]'::jsonb),
    (select count(*) > p_limit from batch)
  into entries, extra;
  return jsonb_build_object('entries',entries,'nextCursor',
    case when extra then entries->-1->>'cursor' else null end);
end;
$$;
revoke all on function private.room_history(text,bigint,integer) from public, anon;
grant execute on function private.room_history(text,bigint,integer) to authenticated;
create function public.room_history(p_room_id text, p_before bigint default null, p_limit integer default 50)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.room_history(p_room_id,p_before,p_limit);
$$;
revoke all on function public.room_history(text,bigint,integer) from public, anon;
grant execute on function public.room_history(text,bigint,integer) to authenticated;
commit;

