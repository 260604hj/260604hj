-- 001_memos.sql 다음에 실행. SQL Editor 새 쿼리 창에 붙여넣고 Run
--
-- 문제: 001_memos.sql 의 규칙이 "to anon" (로그인 안 한 사람) 에게만 허락해서,
--       관리자 메모에서 로그인한 브라우저로 메모장을 열면 읽기는 빈 목록, 쓰기는 거절됨
-- 해결: 로그인한 사람(authenticated)도 똑같이 허락

drop policy "anon read"   on public.memos;
drop policy "anon insert" on public.memos;
drop policy "anon delete" on public.memos;

create policy "public read"   on public.memos for select to anon, authenticated using (true);
create policy "public insert" on public.memos for insert to anon, authenticated with check (true);
create policy "public delete" on public.memos for delete to anon, authenticated using (true);

grant select, insert, delete on public.memos to authenticated;
