const express = require('express');
const cors = require('cors');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(cors());

let baeminData = null;

// 확장프로그램에서 데이터 받기
app.post('/api/data', (req, res) => {
  baeminData = { ...req.body, savedAt: new Date().toISOString() };
  console.log('[RideOn] 데이터 수신:', baeminData.riders?.length, '명');
  res.json({ success: true });
});

// 대시보드에서 데이터 요청
app.get('/api/data', (req, res) => {
  res.json(baeminData || { riders: [], savedAt: null });
});

// 헬스체크
app.get('/', (req, res) => {
  res.json({ status: 'ok', riders: baeminData?.riders?.length || 0, savedAt: baeminData?.savedAt || null });
});

app.listen(PORT, () => console.log('RideOn 서버 실행 중:', PORT));
