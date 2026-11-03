/* ================================================================
   머묾 (Meomum) — Supabase 연결 버전
   · 글·댓글·프로필·사진이 Supabase(온라인 DB)에 저장되어 모든 사용자가 함께 봅니다.
   · 아래 공개 키(publishable key)는 브라우저에 노출되어도 되는 키입니다.
     실제 보안은 DB의 RLS(행 단위 보안) 규칙이 지킵니다. (본인 글만 수정·삭제 가능)
   ================================================================ */

const SUPABASE_URL = 'https://ostkjigedpymimjyppmd.supabase.co';
const SUPABASE_KEY = 'sb_publishable_soDzr4A6SeQbErHcQh4x4Q_n5HXiVc3';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const T = { profiles: 'meomum_profiles', posts: 'meomum_posts', comments: 'meomum_comments' };
const BUCKET = 'meomum-photos';
const DEMO = { email: 'demo@meomum.kr', password: 'meomum1234' };   // 누구나 써보는 공개 체험 계정
const POST_SELECT = '*, author:meomum_profiles(display_name, username, profile_image), meomum_comments(count)';

const CATEGORIES = [
  { key: '브런치카페', ico: '🥐' },
  { key: '혼술바',     ico: '🥃' },
  { key: '식당',       ico: '🍲' },
  { key: '카페',       ico: '☕' },
];
const REGIONS = [
  { key: '서울', center: [37.5665, 126.9780], zoom: 12 },
  { key: '경기', center: [37.4138, 127.0183], zoom: 9 },
  { key: '부산', center: [35.1631, 129.0950], zoom: 12 },
  { key: '강원', center: [37.7519, 128.8761], zoom: 9 },
  { key: '제주', center: [33.4100, 126.5500], zoom: 10 },
];
const KOREA = { center: [36.3, 127.8], zoom: 7 };

/* ---------- 1. 로그인 상태 ---------- */
let authUser = null;   // Supabase 로그인 정보 (이메일 등)
let profile = null;    // meomum_profiles 의 내 프로필

async function loadProfile() {
  if (!authUser) { profile = null; return; }
  const { data } = await sb.from(T.profiles).select('*').eq('id', authUser.id).maybeSingle();
  if (data) { profile = data; return; }

  // 처음 로그인한 사람은 프로필을 자동으로 만들어 줍니다 (가입 때 입력한 이름·아이디 사용)
  const meta = authUser.user_metadata || {};
  let username = /^[a-zA-Z0-9_]{3,20}$/.test(meta.username || '') ? meta.username
    : (authUser.email.split('@')[0].replace(/[^a-zA-Z0-9_]/g, '') + '_____').slice(0, 12);
  const display_name = (meta.display_name || authUser.email.split('@')[0]).slice(0, 20);
  for (let i = 0; i < 3; i++) {
    const { data: created, error } = await sb.from(T.profiles)
      .insert({ id: authUser.id, username, display_name }).select().single();
    if (!error) { profile = created; return; }
    username = (username.slice(0, 14) + '_' + Math.floor(Math.random() * 9999)).slice(0, 20); // 아이디 중복이면 숫자를 붙여 재시도
  }
  toast('프로필을 만들지 못했어요. 새로고침 해주세요.');
}

/* 좋아요 누른 글 기억 (기획서대로 별도 테이블 없이 likes_count 만 사용하므로, 누른 기록은 이 기기에 저장) */
const likedKey = () => `meomum_liked_${authUser?.id}`;
function getLiked() { try { return JSON.parse(localStorage.getItem(likedKey()) || '[]'); } catch { return []; } }
function setLiked(list) { try { localStorage.setItem(likedKey(), JSON.stringify(list)); } catch {} }

/* ---------- 2. 작은 도우미 함수들 ---------- */
const $ = sel => document.querySelector(sel);
const app = $('#app');

