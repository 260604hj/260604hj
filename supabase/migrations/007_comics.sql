-- 006 다음에 실행. SQL Editor 새 쿼리 창에 붙여넣고 Run
-- 아스키 만화 저장: 그림은 이미지가 아니라 글자(텍스트)로 저장해서 한 편에 약 5KB
-- 로그인한 사람만 보고 저장, 지우기는 자기 만화만

create table public.comics (
  id bigint generated always as identity primary key,
  plot text not null check (char_length(plot) between 1 and 300),
  title text not null check (char_length(title) <= 40),
  -- [{ "art": "아스키 그림", "caption": "대사" }, ...] 8컷. 너무 큰 건 거절
  panels jsonb not null check (jsonb_typeof(panels) = 'array' and jsonb_array_length(panels) = 8
                               and octet_length(panels::text) < 60000),
  model text,
  -- 누가 만들었는지는 서버가 로그인 정보로 채움
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  author_email text default (auth.jwt() ->> 'email'),
  created_at timestamptz not null default now()
);
alter table public.comics enable row level security;

-- 로그인한 사람은 모두의 만화를 봄
create policy "logged-in read" on public.comics for select to authenticated
  using (true);

-- 저장은 "내 이름으로"만
create policy "own insert" on public.comics for insert to authenticated
  with check (user_id = auth.uid());

-- 지우기는 "내 만화"만
create policy "own delete" on public.comics for delete to authenticated
  using (user_id = auth.uid());

-- 저장할 때 보낼 수 있는 칸은 내용뿐. 작성자 칸은 남의 이름으로 채울 수 없음
revoke insert, update on public.comics from anon, authenticated;
grant insert (plot, title, panels, model) on public.comics to authenticated;
grant select, delete on public.comics to authenticated;

-- 실시간
alter publication supabase_realtime add table public.comics;
