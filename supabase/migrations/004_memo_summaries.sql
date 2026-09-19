-- 003 다음에 실행. SQL Editor 새 쿼리 창에 붙여넣고 Run
-- 관리자 메모 요약을 저장해서, 가장 최근 요약을 누구나 볼 수 있게

create table public.memo_summaries (
  id bigint generated always as identity primary key,
  content text not null,
  model text,
  created_at timestamptz not null default now()
);
alter table public.memo_summaries enable row level security;

-- 누구나 읽기
create policy "public read" on public.memo_summaries for select to anon, authenticated
  using (true);

-- 관리자 명단에 있는 사람만 저장 (summarize 함수가 관리자의 로그인 정보로 저장함)
create policy "admin insert" on public.memo_summaries for insert to authenticated
  with check (exists (select 1 from public.admins where user_id = auth.uid()));

grant select on public.memo_summaries to anon, authenticated;
grant insert on public.memo_summaries to authenticated;

-- 실시간: 새 요약이 생기면 열려 있는 화면에 바로 반영
alter publication supabase_realtime add table public.memo_summaries;