function esc(s = '') {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function timeAgo(iso) {
  const diff = (Date.now() - new Date(iso)) / 1000;
  if (diff < 60) return '방금 전';
  if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}일 전`;
  return fmtDate(iso);
}
function fmtDate(iso, withTime = false) {
  const d = new Date(iso);
  const p = n => String(n).padStart(2, '0');
  const base = `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`;
  return withTime ? `${base} ${p(d.getHours())}:${p(d.getMinutes())}` : base;
}
function avatarHTML(user, cls = '') {
  if (!user) return `<span class="avatar ${cls}">?</span>`;
  return user.profile_image
    ? `<img class="avatar ${cls}" src="${esc(user.profile_image)}" alt="">`
    : `<span class="avatar ${cls}">${esc((user.display_name || '?').slice(0, 1))}</span>`;
}
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}
const catIcon = key => (CATEGORIES.find(c => c.key === key) || {}).ico || '📍';
const commentCount = p => p.meomum_comments?.[0]?.count ?? 0;
const loading = (msg = '불러오는 중…') => { app.innerHTML = `<div class="loading">${msg}</div>`; };
const errorView = msg => { app.innerHTML = `<div class="page"><div class="empty"><div class="ico">⚠️</div>${esc(msg)}</div></div>`; };

/* 버튼을 누른 동안 잠그기 (중복 클릭 방지) */
async function busy(btn, fn) {
  const label = btn.textContent;
  btn.disabled = true; btn.textContent = '잠시만요…';
  try { return await fn(); }
  finally { if (btn.isConnected) { btn.disabled = false; btn.textContent = label; } }
}

/* 사진을 작게 줄여서 Blob(파일 조각)으로 만들기 → 업로드 용량 절약 */
function resizeImage(file, max = 1200) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const im = new Image();
    im.onload = () => {
      const scale = Math.min(1, max / Math.max(im.width, im.height));
      const c = document.createElement('canvas');
      c.width = Math.round(im.width * scale); c.height = Math.round(im.height * scale);
      c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob(b => b ? resolve(b) : reject(new Error('변환 실패')), 'image/jpeg', 0.8);
    };
    im.onerror = () => { URL.revokeObjectURL(url); reject(new Error('이미지 읽기 실패')); };
    im.src = url;
  });
}

/* 사진을 Supabase Storage 에 올리고 공개 주소 받기 (내 사용자 id 폴더에 저장) */
async function uploadPhoto(blob, prefix = 'post') {
  const path = `${authUser.id}/${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  const { error } = await sb.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg' });
  if (error) throw error;
  return sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}
/* 내 저장소에 있는 사진이면 삭제 (글 삭제 시 정리) */
async function removePhotos(urls) {
  const marker = `/storage/v1/object/public/${BUCKET}/`;
  const paths = urls.filter(u => u.includes(marker)).map(u => decodeURIComponent(u.split(marker)[1]));
  if (paths.length) await sb.storage.from(BUCKET).remove(paths);
}

/* 지도 만들기 (Leaflet + OpenStreetMap) */
let maps = [];
function makeMap(el, center, zoom) {
  if (!el) return null;
  if (typeof L === 'undefined') { el.innerHTML = '<div class="empty">지도를 불러오지 못했어요 (인터넷 연결 확인)</div>'; return null; }
  const m = L.map(el).setView(center, zoom);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(m);
  maps.push(m);
  return m;
}
const pin = () => L.divIcon({
  className: '', iconSize: [28, 28], iconAnchor: [14, 28],
  html: '<div style="width:28px;height:28px;border-radius:50% 50% 50% 0;background:#6A5A8C;transform:rotate(-45deg);border:3px solid #F3EEE2;box-shadow:0 2px 6px rgba(0,0,0,.3)"></div>'
});

/* 공간 카드 HTML */
function postCard(p) {
  return `
    <a class="card post-card" href="#/post/${p.id}">
      <img class="thumb" src="${esc(p.image_url)}" alt="${esc(p.place_name)}" loading="lazy">
      <div class="body">
        <span class="tag">${catIcon(p.category)} ${esc(p.category)}</span>
        <span class="faint">· ${esc(p.region)}</span>
        <h3>${esc(p.place_name)}</h3>
        <p>${esc(p.caption)}</p>
        <div class="meta"><span>♡ ${p.likes_count}</span><span>💬 ${commentCount(p)}</span><span>${timeAgo(p.created_at)}</span></div>
      </div>
    </a>`;
}

/* 화면 전환 중 이전 요청 결과가 늦게 도착해 화면을 덮어쓰지 않도록 하는 번호표 */
let renderSeq = 0;
const stale = seq => seq !== renderSeq;

/* ================================================================
   3. 페이지들
   ================================================================ */

/* ---------- [1] 로그인 / 회원가입 ---------- */
function renderAuth(mode = 'login') {
  app.innerHTML = `
    <div class="auth">
      <div class="auth-logo"><h1>머묾</h1><p>생각이 머무는 자리</p></div>
      <div class="seg">
        <button data-mode="login"  class="${mode === 'login' ? 'active' : ''}">로그인</button>
        <button data-mode="signup" class="${mode === 'signup' ? 'active' : ''}">회원가입</button>
      </div>
      <form id="authForm" novalidate>
        ${mode === 'signup' ? `
          <div class="field"><label>이름 (프로필에 보이는 이름)</label><input class="input" name="display_name" maxlength="20"></div>
          <div class="field"><label>아이디 (@ 뒤에 표시)</label><input class="input" name="username" maxlength="20" placeholder="영문·숫자 3~20자"></div>` : ''}
        <div class="field"><label>이메일</label><input class="input" type="email" name="email" autocomplete="email"></div>
        <div class="field"><label>비밀번호</label><input class="input" type="password" name="password" autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}" placeholder="${mode === 'signup' ? '6자 이상' : ''}"></div>
        <button class="btn btn-primary btn-block" type="submit">${mode === 'login' ? '로그인' : '가입하기'}</button>
      </form>
      <div class="or">간편 로그인</div>
      <div class="sns">
        <button class="btn kakao" data-sns="카카오">카카오로 시작하기</button>
        <button class="btn naver" data-sns="네이버">네이버로 시작하기</button>
        <button class="btn google" data-sns="Google">Google로 시작하기</button>
      </div>
      <button class="btn btn-ghost btn-block" id="demoLogin" style="margin-top:20px">👀 가입 없이 체험 계정으로 둘러보기</button>
      <p class="hint">체험용 계정: ${DEMO.email} / ${DEMO.password}</p>
    </div>`;

  app.querySelectorAll('.seg button').forEach(b => b.onclick = () => renderAuth(b.dataset.mode));
  // SNS 로그인은 각 회사(카카오·네이버·구글) 개발자 키를 Supabase 에 등록해야 동작합니다
  app.querySelectorAll('[data-sns]').forEach(b => b.onclick = () => toast(`${b.dataset.sns} 로그인은 준비 중이에요. 이메일로 이용해주세요.`));
  // 체험 계정 버튼: 이메일·비밀번호를 입력하지 않아도 바로 로그인
  $('#demoLogin').onclick = e => busy(e.currentTarget, async () => {
    const { error } = await sb.auth.signInWithPassword(DEMO);
    if (error) toast('체험 계정 로그인에 실패했어요. 잠시 후 다시 시도해주세요.');
  });

  $('#authForm').onsubmit = e => {
    e.preventDefault();
    const btn = e.target.querySelector('[type=submit]');
    const f = Object.fromEntries(new FormData(e.target));
    f.email = f.email.trim().toLowerCase();
    busy(btn, async () => {
      if (mode === 'login') {
        const { error } = await sb.auth.signInWithPassword({ email: f.email, password: f.password });
        if (error) {
          if (/confirm/i.test(error.message)) return toast('이메일 인증을 먼저 완료해주세요.');
          if (f.email === DEMO.email) return toast(`체험 계정 비밀번호는 ${DEMO.password} 예요.`);
          return toast('이메일 또는 비밀번호를 확인해주세요.');
        }
        // 로그인 성공 → onAuthStateChange 가 화면을 이동시킵니다
      } else {
        if (!f.display_name.trim() || !f.email) return toast('모든 칸을 채워주세요.');
        if (!/^[a-zA-Z0-9_]{3,20}$/.test(f.username)) return toast('아이디는 영문·숫자 3~20자로 입력해주세요.');
        if (f.password.length < 6) return toast('비밀번호는 6자 이상으로 해주세요.');
        const { data: taken } = await sb.from(T.profiles).select('id').eq('username', f.username).maybeSingle();
        if (taken) return toast('이미 사용 중인 아이디예요.');
        const { data, error } = await sb.auth.signUp({
          email: f.email, password: f.password,
          options: { data: { username: f.username, display_name: f.display_name.trim() },
                     emailRedirectTo: location.origin + location.pathname },
        });
        if (error) return toast(/registered|exists/i.test(error.message) ? '이미 가입된 이메일이에요.' : `가입 실패: ${error.message}`);
        if (!data.session) {
          toast('인증 메일을 보냈어요. 메일의 링크를 누른 뒤 로그인해주세요.');
          renderAuth('login');
        }
      }
    });
  };
}

/* ---------- [2] 홈: 지역별 사색의 공간 ---------- */
let homeRegion = '전체';
const QUOTES = [
  '혼자 있는 시간은 나를 다시 만나는 시간이다.',
  '조용한 곳에서야 비로소 마음의 소리가 들린다.',
  '서두르지 않아도 괜찮은 자리가 있다.',
];
async function renderHome(seq) {
  loading();
  let q = sb.from(T.posts).select(POST_SELECT).order('created_at', { ascending: false }).limit(50);
  if (homeRegion !== '전체') q = q.eq('region', homeRegion);
  const [{ data: posts, error }, { data: popular }] = await Promise.all([
    q, sb.from(T.posts).select(POST_SELECT).order('likes_count', { ascending: false }).limit(3),
  ]);
  if (stale(seq)) return;
  if (error) return errorView('공간을 불러오지 못했어요. 잠시 후 다시 시도해주세요.');

  app.innerHTML = `
    <div class="page">
      <h1 class="page-title">${esc(profile.display_name)}님,<br>오늘은 어디에 머물까요?</h1>
      <p class="page-sub">붐비지 않아도, 나다운 공간들</p>
      <div class="quote">${QUOTES[new Date().getDate() % QUOTES.length]}<span>— 머묾의 문장</span></div>

      <h2 class="section-title">지역별 사색의 공간</h2>
      <div class="chips" id="regionChips">
        ${['전체', ...REGIONS.map(r => r.key)].map(r =>
          `<button class="chip ${r === homeRegion ? 'active' : ''}" data-r="${r}">${r}</button>`).join('')}
      </div>
      <div class="map" id="homeMap"></div>
      <p class="faint" style="margin:8px 2px 0">핀을 누르면 공간 정보를 볼 수 있어요 · ${posts.length}곳</p>

      <h2 class="section-title">${homeRegion === '전체' ? '새로 기록된 공간' : homeRegion + '의 공간'}<a href="#/list${homeRegion === '전체' ? '' : '?region=' + encodeURIComponent(homeRegion)}">모두 보기</a></h2>
      ${posts.length ? `<div class="h-scroll">${posts.slice(0, 10).map(postCard).join('')}</div>`
        : `<div class="empty"><div class="ico">🌙</div>아직 이 지역에 기록된 공간이 없어요.<br><a href="#/write" style="color:var(--purple)">첫 기록 남기기 →</a></div>`}

      <h2 class="section-title">어떤 공간이 필요하세요?</h2>
      <div class="cat-grid">
        ${CATEGORIES.map(c => `<a href="#/list?cat=${encodeURIComponent(c.key)}"><span class="ico">${c.ico}</span>${c.key}</a>`).join('')}
      </div>

      <h2 class="section-title">많이 머문 공간</h2>
      <div class="post-list">${(popular || []).map(postCard).join('')}</div>
    </div>`;

  app.querySelectorAll('#regionChips .chip').forEach(b => b.onclick = () => { homeRegion = b.dataset.r; route(); });

  const r = REGIONS.find(r => r.key === homeRegion) || KOREA;
  const m = makeMap($('#homeMap'), r.center, r.zoom);
  if (!m) return;
  posts.forEach(p => L.marker([p.lat, p.lng], { icon: pin() }).addTo(m)
    .bindPopup(`<b>${esc(p.place_name)}</b><br>${catIcon(p.category)} ${esc(p.category)}<br><a href="#/post/${p.id}">기록 보기 →</a>`));
  if (posts.length > 1 && homeRegion !== '전체') m.fitBounds(posts.map(p => [p.lat, p.lng]), { padding: [40, 40], maxZoom: 14 });
}

/* ---------- [3] 게시물(공간) 목록 ---------- */
async function renderList(seq, params) {
  const cat = params.get('cat') || '전체';
  const region = params.get('region') || '전체';
  const sort = params.get('sort') || 'new';
  const kw = (params.get('q') || '').trim();

  loading();
  let q = sb.from(T.posts).select(POST_SELECT).limit(100)
    .order(sort === 'like' ? 'likes_count' : 'created_at', { ascending: false });
  if (cat !== '전체') q = q.eq('category', cat);
  if (region !== '전체') q = q.eq('region', region);
  const { data, error } = await q;
  if (stale(seq)) return;
  if (error) return errorView('공간을 불러오지 못했어요.');
  const posts = kw ? data.filter(p => (p.place_name + p.caption + p.address).includes(kw)) : data;

  const link = changes => {
    const p = new URLSearchParams(params); Object.entries(changes).forEach(([k, v]) => p.set(k, v));
    return '#/list?' + p.toString();
  };

  app.innerHTML = `
    <div class="page">
      <h1 class="page-title">공간 둘러보기</h1>
      <p class="page-sub">사진과 이용후기로 만나는 조용한 공간들</p>
      <form id="searchForm" style="margin-bottom:14px">
        <input class="input" name="q" placeholder="🔍 공간 이름, 동네로 찾기" value="${esc(kw)}">
      </form>
      <div class="chips">
        ${['전체', ...CATEGORIES.map(c => c.key)].map(c =>
          `<a class="chip ${c === cat ? 'active' : ''}" style="display:grid;place-items:center" href="${link({ cat: c })}">${c === '전체' ? '전체' : catIcon(c) + ' ' + c}</a>`).join('')}
      </div>
      <div class="row" style="margin:8px 0 16px">
        <select class="select" id="regionSel">
          ${['전체', ...REGIONS.map(r => r.key)].map(r => `<option ${r === region ? 'selected' : ''} value="${r}">${r === '전체' ? '모든 지역' : r}</option>`).join('')}
        </select>
        <select class="select" id="sortSel">
          <option value="new" ${sort === 'new' ? 'selected' : ''}>최신순</option>
          <option value="like" ${sort === 'like' ? 'selected' : ''}>좋아요순</option>
        </select>
      </div>
      ${posts.length ? `<div class="post-list">${posts.map(postCard).join('')}</div>`
        : `<div class="empty"><div class="ico">🍃</div>조건에 맞는 공간이 없어요.</div>`}
    </div>`;

  $('#regionSel').onchange = e => go(link({ region: e.target.value }));
  $('#sortSel').onchange = e => go(link({ sort: e.target.value }));
  $('#searchForm').onsubmit = e => { e.preventDefault(); go(link({ q: e.target.q.value.trim() })); };
}

/* ---------- [4] 게시물 상세 (사진·후기·좋아요·댓글·지도) ---------- */
async function renderDetail(seq, id, { keepScroll = false } = {}) {
  if (!keepScroll) loading();
  const [{ data: p, error }, { data: comments }] = await Promise.all([
    sb.from(T.posts).select(POST_SELECT).eq('id', id).maybeSingle(),
    sb.from(T.comments).select('*, author:meomum_profiles(display_name, username, profile_image)')
      .eq('post_id', id).order('created_at', { ascending: true }),
  ]);
  if (stale(seq)) return;
  if (error) return errorView('기록을 불러오지 못했어요.');
  if (!p) return errorView('존재하지 않거나 삭제된 기록이에요.');

  const scrollY = window.scrollY;
  maps.forEach(m => m.remove()); maps = [];
  const liked = getLiked().includes(p.id);
  const images = p.images?.length ? p.images : [p.image_url];
  const isMine = p.user_id === authUser.id;

  app.innerHTML = `
    <div class="page">
      <div class="gallery" id="gallery">${images.map(src => `<img src="${esc(src)}" alt="">`).join('')}</div>
      ${images.length > 1 ? `<div class="gallery-count" id="galleryCount">1 / ${images.length} · 옆으로 넘겨보세요</div>` : ''}

      <div style="margin-top:16px">
        <span class="tag">${catIcon(p.category)} ${esc(p.category)}</span>
        <span class="faint">· ${esc(p.address || p.region)}</span>
      </div>
      <h1 class="detail-title">${esc(p.place_name)}</h1>

      <div class="author">
        ${avatarHTML(p.author)}
        <div><b>${esc(p.author?.display_name || '알 수 없음')}</b><span class="faint">@${esc(p.author?.username || '')} · ${fmtDate(p.created_at, true)}</span></div>
      </div>

      <p class="caption">${esc(p.caption)}</p>

      <div style="display:flex;gap:10px;align-items:center;margin:24px 0;flex-wrap:wrap">
        <button class="like-btn ${liked ? 'on' : ''}" id="likeBtn">${liked ? '♥' : '♡'} 좋아요 <span id="likeNum">${p.likes_count}</span></button>
        <button class="like-btn" id="shareBtn">↗ 공유</button>
        ${isMine ? `<button class="btn btn-danger" id="delPost" style="margin-left:auto">삭제</button>` : ''}
      </div>

      <h2 class="section-title">위치</h2>
      <div class="map sm" id="detailMap"></div>
      <p class="faint" style="margin:8px 2px 0">📍 ${esc(p.address || '')}</p>

      <h2 class="section-title">머문 이야기 ${comments?.length || 0}</h2>
      <div id="comments">
        ${comments?.length ? comments.map(c => `
          <div class="comment">
            ${avatarHTML(c.author)}
            <div class="comment-body">
              <b style="font-size:14px">${esc(c.author?.display_name || '알 수 없음')}</b>
              <span class="faint">${timeAgo(c.created_at)}</span>
              <p>${esc(c.content)}</p>
            </div>
            ${c.user_id === authUser.id ? `<button class="comment-del" data-cid="${c.id}">삭제</button>` : ''}
          </div>`).join('') : '<p class="faint">첫 번째 이야기를 남겨주세요.</p>'}
      </div>
      <form class="comment-form" id="commentForm">
        <input class="input" name="content" placeholder="이 공간에 대한 생각을 나눠주세요" maxlength="300" autocomplete="off">
        <button class="btn btn-primary" type="submit">등록</button>
      </form>
    </div>`;
  if (keepScroll) window.scrollTo(0, scrollY);

  const gal = $('#gallery'), gc = $('#galleryCount');
  if (gc) gal.onscroll = () => { gc.textContent = `${Math.round(gal.scrollLeft / gal.clientWidth) + 1} / ${images.length}`; };

  // 좋아요 (이 기기에서 한 번, 다시 누르면 취소)
  $('#likeBtn').onclick = async e => {
    const btn = e.currentTarget;
    if (btn.disabled) return;
    btn.disabled = true;
    const list = getLiked();
    const on = list.includes(p.id);
    const { data: count, error } = await sb.rpc('meomum_like', { p_post_id: p.id, p_delta: on ? -1 : 1 });
    btn.disabled = false;
    if (error) return toast('좋아요를 반영하지 못했어요.');
    setLiked(on ? list.filter(x => x !== p.id) : [...list, p.id]);
    btn.classList.toggle('on', !on);
    btn.innerHTML = `${on ? '♡' : '♥'} 좋아요 <span id="likeNum">${count ?? 0}</span>`;
  };
  $('#shareBtn').onclick = async () => {
    const url = location.href;
    try {
      if (navigator.share) await navigator.share({ title: p.place_name, url });
      else { await navigator.clipboard.writeText(url); toast('링크를 복사했어요.'); }
    } catch {}
  };
  const del = $('#delPost');
  if (del) del.onclick = () => {
    if (!del.dataset.confirm) { del.dataset.confirm = '1'; del.textContent = '정말 삭제할까요?'; return; }
    busy(del, async () => {
      const { error } = await sb.from(T.posts).delete().eq('id', p.id);
      if (error) return toast('삭제하지 못했어요.');
      removePhotos(images).catch(() => {});
      toast('기록을 삭제했어요.'); go('#/list');
    });
  };

  $('#commentForm').onsubmit = e => {
    e.preventDefault();
    const content = e.target.content.value.trim();
    if (!content) return;
    busy(e.target.querySelector('button'), async () => {
      const { error } = await sb.from(T.comments).insert({ post_id: p.id, user_id: authUser.id, content });
      if (error) return toast('댓글을 등록하지 못했어요.');
      await renderDetail(seq, id, { keepScroll: true });
    });
  };
  app.querySelectorAll('.comment-del').forEach(b => b.onclick = () => busy(b, async () => {
    const { error } = await sb.from(T.comments).delete().eq('id', Number(b.dataset.cid));
    if (error) return toast('삭제하지 못했어요.');
    await renderDetail(seq, id, { keepScroll: true });
  }));

  const m = makeMap($('#detailMap'), [p.lat, p.lng], 15);
  if (m) L.marker([p.lat, p.lng], { icon: pin() }).addTo(m);
}

/* ---------- [5] 게시물 작성 ---------- */
function renderWrite(seq) {
  // photos: { preview: 화면용 주소, blob?: 내 사진 파일, url?: 추천 이미지 주소 }
  const draft = { photos: [], lat: null, lng: null };
  const MAX = 6;

  app.innerHTML = `
    <div class="page">
      <h1 class="page-title">공간 기록하기</h1>
      <p class="page-sub">머물렀던 곳의 느낌을 남겨주세요</p>

      <div class="write-meta">
        <div style="display:flex;gap:10px;align-items:center">${avatarHTML(profile)}<div><b>${esc(profile.display_name)}</b><div class="faint">@${esc(profile.username)}</div></div></div>
        <div class="faint" style="text-align:right">작성 시간<br><b id="clock" style="color:var(--ink)">${fmtDate(new Date().toISOString(), true)}</b></div>
      </div>

      <form id="writeForm" novalidate>
        <div class="field"><label>공간 이름 *</label><input class="input" name="place_name" maxlength="40" placeholder="예) 골목 끝 서재"></div>
        <div class="row">
          <div class="field"><label>종류 *</label>
            <select class="select" name="category">${CATEGORIES.map(c => `<option>${c.key}</option>`).join('')}</select></div>
          <div class="field"><label>지역 *</label>
            <select class="select" name="region" id="regionInput">${REGIONS.map(r => `<option>${r.key}</option>`).join('')}</select></div>
        </div>
        <div class="field"><label>주소 / 동네</label><input class="input" name="address" maxlength="60" placeholder="예) 서울 종로구 서촌"></div>

        <div class="field">
          <label>위치 * <span class="faint">— 지도를 눌러 핀을 꽂아주세요</span></label>
          <div class="map sm" id="writeMap"></div>
          <div class="row" style="margin-top:8px"><button type="button" class="btn btn-ghost" id="myLocBtn">📍 현재 위치 사용</button></div>
          <p class="faint" id="locText" style="margin:6px 2px 0">아직 위치가 선택되지 않았어요.</p>
        </div>

        <div class="field"><label>이용 후기 *</label>
          <textarea class="textarea" name="caption" maxlength="2000" placeholder="어떤 시간이었나요? 분위기, 소리, 자리, 떠오른 생각들…"></textarea></div>

        <div class="field">
          <label>사진 첨부 * <span class="faint">(최대 ${MAX}장, 첫 사진이 대표 사진)</span></label>
          <div class="photo-grid" id="photoGrid"></div>
          <input type="file" accept="image/*" multiple id="fileInput" hidden>
          <button type="button" class="btn btn-ghost btn-block" id="openPicker" style="margin-top:10px">🖼 추천 이미지에서 고르기</button>
          <div class="picker" id="picker" hidden>
            <div class="muted">마음에 드는 이미지를 누르세요</div>
            <div class="picker-grid" id="pickerGrid"></div>
            <button type="button" class="btn btn-ghost btn-block" id="refreshPicker">↻ 다른 이미지 보기</button>
          </div>
        </div>

        <button class="btn btn-primary btn-block" type="submit" style="margin-top:12px">기록 올리기</button>
      </form>
    </div>`;

  const clockTimer = setInterval(() => {
    const c = $('#clock'); if (!c || stale(seq)) return clearInterval(clockTimer);
    c.textContent = fmtDate(new Date().toISOString(), true);
  }, 15000);

  function drawPhotos() {
    $('#photoGrid').innerHTML =
      draft.photos.map((ph, i) => `<div class="slot"><img src="${esc(ph.preview)}" alt=""><button type="button" data-i="${i}" aria-label="사진 삭제">✕</button></div>`).join('') +
      (draft.photos.length < MAX ? `<button type="button" class="photo-add" id="addPhoto">＋<br>내 사진</button>` : '');
    $('#photoGrid').querySelectorAll('.slot button').forEach(b => b.onclick = () => {
      const [ph] = draft.photos.splice(+b.dataset.i, 1);
      if (ph.blob) URL.revokeObjectURL(ph.preview);
      drawPhotos();
    });
    const add = $('#addPhoto'); if (add) add.onclick = () => $('#fileInput').click();
  }
  drawPhotos();
  $('#fileInput').onchange = async e => {
    const files = [...e.target.files].slice(0, MAX - draft.photos.length);
    for (const f of files) {
      try { const blob = await resizeImage(f); draft.photos.push({ blob, preview: URL.createObjectURL(blob) }); }
      catch { toast('사진을 읽지 못했어요.'); }
    }
    e.target.value = ''; drawPhotos();
  };

  // 추천 이미지 (기획서의 "랜덤 이미지 여러 개 보여주고 고르기" 단계)
  function fillPicker() {
    const r = Math.random().toString(36).slice(2, 7);
    $('#pickerGrid').innerHTML = Array.from({ length: 6 }, (_, i) =>
      `<img src="https://picsum.photos/seed/${r}${i}/800/600" alt="추천 이미지 ${i + 1}" loading="lazy">`).join('');
    $('#pickerGrid').querySelectorAll('img').forEach(im => im.onclick = () => {
      if (draft.photos.length >= MAX) return toast(`사진은 최대 ${MAX}장까지예요.`);
      if (draft.photos.some(ph => ph.url === im.src)) return;
      im.classList.add('sel'); draft.photos.push({ url: im.src, preview: im.src }); drawPhotos();
    });
  }
  $('#openPicker').onclick = () => { const pk = $('#picker'); pk.hidden = !pk.hidden; if (!pk.hidden && !$('#pickerGrid').children.length) fillPicker(); };
  $('#refreshPicker').onclick = fillPicker;

  // 위치 선택
  const m = makeMap($('#writeMap'), REGIONS[0].center, REGIONS[0].zoom);
  let marker = null;
  function setLoc(lat, lng) {
    draft.lat = +lat.toFixed(6); draft.lng = +lng.toFixed(6);
    if (m) { if (marker) marker.setLatLng([lat, lng]); else marker = L.marker([lat, lng], { icon: pin() }).addTo(m); }
    $('#locText').textContent = `선택한 위치: ${draft.lat}, ${draft.lng}`;
  }
  if (m) {
    m.on('click', e => setLoc(e.latlng.lat, e.latlng.lng));
    $('#regionInput').onchange = e => { const r = REGIONS.find(r => r.key === e.target.value); m.setView(r.center, r.zoom); };
  }
  $('#myLocBtn').onclick = () => {
    if (!navigator.geolocation) return toast('이 기기에서는 위치를 가져올 수 없어요.');
    navigator.geolocation.getCurrentPosition(
      pos => { setLoc(pos.coords.latitude, pos.coords.longitude); m && m.setView([pos.coords.latitude, pos.coords.longitude], 15); },
      () => toast('위치 권한을 허용해주세요.'));
  };

  // 저장: 사진 업로드 → 글 저장
  $('#writeForm').onsubmit = e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    if (!f.place_name.trim()) return toast('공간 이름을 입력해주세요.');
    if (draft.lat == null) return toast('지도에서 위치를 선택해주세요.');
    if (!f.caption.trim()) return toast('이용 후기를 적어주세요.');
    if (!draft.photos.length) return toast('사진을 한 장 이상 첨부해주세요.');

    busy(e.target.querySelector('[type=submit]'), async () => {
      let images;
      try { images = await Promise.all(draft.photos.map(ph => ph.blob ? uploadPhoto(ph.blob) : ph.url)); }
      catch { return toast('사진 업로드에 실패했어요. (2MB 이하 이미지만 가능)'); }

      const { data, error } = await sb.from(T.posts).insert({
        user_id: authUser.id,
        place_name: f.place_name.trim(), category: f.category, region: f.region, address: f.address.trim(),
        lat: draft.lat, lng: draft.lng, caption: f.caption.trim(),
        image_url: images[0], images,
      }).select('id').single();
      if (error) { removePhotos(images).catch(() => {}); return toast('기록을 저장하지 못했어요.'); }
      clearInterval(clockTimer);
      toast('기록을 남겼어요.'); go(`#/post/${data.id}`);
    });
  };
}

