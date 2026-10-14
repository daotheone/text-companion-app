-- Run once in the Supabase SQL editor or apply with the Supabase CLI.
create table public.companion_data (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null,
  version integer not null check (version > 0),
  last_write_id uuid not null,
  updated_at timestamptz not null default now(),
  constraint companion_data_shape check (
    jsonb_typeof(data) = 'object'
    and data ?& array['dailyTasks', 'todos', 'notes']
    and jsonb_typeof(data->'dailyTasks') = 'array'
    and jsonb_typeof(data->'todos') = 'array'
    and jsonb_typeof(data->'notes') = 'object'
    and octet_length(data::text) <= 1048576
  )
);

alter table public.companion_data enable row level security;
revoke all on public.companion_data from public, anon, authenticated;
grant select on public.companion_data to authenticated;
create policy "Read own companion data" on public.companion_data
  for select to authenticated using ((select auth.uid()) = user_id);

-- Client supplies no writable owner field. Auth identity is checked on every call.
create function public.save_companion_data(expected_user uuid, payload jsonb, expected_version integer, request_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_id uuid := auth.uid();
  saved_version integer;
  entry jsonb;
  history_date jsonb;
  note record;
  date_text text;
  ids text[];
begin
  if owner_id is null or owner_id is distinct from expected_user then
    raise exception 'Authentication changed. Export your changes, then log in again.' using errcode = '42501';
  end if;
  if payload is null or expected_version is null or expected_version < 0 or request_id is null
    or jsonb_typeof(payload) is distinct from 'object'
    or not (payload ?& array['dailyTasks', 'todos', 'notes'])
    or jsonb_typeof(payload->'dailyTasks') is distinct from 'array'
    or jsonb_typeof(payload->'todos') is distinct from 'array'
    or jsonb_typeof(payload->'notes') is distinct from 'object'
    or octet_length(payload::text) > 1048576 then
    raise exception 'Invalid companion data (maximum size 1 MiB)' using errcode = '22023';
  end if;

  for entry in select value from jsonb_array_elements((payload->'dailyTasks') || (payload->'todos')) loop
    if jsonb_typeof(entry) is distinct from 'object'
      or jsonb_typeof(entry->'id') is distinct from 'string' or btrim(entry->>'id') = ''
      or jsonb_typeof(entry->'title') is distinct from 'string' or btrim(entry->>'title') = ''
      or jsonb_typeof(entry->'isCompleted') is distinct from 'boolean' then
      raise exception 'Invalid companion item' using errcode = '22023';
    end if;
  end loop;

  ids := array[]::text[];
  for entry in select value from jsonb_array_elements(payload->'dailyTasks') loop
    if entry->>'id' = any(ids) or jsonb_typeof(entry->'completionHistory') is distinct from 'array'
      or not (entry ? 'lastCompletedDate') then
      raise exception 'Invalid habit history' using errcode = '22023';
    end if;
    ids := array_append(ids, entry->>'id');
    for history_date in select value from jsonb_array_elements(entry->'completionHistory') loop
      date_text := history_date #>> '{}';
      if jsonb_typeof(history_date) is distinct from 'string' or date_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
        raise exception 'Invalid history date' using errcode = '22023';
      end if;
      perform date_text::date;
    end loop;
    if entry->'lastCompletedDate' <> 'null'::jsonb then
      date_text := entry->>'lastCompletedDate';
      if jsonb_typeof(entry->'lastCompletedDate') is distinct from 'string' or date_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
        raise exception 'Invalid habit date' using errcode = '22023';
      end if;
      perform date_text::date;
    end if;
  end loop;

  ids := array[]::text[];
  for entry in select value from jsonb_array_elements(payload->'todos') loop
    if entry->>'id' = any(ids) or jsonb_typeof(entry->'createdAt') is distinct from 'number'
      or abs((entry->>'createdAt')::numeric) > 8640000000000000 then
      raise exception 'Invalid todo date' using errcode = '22023';
    end if;
    ids := array_append(ids, entry->>'id');
  end loop;
  for note in select key, value from jsonb_each(payload->'notes') loop
    if note.key !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or jsonb_typeof(note.value) is distinct from 'string' then
      raise exception 'Invalid daily note' using errcode = '22023';
    end if;
    perform note.key::date;
  end loop;

  -- Same request may be retried after a lost HTTP acknowledgement.
  select version into saved_version from public.companion_data
    where user_id = owner_id and last_write_id = request_id and version = expected_version + 1 and data = payload;
  if found then return saved_version; end if;

  if expected_version = 0 then
    insert into public.companion_data(user_id, data, version, last_write_id)
      values (owner_id, payload, 1, request_id)
      on conflict (user_id) do nothing
      returning version into saved_version;
  else
    update public.companion_data
      set data = payload, version = version + 1, last_write_id = request_id, updated_at = now()
      where user_id = owner_id and version = expected_version
      returning version into saved_version;
  end if;
  if saved_version is null then
    -- A concurrent duplicate request may have committed while this CAS waited.
    select version into saved_version from public.companion_data
      where user_id = owner_id and last_write_id = request_id and version = expected_version + 1 and data = payload;
    if saved_version is null then
      raise exception 'Data changed in another tab or device. Export your changes before reloading.' using errcode = '40001';
    end if;
  end if;
  return saved_version;
end;
$$;

revoke all on function public.save_companion_data(uuid, jsonb, integer, uuid) from public, anon;
grant execute on function public.save_companion_data(uuid, jsonb, integer, uuid) to authenticated;
