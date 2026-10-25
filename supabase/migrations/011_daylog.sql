-- 010 다음에 실행. SQL Editor 새 쿼리 창에 붙여넣고 Run
-- 하루 기록(daylog): 개인 생활 기록. 본인만 읽고 쓸 수 있음 (팀원끼리도 서로 못 봄)
-- 한 줄 = 하루치 기록 하나. key 는 '2026-10-25' 같은 날짜, 또는 'settings'(즐겨찾기·로고)

create table public.daylog (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  key text not null check (key = 'settings' or key ~ '^\d{4}-\d{2}-\d{2}$'),
  -- 날짜: { "spend": [...], "goals": [...], "events": [...], "mood": {...}, "learned": [...], "thought": "" }
  -- settings: { "favs": [...], "customLogos": { id: "data:image/jpeg;base64,..." } }
  data jsonb not null default '{}' check (jsonb_typeof(data) = 'object' and octet_length(data::text) < 400000),
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);
alter table public.daylog enable row level security;

create policy "own read" on public.daylog for select to authenticated using (user_id = auth.uid());
create policy "own insert" on public.daylog for insert to authenticated with check (user_id = auth.uid());
create policy "own update" on public.daylog for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own delete" on public.daylog for delete to authenticated using (user_id = auth.uid());

revoke all on public.daylog from anon;
grant select, insert, update, delete on public.daylog to authenticated;

-- 실시간: 폰에서 적으면 PC 화면도 바로 바뀜 (본인 줄만 전달됨)
alter publication supabase_realtime add table public.daylog;