/* ---------- [6] 마이페이지 ---------- */
async function renderMy(seq) {
  loading();
  const [{ data: myPosts }, { count: myComments }] = await Promise.all([
    sb.from(T.posts).select(POST_SELECT).eq('user_id', authUser.id).order('created_at', { ascending: false }),
    sb.from(T.comments).select('id', { count: 'exact', head: true }).eq('user_id', authUser.id),
  ]);
  if (stale(seq)) return;
  let newAvatar = null;   // null: 변경 없음, '': 기본 이미지로, Blob: 새 사진

  app.innerHTML = `
    <div class="page">
      <div class="card profile">
        <span id="avatarPreview">${avatarHTML(profile, 'lg')}</span>
        <div style="min-width:0">
          <h2>${esc(profile.display_name)}</h2>
          <div class="faint">@${esc(profile.username)} · ${fmtDate(profile.created_at)} 가입</div>
          <div class="stats"><span>기록 <b>${myPosts?.length || 0}</b></span><span>이야기 <b>${myComments || 0}</b></span></div>
        </div>
      </div>
      ${profile.bio ? `<p class="muted" style="margin:12px 4px 0">${esc(profile.bio)}</p>` : ''}

      <h2 class="section-title">내 기록</h2>
      ${myPosts?.length ? `<div class="h-scroll">${myPosts.map(postCard).join('')}</div>`
        : `<div class="empty"><div class="ico">✍️</div>아직 남긴 기록이 없어요.</div>`}

      <h2 class="section-title">내 정보 수정</h2>
      <form id="profileForm" class="card" style="padding:18px" novalidate>
        <div class="field"><label>프로필 사진</label>
          <div class="row"><button type="button" class="btn btn-ghost" id="pickAvatar">사진 선택</button>
          <button type="button" class="btn btn-ghost" id="clearAvatar">기본 이미지</button></div>
          <input type="file" accept="image/*" id="avatarFile" hidden></div>
        <div class="field"><label>이름</label><input class="input" name="display_name" value="${esc(profile.display_name)}" maxlength="20"></div>
        <div class="field"><label>아이디</label><input class="input" name="username" value="${esc(profile.username)}" maxlength="20"></div>
        <div class="field"><label>이메일</label><input class="input" type="email" name="email" value="${esc(authUser.email)}">
          <p class="faint" style="margin:4px 2px 0">이메일을 바꾸면 새 주소로 확인 메일이 가요.</p></div>
        <div class="field"><label>소개글</label><textarea class="textarea" name="bio" maxlength="150" style="min-height:90px">${esc(profile.bio)}</textarea></div>
        <div class="field"><label>주소</label><input class="input" name="address" maxlength="60" value="${esc(profile.address)}" placeholder="예) 서울 종로구"></div>
        <button class="btn btn-primary btn-block" type="submit">정보 저장</button>
      </form>

      <h2 class="section-title">비밀번호 변경</h2>
      <form id="pwForm" class="card" style="padding:18px" novalidate>
        <div class="field"><label>현재 비밀번호</label><input class="input" type="password" name="cur" autocomplete="current-password"></div>
        <div class="field"><label>새 비밀번호</label><input class="input" type="password" name="next" autocomplete="new-password" placeholder="6자 이상"></div>
        <div class="field"><label>새 비밀번호 확인</label><input class="input" type="password" name="confirm" autocomplete="new-password"></div>
        <button class="btn btn-primary btn-block" type="submit">비밀번호 변경</button>
      </form>

      <hr class="divider">
      <button class="btn btn-ghost btn-block" id="logoutBtn">로그아웃</button>
    </div>`;

  $('#pickAvatar').onclick = () => $('#avatarFile').click();
  $('#avatarFile').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      newAvatar = await resizeImage(f, 400);
      $('#avatarPreview').innerHTML = `<img class="avatar lg" src="${URL.createObjectURL(newAvatar)}" alt="">`;
    } catch { toast('사진을 읽지 못했어요.'); }
  };
  $('#clearAvatar').onclick = () => {
    newAvatar = '';
    $('#avatarPreview').innerHTML = avatarHTML({ ...profile, profile_image: '' }, 'lg');
  };

  $('#profileForm').onsubmit = e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    f.email = f.email.trim().toLowerCase();
    if (!f.display_name.trim()) return toast('이름을 입력해주세요.');
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(f.username)) return toast('아이디는 영문·숫자 3~20자로 입력해주세요.');
    if (!/^\S+@\S+\.\S+$/.test(f.email)) return toast('이메일 형식을 확인해주세요.');

    busy(e.target.querySelector('[type=submit]'), async () => {
      const changes = { display_name: f.display_name.trim(), username: f.username, bio: f.bio.trim(), address: f.address.trim() };
      if (newAvatar instanceof Blob) {
        try { changes.profile_image = await uploadPhoto(newAvatar, 'avatar'); }
        catch { return toast('프로필 사진을 올리지 못했어요.'); }
      } else if (newAvatar === '') changes.profile_image = '';

      const { data, error } = await sb.from(T.profiles).update(changes).eq('id', authUser.id).select().single();
      if (error) return toast(error.code === '23505' ? '이미 사용 중인 아이디예요.' : '저장하지 못했어요.');
      profile = data;

      if (f.email !== authUser.email) {
        const { error: mailErr } = await sb.auth.updateUser({ email: f.email }, { emailRedirectTo: location.origin + location.pathname });
        toast(mailErr ? '이메일은 변경하지 못했어요. (이미 사용 중일 수 있어요)' : '새 이메일로 확인 메일을 보냈어요.');
      } else toast('내 정보를 저장했어요.');
      route();
    });
  };

  $('#pwForm').onsubmit = e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    if (f.next.length < 6) return toast('새 비밀번호는 6자 이상으로 해주세요.');
    if (f.next !== f.confirm) return toast('새 비밀번호가 서로 달라요.');
    busy(e.target.querySelector('[type=submit]'), async () => {
      // 현재 비밀번호가 맞는지 다시 로그인해서 확인
      const { error: checkErr } = await sb.auth.signInWithPassword({ email: authUser.email, password: f.cur });
      if (checkErr) return toast('현재 비밀번호가 맞지 않아요.');
      const { error } = await sb.auth.updateUser({ password: f.next });
      if (error) return toast('비밀번호를 변경하지 못했어요.');
      e.target.reset(); toast('비밀번호를 변경했어요.');
    });
  };

  $('#logoutBtn').onclick = async () => { await sb.auth.signOut(); toast('다음에 또 머물러 오세요.'); };
}

