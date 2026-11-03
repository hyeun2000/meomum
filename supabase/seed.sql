-- ================================================================
-- 머묾(meomum) 예시 데이터: 체험 계정 + 예시 공간 6곳
-- schema.sql 을 먼저 실행한 뒤 SQL Editor 에서 실행하세요.
-- 체험 계정: demo@meomum.kr / meomum1234 (공개 체험용)
-- ================================================================
do $$
declare uid uuid := gen_random_uuid();
begin
  -- 체험 계정 (이메일 인증 완료 상태로 생성)
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, email_change, email_change_token_new, recovery_token)
  values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', 'demo@meomum.kr',
    extensions.crypt('meomum1234', extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}', '{"username":"demo","display_name":"머묾 체험"}', now(), now(), '', '', '', '');
  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), uid, uid::text,
    jsonb_build_object('sub', uid::text, 'email', 'demo@meomum.kr', 'email_verified', true), 'email', now(), now(), now());

  insert into public.meomum_profiles (id, username, display_name, bio, address)
  values (uid, 'demo', '머묾 체험', '조용한 공간을 기록하는 체험 계정입니다.', '서울 종로구');

  -- 예시 공간
  insert into public.meomum_posts (user_id, place_name, category, region, address, lat, lng, caption, image_url, images, likes_count, created_at) values
  (uid, '골목 끝 서재', '카페', '서울', '서울 종로구 서촌', 37.5794, 126.9700,
   E'창가 자리에 앉으면 오후 햇살이 책장 위로 천천히 내려옵니다.\n음악도 낮고, 손님도 많지 않아서 한 시간쯤 아무 생각 없이 앉아 있었어요.',
   'https://picsum.photos/seed/meomum-a1/800/600', array['https://picsum.photos/seed/meomum-a1/800/600','https://picsum.photos/seed/meomum-a2/800/600'], 12, now() - interval '5 hours'),
  (uid, '바 한 잔', '혼술바', '서울', '서울 성동구 성수동', 37.5446, 127.0557,
   E'바 좌석이 여덟 개뿐인 작은 곳. 바텐더분이 말을 많이 걸지 않아서 좋았습니다.\n위스키 한 잔 시켜두고 하루를 돌아보기 좋은 곳.',
   'https://picsum.photos/seed/meomum-b1/800/600', array['https://picsum.photos/seed/meomum-b1/800/600'], 8, now() - interval '28 hours'),
  (uid, '아침의 테이블', '브런치카페', '부산', '부산 수영구 광안동', 35.1532, 129.1186,
   E'평일 오전 10시, 바다가 보이는 2층 구석 자리.\n테이블 간격이 넓어서 옆 사람 신경 쓰지 않고 앉아 있을 수 있어요.',
   'https://picsum.photos/seed/meomum-c1/800/600', array['https://picsum.photos/seed/meomum-c1/800/600','https://picsum.photos/seed/meomum-c2/800/600'], 21, now() - interval '50 hours'),
  (uid, '한 그릇 식당', '식당', '제주', '제주 제주시 애월읍', 33.4630, 126.3300,
   E'1인 좌석이 창을 향해 놓여 있는 국수집.\n바람 소리 들으며 천천히 먹었습니다.',
   'https://picsum.photos/seed/meomum-d1/800/600', array['https://picsum.photos/seed/meomum-d1/800/600'], 15, now() - interval '80 hours'),
  (uid, '숲 옆 카페', '카페', '강원', '강원 강릉시 사천면', 37.8270, 128.8600,
   '소나무 숲이 바로 보이는 통창. 와이파이가 없어서 오히려 좋았어요.',
   'https://picsum.photos/seed/meomum-e1/800/600', array['https://picsum.photos/seed/meomum-e1/800/600'], 30, now() - interval '130 hours'),
  (uid, '저녁의 서가', '혼술바', '경기', '경기 수원시 행궁동', 37.2850, 127.0130,
   '책을 읽으며 한 잔 할 수 있는 북바. 조명이 낮고 음악이 잔잔합니다.',
   'https://picsum.photos/seed/meomum-f1/800/600', array['https://picsum.photos/seed/meomum-f1/800/600'], 6, now() - interval '200 hours');
end $$;
