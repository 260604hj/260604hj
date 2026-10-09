-- 009 다음에 실행. SQL Editor 새 쿼리 창에 붙여넣고 Run
-- 스틱 툰(막대 인형 웹툰): 인물 체형 라이브러리 + 이야기
-- 그림은 저장하지 않음. 브라우저가 스토리보드 JSON 을 읽어 그때그때 3D 로 그림

-- 1. 인물: 체형 숫자 7개 + 머리 모양. 로그인한 팀원 모두가 보고 꺼내 씀, 고치고 지우기는 만든 사람만
create table public.toon_characters (
  id bigint generated always as identity primary key,
  name text not null check (char_length(name) between 1 and 20),
  descr text not null default '' check (char_length(descr) <= 60),
  -- { "height": 162, "heads": 6.8, "legs": 0.5, "shoulder": 0.9, "hip": 1.05, "arm": 1, "thick": 1 }
  body jsonb not null check (jsonb_typeof(body) = 'object' and octet_length(body::text) < 400),
  hair text not null default 'short' check (hair in ('none', 'short', 'long', 'bob', 'bun', 'ponytail')),
  tone text not null default 'black' check (tone in ('black', 'gray', 'light')),
  glasses boolean not null default false,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  author_email text default (auth.jwt() ->> 'email'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.toon_characters enable row level security;

create policy "logged-in read" on public.toon_characters for select to authenticated using (true);
create policy "own insert" on public.toon_characters for insert to authenticated with check (user_id = auth.uid());
create policy "own update" on public.toon_characters for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own delete" on public.toon_characters for delete to authenticated using (user_id = auth.uid());

revoke insert, update on public.toon_characters from anon, authenticated;
grant select, delete on public.toon_characters to authenticated;
grant insert (name, descr, body, hair, tone, glasses) on public.toon_characters to authenticated;
grant update (name, descr, body, hair, tone, glasses, updated_at) on public.toon_characters to authenticated;

-- 2. 이야기: Gemini 가 짠 스토리보드(story) + 배역에 넣은 인물의 체형 사본(cast)
--    cast 를 사본으로 두는 이유: 나중에 인물을 고쳐도 지난 이야기는 그대로, Visitor 도 인물 표 없이 그릴 수 있음
create table public.toon_stories (
  id bigint generated always as identity primary key,
  plot text not null check (char_length(plot) between 1 and 300),
  title text not null check (char_length(title) <= 40),
  -- { "characters": [...], "pages": [10 페이지] }
  story jsonb not null check (jsonb_typeof(story) = 'object' and octet_length(story::text) < 120000),
  -- { "역 id": { "name", "body", "hair", "tone", "glasses", "from": 인물 id } }
  "cast" jsonb not null default '{}' check (jsonb_typeof("cast") = 'object' and octet_length("cast"::text) < 8000),
  model text,
  is_public boolean not null default false,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  author_email text default (auth.jwt() ->> 'email'),
  created_at timestamptz not null default now()
);
alter table public.toon_stories enable row level security;

create policy "logged-in read" on public.toon_stories for select to authenticated using (true);
create policy "visitor read public" on public.toon_stories for select to anon using (is_public);
create policy "own insert" on public.toon_stories for insert to authenticated with check (user_id = auth.uid());
create policy "own update" on public.toon_stories for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own delete" on public.toon_stories for delete to authenticated using (user_id = auth.uid());

revoke insert, update on public.toon_stories from anon, authenticated;
revoke select on public.toon_stories from anon;
grant select, delete on public.toon_stories to authenticated;
grant insert (plot, title, story, "cast", model) on public.toon_stories to authenticated;
grant update ("cast", is_public) on public.toon_stories to authenticated;
-- Visitor 가 읽을 수 있는 칸: 작성자(user_id, author_email)는 빼고
grant select (id, plot, title, story, "cast", model, is_public, created_at) on public.toon_stories to anon;

-- 3. 실시간
alter publication supabase_realtime add table public.toon_characters;
alter publication supabase_realtime add table public.toon_stories;
