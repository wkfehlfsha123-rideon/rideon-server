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
      'Prefer': method === 'POST' ? 'return=representation' : '',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

let baeminData = {};

app.post('/api/data', (req, res) => {
  const { regionId, riders, summary } = req.body;
  const region = regionId || 'unknown';
  baeminData[region] = { riders: riders || [], savedAt: new Date().toISOString(), summary };
  console.log(`[RideOn] ${region} 데이터 수신: ${riders?.length}명`);
  res.json({ success: true, region });
});

app.get('/api/data', (req, res) => {
  const { region } = req.query;
  if (region && baeminData[region]) return res.json(baeminData[region]);
  const allRiders = Object.values(baeminData).flatMap(d => d.riders || []);
  const latest = Object.values(baeminData).map(d => d.savedAt).sort().pop();
  res.json({ riders: allRiders, savedAt: latest || null, regions: baeminData });
});

app.get('/api/data/:region', (req, res) => {
  const { region } = req.params;
  res.json(baeminData[region] || { riders: [], savedAt: null });
});

app.post('/api/signup', async (req, res) => {
  try {
    const { username, password, name, phone } = req.body;
    if (!username || !password || !name) return res.status(400).json({ success: false, error: '모든 항목을 입력해주세요' });
    const existing = await supabase('GET', `/users?username=eq.${username}&select=id`);
    if (existing.length > 0) return res.status(400).json({ success: false, error: '이미 사용 중인 아이디입니다' });
    await supabase('POST', '/users', { username, password, name, phone, role: 'rider', approved: false });
    res.json({ success: true, message: '가입 신청 완료! 관리자 승인 후 로그인 가능합니다' });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const users = await supabase('GET', `/users?username=eq.${username}&password=eq.${password}&select=*`);
    if (!users || users.length === 0) return res.status(401).json({ success: false, error: '아이디 또는 비밀번호가 올바르지 않습니다' });
    const user = users[0];
    if (!user.approved) return res.status(403).json({ success: false, error: '관리자 승인 대기 중입니다' });
    res.json({ success: true, user: { id: user.id, username: user.username, name: user.name, role: user.role, region: user.region } });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/users', async (req, res) => {
  try {
    const users = await supabase('GET', '/users?select=id,username,name,role,region,approved,created_at&order=created_at.desc');
    res.json({ success: true, users });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

app.patch('/api/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { approved, role, region } = req.body;
    await supabase('PATCH', `/users?id=eq.${id}`, { approved, role, region });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/find-id', async (req, res) => {
  try {
    const { name, phone } = req.body;
    const users = await supabase('GET', `/users?name=eq.${encodeURIComponent(name)}&phone=eq.${encodeURIComponent(phone)}&select=username`);
    if (!users || users.length === 0) return res.status(404).json({ success: false, error: '일치하는 계정이 없습니다' });
    res.json({ success: true, username: users[0].username });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

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

app.post('/api/settle', async (req, res) => {
  try {
    const { region, data, weekStart } = req.body;
    await supabase('DELETE', `/settle_data?region=eq.${region}&week_start=eq.${weekStart}`);
    const rows = [];
    for (const [name, dates] of Object.entries(data)) {
      for (const [date, fee] of Object.entries(dates)) {
        rows.push({ region, rider_name: name, date, fee, week_start: weekStart });
      }
    }
    if (rows.length > 0) await supabase('POST', '/settle_data', rows);
    res.json({ success: true, count: rows.length });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

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

app.delete('/api/settle/:weekStart', async (req, res) => {
  try {
    await supabase('DELETE', `/settle_data?week_start=eq.${req.params.weekStart}`);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/', (req, res) => {
  const allRiders = Object.values(baeminData).flatMap(d => d.riders || []);
  res.json({ status: 'ok', riders: allRiders.length, regions: Object.keys(baeminData) });
});

app.listen(PORT, () => console.log('RideOn 서버 실행 중:', PORT));
