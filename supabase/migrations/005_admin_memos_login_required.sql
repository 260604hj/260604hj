-- 004 다음에 실행. SQL Editor 새 쿼리 창에 붙여넣고 Run
-- 관리자 메모와 요약: "누구나 읽기" → "로그인한 사람만 읽기"
-- 쓰기(관리자만)는 그대로

drop policy "public read" on public.admin_memos;
create policy "logged-in read" on public.admin_memos for select to authenticated
  using (true);

drop policy "public read" on public.memo_summaries;
create policy "logged-in read" on public.memo_summaries for select to authenticated
  using (true);