/* ================================================================
   4. 화면 전환 (주소 # 뒤 경로에 따라 페이지를 바꿔 끼움)
   ================================================================ */
function go(hash) { if (location.hash === hash) route(); else location.hash = hash; }

function route() {
  const seq = ++renderSeq;
  maps.forEach(m => m.remove()); maps = [];
  const [path, query] = (location.hash.slice(1) || '/home').split('?');
  const params = new URLSearchParams(query || '');
  const loggedIn = !!(authUser && profile);

  if (!loggedIn && path !== '/login') return go('#/login');
  if (loggedIn && path === '/login') return go('#/home');

  $('#topbar').hidden = !loggedIn;
  if (loggedIn) {
    $('#topAvatar').innerHTML = avatarHTML(profile);
    const tab = path.startsWith('/post') ? 'list' : path.slice(1);
    document.querySelectorAll('#tabs a').forEach(a => a.classList.toggle('active', a.dataset.tab === tab));
  }

  window.scrollTo(0, 0);
  if (path === '/login') renderAuth();
  else if (path === '/home') renderHome(seq);
  else if (path === '/list') renderList(seq, params);
  else if (path === '/write') renderWrite(seq);
  else if (path === '/my') renderMy(seq);
  else if (/^\/post\/\d+$/.test(path)) renderDetail(seq, Number(path.split('/')[2]));
  else go('#/home');
}

/* ---------- 시작 ---------- */
(async function start() {
  loading('머묾을 여는 중…');
  const { data: { session } } = await sb.auth.getSession();
  authUser = session?.user || null;
  await loadProfile();
  // 이메일 인증 링크로 돌아오면 주소에 access_token 이 붙어 있으므로 정리
  if (location.hash.includes('access_token') || location.hash.includes('error=')) history.replaceState(null, '', location.pathname + '#/home');
  route();
  window.addEventListener('hashchange', route);

  sb.auth.onAuthStateChange((event, session) => {
    const prevId = authUser?.id;
    authUser = session?.user || null;
    if (event === 'SIGNED_OUT') { profile = null; route(); return; }
    // 로그인 직후 / 다른 계정으로 바뀐 경우에만 프로필을 다시 불러와 화면 갱신
    if (event === 'SIGNED_IN' && authUser && authUser.id !== prevId) {
      setTimeout(async () => { await loadProfile(); toast(`${profile?.display_name || ''}님, 어서 오세요.`); route(); }, 0);
    }
  });
})();
