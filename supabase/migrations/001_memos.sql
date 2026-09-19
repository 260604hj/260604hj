-- Supabase 대시보드 > SQL Editor 에 붙여넣고 Run

-- 1. 테이블
create table public.memos (
  id bigint generated always as identity primary key,
  content text not null check (char_length(content) between 1 and 2000),
  created_at timestamptz not null default now()
);

-- 2. 행 단위 보안(RLS): 아래 정책으로 허용한 동작만 가능
alter table public.memos enable row level security;

-- 3. 로그인 없이(anon) 읽기 / 쓰기 / 삭제 허용
create policy "anon read"   on public.memos for select to anon using (true);
create policy "anon insert" on public.memos for insert to anon with check (true);
create policy "anon delete" on public.memos for delete to anon using (true);

grant select, insert, delete on public.memos to anon;

-- 4. 실시간: 다른 기기에서 쓴 메모가 바로 보이게
alter publication supabase_realtime add table public.memos;
