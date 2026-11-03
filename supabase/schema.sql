-- ================================================================
-- 머묾(meomum) Supabase 스키마
-- 사용법: Supabase 대시보드 > SQL Editor 에 붙여넣고 실행
-- 같은 프로젝트의 다른 앱 테이블과 섞이지 않도록 meomum_ 접두사를 사용합니다.
-- 회원 이메일·비밀번호는 Supabase Auth(auth.users)가 따로 관리합니다.
-- ================================================================

-- 1. 테이블 -------------------------------------------------------

-- 프로필 (기획서의 users 테이블)
create table public.meomum_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username ~ '^[a-zA-Z0-9_]{3,20}$'),
  display_name text not null check (char_length(display_name) between 1 and 20),
  bio text not null default '' check (char_length(bio) <= 150),
  profile_image text not null default '',
  address text not null default '' check (char_length(address) <= 60),
  created_at timestamptz not null default now()
);

-- 게시물 (공간 기록)
create table public.meomum_posts (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references public.meomum_profiles(id) on delete cascade,
  place_name text not null check (char_length(place_name) between 1 and 40),
  category text not null check (category in ('브런치카페','혼술바','식당','카페')),
  region text not null check (region in ('서울','경기','부산','강원','제주')),
  address text not null default '' check (char_length(address) <= 60),
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  caption text not null check (char_length(caption) between 1 and 2000),
  image_url text not null,
  images text[] not null default '{}' check (cardinality(images) <= 6),
  likes_count integer not null default 0 check (likes_count >= 0),
  created_at timestamptz not null default now()
);
create index meomum_posts_user_id_idx on public.meomum_posts(user_id);
create index meomum_posts_created_at_idx on public.meomum_posts(created_at desc);

-- 댓글
create table public.meomum_comments (
  id bigint generated always as identity primary key,
  post_id bigint not null references public.meomum_posts(id) on delete cascade,
  user_id uuid not null default auth.uid() references public.meomum_profiles(id) on delete cascade,
  content text not null check (char_length(content) between 1 and 300),
  created_at timestamptz not null default now()
);
create index meomum_comments_post_id_idx on public.meomum_comments(post_id);
create index meomum_comments_user_id_idx on public.meomum_comments(user_id);

-- 2. 행 단위 보안(RLS): 읽기는 누구나, 쓰기·수정·삭제는 본인 것만 --------

alter table public.meomum_profiles enable row level security;
alter table public.meomum_posts    enable row level security;
alter table public.meomum_comments enable row level security;

create policy "profiles readable" on public.meomum_profiles for select using (true);
create policy "own profile insert" on public.meomum_profiles for insert to authenticated with check (id = (select auth.uid()));
create policy "own profile update" on public.meomum_profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy "posts readable" on public.meomum_posts for select using (true);
create policy "own post insert" on public.meomum_posts for insert to authenticated with check (user_id = (select auth.uid()) and likes_count = 0);
create policy "own post delete" on public.meomum_posts for delete to authenticated using (user_id = (select auth.uid()));

create policy "comments readable" on public.meomum_comments for select using (true);
create policy "own comment insert" on public.meomum_comments for insert to authenticated with check (user_id = (select auth.uid()));
create policy "own comment delete" on public.meomum_comments for delete to authenticated using (user_id = (select auth.uid()));

-- 3. 좋아요 함수 --------------------------------------------------
-- 기획서대로 별도 테이블 없이 likes_count 만 +1 / -1 (로그인한 사람만, 이 함수로만 변경 가능)
create or replace function public.meomum_like(p_post_id bigint, p_delta int)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare new_count integer;
begin
  if (select auth.uid()) is null then raise exception 'login required'; end if;
  if p_delta not in (-1, 1) then raise exception 'invalid delta'; end if;
  update public.meomum_posts
     set likes_count = greatest(0, likes_count + p_delta)
   where id = p_post_id
  returning likes_count into new_count;
  return new_count;
end;
$$;
revoke execute on function public.meomum_like(bigint, int) from public, anon;
grant execute on function public.meomum_like(bigint, int) to authenticated;

-- 4. 사진 저장소 --------------------------------------------------
-- 공개 읽기, 본인 폴더(사용자 id)에만 업로드·조회·삭제 / 2MB, 이미지 파일만
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('meomum-photos', 'meomum-photos', true, 2097152, array['image/jpeg','image/png','image/webp']);

create policy "meomum photos upload own folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'meomum-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "meomum photos select own" on storage.objects for select to authenticated
  using (bucket_id = 'meomum-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "meomum photos delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'meomum-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
