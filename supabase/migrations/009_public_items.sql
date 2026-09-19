-- 008 다음에 실행. SQL Editor 새 쿼리 창에 붙여넣고 Run
-- Admin 에서 "공개"로 표시한 글·그림·만화를 Visitor(로그인 안 한 사람)에게 보여주기

-- 1. 공개 여부 칸 (기본은 비공개)
alter table public.admin_memos add column is_public boolean not null default false;
alter table public.drawings    add column is_public boolean not null default false;
alter table public.comics      add column is_public boolean not null default false;

-- 2. Visitor 는 공개된 것만 읽기
create policy "visitor read public" on public.admin_memos for select to anon using (is_public);
create policy "visitor read public" on public.drawings    for select to anon using (is_public);
create policy "visitor read public" on public.comics      for select to anon using (is_public);

-- Visitor 가 읽을 수 있는 칸: 작성자(user_id, author_email)는 빼고
revoke select on public.admin_memos, public.drawings, public.comics from anon;
grant select (id, content, is_public, created_at) on public.admin_memos to anon;
grant select (id, image, is_public, created_at) on public.drawings to anon;
grant select (id, plot, title, title_en, cover, panels, model, is_public, created_at) on public.comics to anon;

-- 3. 공개/비공개 바꾸기: 바꿀 수 있는 칸은 is_public 하나뿐
revoke update on public.admin_memos, public.drawings, public.comics from anon, authenticated;
grant update (is_public) on public.admin_memos, public.drawings, public.comics to authenticated;

-- 글은 관리자만
create policy "admin update" on public.admin_memos for update to authenticated
  using (exists (select 1 from public.admins where user_id = auth.uid()))
  with check (exists (select 1 from public.admins where user_id = auth.uid()));

-- 그림·만화는 만든 본인만
create policy "own update" on public.drawings for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own update" on public.comics for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
