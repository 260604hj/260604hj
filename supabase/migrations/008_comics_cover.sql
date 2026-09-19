-- 007 다음에 실행. SQL Editor 새 쿼리 창에 붙여넣고 Run
-- 아스키 만화 표지: 영어 제목과 표지 그림 칸 추가

alter table public.comics
  add column title_en text check (char_length(title_en) <= 80),
  add column cover text check (char_length(cover) <= 600);

-- 저장할 때 보낼 수 있는 칸에 두 칸 추가 (작성자 칸은 여전히 서버가 채움)
grant insert (title_en, cover) on public.comics to authenticated;
