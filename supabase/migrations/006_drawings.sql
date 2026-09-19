-- 005 다음에 실행. SQL Editor 새 쿼리 창에 붙여넣고 Run
-- 그림 메모장: 로그인한 사람만 보고 그리기, 지우기는 자기 그림만

create table public.drawings (
  id bigint generated always as identity primary key,
  -- PNG 그림을 글자(data URL)로 저장. 너무 큰 그림은 거절
  image text not null check (image like 'data:image/png;base64,%' and char_length(image) < 1500000),
  -- 누가 그렸는지는 서버가 로그인 정보로 채움
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  author_email text default (auth.jwt() ->> 'email'),
  created_at timestamptz not null default now()
);
alter table public.drawings enable row level security;

-- 로그인한 사람은 모두의 그림을 봄
create policy "logged-in read" on public.drawings for select to authenticated
  using (true);

-- 저장은 "내 이름으로"만
create policy "own insert" on public.drawings for insert to authenticated
  with check (user_id = auth.uid());

-- 지우기는 "내 그림"만
create policy "own delete" on public.drawings for delete to authenticated
  using (user_id = auth.uid());

-- 저장할 때 보낼 수 있는 칸은 image 하나뿐. 작성자 칸은 남의 이름으로 채울 수 없음
revoke insert, update on public.drawings from anon, authenticated;
grant insert (image) on public.drawings to authenticated;
grant select, delete on public.drawings to authenticated;

-- 실시간
alter publication supabase_realtime add table public.drawings;
