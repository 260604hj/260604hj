-- Supabase 대시보드 > SQL Editor 에 붙여넣고 Run

-- 1. 관리자 명단
create table public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade
);
alter table public.admins enable row level security;

-- 로그인한 사람은 "내가 명단에 있는지"만 볼 수 있음
create policy "self read" on public.admins for select to authenticated
  using (user_id = auth.uid());

grant select on public.admins to authenticated;

-- 2. 관리자 메모
create table public.admin_memos (
  id bigint generated always as identity primary key,
  content text not null check (char_length(content) between 1 and 2000),
  created_at timestamptz not null default now()
);
alter table public.admin_memos enable row level security;

-- 누구나 읽기
create policy "public read" on public.admin_memos for select to anon, authenticated
  using (true);

-- 명단에 있는 사람만 쓰기 / 지우기
create policy "admin insert" on public.admin_memos for insert to authenticated
  with check (exists (select 1 from public.admins where user_id = auth.uid()));
create policy "admin delete" on public.admin_memos for delete to authenticated
  using (exists (select 1 from public.admins where user_id = auth.uid()));

grant select on public.admin_memos to anon, authenticated;
grant insert, delete on public.admin_memos to authenticated;

-- 3. 실시간
alter publication supabase_realtime add table public.admin_memos;


-- 4. 관리자 등록
-- Authentication > Users 에서 사용자를 만든 뒤,
-- 아래 줄의 이메일을 바꾸고 이 줄만 선택해서 따로 Run (주석 기호 -- 는 지우고)
-- insert into public.admins (user_id) select id from auth.users where email = '관리자@이메일';
