const express = require('express');
const cors = require('cors');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cors());

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

async function supabase(method, path, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Prefer': method === 'POST' ? 'return=representation' : 'return=minimal',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!text || text.trim() === '') return [];
  try { return JSON.parse(text); } catch(e) { return []; }
}

// ── 배민 데이터 저장 (Supabase upsert) ──────────────
app.post('/api/data', async (req, res) => {
  try {
    const { regionId, riders, weekRiders, summary } = req.body;
    const region = regionId || 'unknown';
    const saved_at = new Date().toISOString();

    await fetch(`${SUPABASE_URL}/rest/v1/baemin_data`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Prefer': 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify({ region, riders: riders || [], week_riders: weekRiders || [], summary, saved_at }),
    });

    console.log(`[RideOn] ${region} 데이터 저장: ${riders?.length}명 / 주간 ${weekRiders?.length || 0}명`);
    res.json({ success: true, region });
  } catch(e) {
    console.error('[/api/data POST]', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── 배민 데이터 조회 ──────────────
app.get('/api/data', async (req, res) => {
  try {
    const { region } = req.query;

    if (region) {
      const rows = await supabase('GET', `/baemin_data?region=eq.${region}&select=*`);
      if (rows.length > 0) {
        const row = rows[0];
        return res.json({ ...row, weekRiders: row.week_riders || [] });
      }
      return res.json({ riders: [], weekRiders: [], savedAt: null });
    }

    // 전체 조회
    const rows = await supabase('GET', '/baemin_data?select=*');
    const allRiders = rows.flatMap(d => d.riders || []);
    const allWeekRiders = rows.flatMap(d => d.week_riders || []);
    const latest = rows.map(d => d.saved_at).sort().pop();
    const regions = {};
    rows.forEach(d => { regions[d.region] = { riders: d.riders, weekRiders: d.week_riders || [], savedAt: d.saved_at, summary: d.summary }; });

    res.json({ riders: allRiders, weekRiders: allWeekRiders, savedAt: latest || null, regions });
  } catch(e) {
    console.error('[/api/data GET]', e.message);
    res.status(500).json({ riders: [], weekRiders: [], error: e.message });
  }
});

// ── 지역별 조회 ──────────────
app.get('/api/data/:region', async (req, res) => {
  try {
    const rows = await supabase('GET', `/baemin_data?region=eq.${req.params.region}&select=*`);
    res.json(rows[0] || { riders: [], savedAt: null });
  } catch(e) {
    res.json({ riders: [], savedAt: null });
  }
});

// ── 회원가입 ──────────────
app.post('/api/signup', async (req, res) => {
  try {
    const { username, password, name, phone, connect_id } = req.body;
    if (!username || !password || !name || !connect_id) {
      return res.status(400).json({ success: false, error: '모든 항목을 입력해주세요' });
    }
    const existing = await supabase('GET', `/users?username=eq.${username}&select=id`);
    if (existing.length > 0) return res.status(400).json({ success: false, error: '이미 사용 중인 아이디입니다' });
    const result = await supabase('POST', '/users', { username, password, name, phone, connect_id, role: 'rider', approved: false });
    console.log('[signup] 저장결과:', JSON.stringify(result));
    res.json({ success: true, message: '가입 신청 완료! 관리자 승인 후 로그인 가능합니다' });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── 로그인 ──────────────
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const users = await supabase('GET', `/users?username=eq.${username}&password=eq.${password}&select=*`);
    if (!users || users.length === 0) return res.status(401).json({ success: false, error: '아이디 또는 비밀번호가 올바르지 않습니다' });
    const user = users[0];
    if (!user.approved) return res.status(403).json({ success: false, error: '관리자 승인 대기 중입니다' });
    res.json({ success: true, user: { id: user.id, username: user.username, name: user.name, role: user.role, region: user.region, connect_id: user.connect_id } });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── 사용자 목록 ──────────────
app.get('/api/users', async (req, res) => {
  try {
    const users = await supabase('GET', '/users?select=id,username,name,role,region,approved,connect_id,created_at&order=created_at.desc');
    res.json({ success: true, users });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── 사용자 수정 ──────────────
app.patch('/api/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { approved, role, region } = req.body;
    await supabase('PATCH', `/users?id=eq.${id}`, { approved, role, region });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── 사용자 삭제 ──────────────
app.delete('/api/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await supabase('DELETE', `/users?id=eq.${id}`);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── 아이디 찾기 ──────────────
app.post('/api/find-id', async (req, res) => {
  try {
    const { name, phone } = req.body;
    const users = await supabase('GET', `/users?name=eq.${encodeURIComponent(name)}&phone=eq.${encodeURIComponent(phone)}&select=username`);
    if (!users || users.length === 0) return res.status(404).json({ success: false, error: '일치하는 계정이 없습니다' });
    res.json({ success: true, username: users[0].username });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── 비밀번호 찾기 ──────────────
app.post('/api/find-pw', async (req, res) => {
  try {
    const { username, phone } = req.body;
    const users = await supabase('GET', `/users?username=eq.${username}&phone=eq.${encodeURIComponent(phone)}&select=id`);
    if (!users || users.length === 0) return res.status(404).json({ success: false, error: '일치하는 계정이 없습니다' });
    const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    const tempPw = Array.from({length: 8}, () => chars[Math.floor(Math.random()*chars.length)]).join('');
    await supabase('PATCH', `/users?id=eq.${users[0].id}`, { password: tempPw });
    res.json({ success: true, tempPassword: tempPw });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── 정산 저장 ──────────────
app.post('/api/settle', async (req, res) => {
  try {
    const { region, data, weekStart } = req.body;
    console.log('[settle] 업로드 시작:', region, weekStart, Object.keys(data).length, '명');
    const dates = [...new Set(Object.values(data).flatMap(d => Object.keys(d)))];
    for(const date of dates) {
      await supabase('DELETE', `/settle_data?region=eq.${region}&week_start=eq.${weekStart}&date=eq.${date}`);
    }
    const rows = [];
    for (const [name, dates2] of Object.entries(data)) {
      for (const [date, fee] of Object.entries(dates2)) {
        rows.push({ region, rider_name: name, date, fee, week_start: weekStart });
      }
    }
    if (rows.length > 0) await supabase('POST', '/settle_data', rows);
    res.json({ success: true, count: rows.length });
  } catch(e) {
    console.log('[settle] 오류:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── 정산 조회 ──────────────
app.get('/api/settle', async (req, res) => {
  try {
    const { region, weekStart } = req.query;
    const rows = await supabase('GET', `/settle_data?region=eq.${region}&week_start=eq.${weekStart}&select=rider_name,date,fee`);
    const data = {};
    (rows||[]).forEach(r => {
      if (!data[r.rider_name]) data[r.rider_name] = {};
      data[r.rider_name][r.date] = r.fee;
    });
    res.json({ success: true, data });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── 정산 삭제 ──────────────
app.delete('/api/settle/:weekStart', async (req, res) => {
  try {
    await supabase('DELETE', `/settle_data?week_start=eq.${req.params.weekStart}`);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── 상태 확인 ──────────────
app.get('/', async (req, res) => {
  try {
    const rows = await supabase('GET', '/baemin_data?select=region,saved_at');
    const info = {};
    rows.forEach(r => { info[r.region] = r.saved_at; });
    res.json({ status: 'ok', regions: info });
  } catch(e) {
    res.json({ status: 'ok', regions: {} });
  }
});

app.listen(PORT, () => console.log('RideOn 서버 실행 중:', PORT));
