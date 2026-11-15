-- Викторина: схема Supabase. Вставить ЦЕЛИКОМ в SQL Editor и нажать Run.
-- ВАЖНО: поменяйте PIN организатора в строке с admin_secret ниже.

create table if not exists game (id int primary key check (id = 1), started_at timestamptz);
insert into game (id) values (1) on conflict do nothing;

create table if not exists players (
  id uuid primary key,
  team int not null check (team in (1, 2)),
  created_at timestamptz not null default now()
);

create table if not exists votes (
  q int not null check (q between 0 and 29),
  player_id uuid not null references players(id) on delete cascade,
  team int not null check (team in (1, 2)),
  choice int not null check (choice between 0 and 3),
  updated_at timestamptz not null default now(),
  primary key (q, player_id)          -- один участник = один голос на вопрос
);

create table if not exists admin_secret (pin text not null);
delete from admin_secret where true;
insert into admin_secret (pin) values ('my-secret-2527');   -- ← ПОМЕНЯЙТЕ ПИН

alter table game enable row level security;
alter table players enable row level security;
alter table votes enable row level security;
alter table admin_secret enable row level security;   -- без политик: снаружи недоступна

drop policy if exists "read game" on game;       create policy "read game" on game for select using (true);
drop policy if exists "read players" on players; create policy "read players" on players for select using (true);
drop policy if exists "read votes" on votes;     create policy "read votes" on votes for select using (true);
-- Записи напрямую в таблицы нет: писать можно только через функции ниже.

create or replace function server_now() returns timestamptz
language sql stable as $$ select now() $$;

create or replace function join_game(p_id uuid, p_team int) returns int
language plpgsql security definer set search_path = public as $$
declare t int;
begin
  if p_team not in (1, 2) then raise exception 'bad team'; end if;
  insert into players (id, team) values (p_id, p_team) on conflict (id) do nothing;
  select team into t from players where id = p_id;   -- команда не меняется после выбора
  return t;
end $$;

-- Голос принимается только в 20-секундное окно текущего вопроса по времени сервера.
create or replace function cast_vote(p_player uuid, p_q int, p_choice int) returns boolean
language plpgsql security definer set search_path = public as $$
declare st timestamptz; el double precision; t int;
begin
  if p_q not between 0 and 29 or p_choice not between 0 and 3 then return false; end if;
  select started_at into st from game where id = 1;
  if st is null then return false; end if;
  el := extract(epoch from (now() - st));
  if el < 0 or p_q <> floor(el / 25) or (el - p_q * 25) >= 20 then return false; end if;
  select team into t from players where id = p_player;
  if t is null then return false; end if;
  insert into votes (q, player_id, team, choice) values (p_q, p_player, t, p_choice)
  on conflict (q, player_id) do update set choice = excluded.choice, updated_at = now();
  return true;
end $$;

create or replace function get_tally() returns table (q int, team int, choice int, n bigint)
language sql stable security definer set search_path = public as $$
  select q, team, choice, count(*) from votes group by q, team, choice $$;

create or replace function start_game(p_pin text) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare st timestamptz;
begin
  if p_pin is distinct from (select pin from admin_secret limit 1) then raise exception 'wrong pin'; end if;
  delete from votes where true;
  st := now() + interval '5 seconds';
  update game set started_at = st where id = 1;
  return st;
end $$;

create or replace function reset_game(p_pin text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_pin is distinct from (select pin from admin_secret limit 1) then raise exception 'wrong pin'; end if;
  delete from votes where true;
  update game set started_at = null where id = 1;
end $$;

-- Реальное время для голосов и старта игры
alter publication supabase_realtime add table game, votes;
