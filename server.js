const express = require('express');
const cors = require('cors');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(cors());

// Supabase 설정
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

async function supabase(method, path, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Prefer': method === 'POST' ? 'return=representation' : '',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

// 배민 데이터 저장소
let baeminData = null;

// ── 배민 데이터 수신 ──
app.post('/api/data', (req, res) => {
  baeminData = { ...req.body, savedAt: new Date().toISOString() };
  console.log('[RideOn] 데이터 수신:', baeminData.riders?.length, '명');
  res.json({ success: true });
});

// ── 배민 데이터 조회 ──
app.get('/api/data', (req, res) => {
  res.json(baeminData || { riders: [], savedAt: null });
});

// ── 회원가입 ──
app.post('/api/signup', async (req, res) => {
  try {
    const { username, password, name } = req.body;
    if (!username || !password || !name) {
      return res.status(400).json({ success: false, error: '모든 항목을 입력해주세요' });
    }

    // 중복 확인
    const existing = await supabase('GET', `/users?username=eq.${username}&select=id`);
    if (existing.length > 0) {
      return res.status(400).json({ success: false, error: '이미 사용 중인 아이디입니다' });
    }

    // 회원 생성 (승인 대기)
    await supabase('POST', '/users', {
      username, password, name, role: 'rider', approved: false
    });

    res.json({ success: true, message: '가입 신청 완료! 관리자 승인 후 로그인 가능합니다' });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── 로그인 ──
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const users = await supabase('GET', `/users?username=eq.${username}&password=eq.${password}&select=*`);

    if (!users || users.length === 0) {
      return res.status(401).json({ success: false, error: '아이디 또는 비밀번호가 올바르지 않습니다' });
    }

    const user = users[0];
    if (!user.approved) {
      return res.status(403).json({ success: false, error: '관리자 승인 대기 중입니다' });
    }

    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        role: user.role,
        region: user.region,
      }
    });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── 전체 사용자 조회 (관리자용) ──
app.get('/api/users', async (req, res) => {
  try {
    const users = await supabase('GET', '/users?select=id,username,name,role,region,approved,created_at&order=created_at.desc');
    res.json({ success: true, users });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── 사용자 승인/역할 변경 (관리자용) ──
app.patch('/api/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { approved, role, region } = req.body;
    await supabase('PATCH', `/users?id=eq.${id}`, { approved, role, region });
    res.json({ success: true });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── 헬스체크 ──
app.get('/', (req, res) => {
  res.json({ status: 'ok', riders: baeminData?.riders?.length || 0, savedAt: baeminData?.savedAt || null });
});

app.listen(PORT, () => console.log('RideOn 서버 실행 중:', PORT));
