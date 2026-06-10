/**
 * TrustExam — Backend v4
 * Раздельная запись: {hash}_screen.webm и {hash}_face.webm
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  maxHttpBufferSize: 1e8,
});

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '100mb' }));

const VIDEOS_DIR = path.join(__dirname, 'recordings');
if (!fs.existsSync(VIDEOS_DIR)) fs.mkdirSync(VIDEOS_DIR, { recursive: true });

// ── Видео с поддержкой Range (нужно для браузерного плеера) ───────────────
app.get('/recordings/:file', (req, res) => {
  const filePath = path.join(VIDEOS_DIR, req.params.file);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const range = req.headers.range;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'video/webm');
  res.setHeader('Accept-Ranges', 'bytes');

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Content-Length': end - start + 1,
    });
    fs.createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { 'Content-Length': fileSize });
    fs.createReadStream(filePath).pipe(res);
  }
});

// ── In-memory DB ───────────────────────────────────────────────────────────
let students = {};
// recordingSessions[studentId] = { hash, screenStream, faceStream, startTime }
let recordingSessions = {};

const CORRECT_ANSWERS = { 1: 1, 2: 1, 3: 2, 4: 0, 5: 2 };
const TOTAL_QUESTIONS = 5;

function createStudent(id, name) {
  return {
    id, name,
    examTitle: 'Midterm Exam 2025',
    status: 'active',
    violations: 0,
    score: null,
    autoScore: null,
    comments: [],
    joinedAt: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
    recordingHash: null,
    screenUrl: null,
    faceUrl: null,
  };
}

// ── REST API ───────────────────────────────────────────────────────────────

app.get('/api/students', (req, res) => res.json(Object.values(students)));

app.post('/api/students/:id/comment', (req, res) => {
  const student = students[req.params.id];
  if (!student) return res.status(404).json({ error: 'Not found' });
  student.comments.push({
    id: Date.now(),
    author: req.body.author || 'Проктор',
    text: req.body.text,
    isAI: false,
    time: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
  });
  io.emit('students_update', Object.values(students));
  res.json({ success: true });
});

app.post('/api/students/:id/verdict', (req, res) => {
  const student = students[req.params.id];
  if (!student) return res.status(404).json({ error: 'Not found' });
  student.status = req.body.verdict;
  if (req.body.verdict === 'banned') {
    for (const [, sock] of io.sockets.sockets) {
      if (sock.studentId === req.params.id) { sock.emit('banned'); break; }
    }
  }
  io.emit('students_update', Object.values(students));
  res.json({ success: true });
});

app.post('/api/students/:id/score', (req, res) => {
  const student = students[req.params.id];
  if (!student) return res.status(404).json({ error: 'Not found' });
  student.score = req.body.score;
  io.emit('students_update', Object.values(students));
  res.json({ success: true });
});

app.post('/api/students/:id/submit-answers', (req, res) => {
  const student = students[req.params.id];
  if (!student) return res.status(404).json({ error: 'Not found' });
  const answers = req.body.answers || {};
  let correct = 0;
  for (const [qId, answerIdx] of Object.entries(answers)) {
    if (CORRECT_ANSWERS[parseInt(qId)] === answerIdx) correct++;
  }
  const pct = Math.round((correct / TOTAL_QUESTIONS) * 100);
  student.autoScore = pct;
  io.emit('students_update', Object.values(students));
  res.json({ autoScore: pct, correct, total: TOTAL_QUESTIONS });
});

// ── Recording API ──────────────────────────────────────────────────────────

app.post('/api/recording/start', (req, res) => {
  const { studentId } = req.body;
  if (!studentId) return res.status(400).json({ error: 'studentId required' });

  const hash = crypto.createHash('sha256')
    .update(`${studentId}_${Date.now()}_${Math.random()}`)
    .digest('hex').slice(0, 16);

  const screenPath = path.join(VIDEOS_DIR, `${hash}_screen.webm`);
  const facePath   = path.join(VIDEOS_DIR, `${hash}_face.webm`);

  recordingSessions[studentId] = {
    hash,
    screenStream: fs.createWriteStream(screenPath),
    faceStream:   fs.createWriteStream(facePath),
    screenChunks: 0,
    faceChunks:   0,
    startTime:    Date.now(),
  };

  if (students[studentId]) {
    students[studentId].recordingHash = hash;
    students[studentId].screenUrl = `/recordings/${hash}_screen.webm`;
    students[studentId].faceUrl   = `/recordings/${hash}_face.webm`;
    io.emit('students_update', Object.values(students));
  }

  console.log(`[REC] Started ${studentId} → ${hash}`);
  res.json({ hash });
});

// Принимает чанки — тип определяется заголовком x-recording-type: 'screen' | 'face'
app.post('/api/recording/chunk', express.raw({ type: 'video/webm', limit: '20mb' }), (req, res) => {
  const session = recordingSessions[req.headers['x-student-id']];
  if (!session) return res.status(404).json({ error: 'No active recording' });

  const type = req.headers['x-recording-type'];

  if (type === 'face') {
    session.faceStream.write(Buffer.from(req.body));
    session.faceChunks++;
  } else {
    // default: screen
    session.screenStream.write(Buffer.from(req.body));
    session.screenChunks++;
  }

  res.json({ success: true, type, screenChunks: session.screenChunks, faceChunks: session.faceChunks });
});

app.post('/api/recording/stop', (req, res) => {
  const { studentId } = req.body;
  const session = recordingSessions[studentId];
  if (!session) return res.status(404).json({ error: 'No active recording' });

  // Закрыть оба стрима
  let closed = 0;
  const onClose = () => {
    closed++;
    if (closed < 2) return;

    const screenPath = path.join(VIDEOS_DIR, `${session.hash}_screen.webm`);
    const facePath   = path.join(VIDEOS_DIR, `${session.hash}_face.webm`);

    const screenSize = fs.existsSync(screenPath) ? fs.statSync(screenPath).size : 0;
    const faceSize   = fs.existsSync(facePath)   ? fs.statSync(facePath).size   : 0;
    const duration   = Math.round((Date.now() - session.startTime) / 1000);

    if (students[studentId]) {
      students[studentId].recordingDuration = duration;
      io.emit('students_update', Object.values(students));
    }

    res.json({
      hash:      session.hash,
      screenUrl: `/recordings/${session.hash}_screen.webm`,
      faceUrl:   `/recordings/${session.hash}_face.webm`,
      screenSize, faceSize, duration,
    });

    delete recordingSessions[studentId];
    console.log(`[REC] Stopped ${session.hash} (${duration}s, screen:${screenSize}b face:${faceSize}b)`);
  };

  session.screenStream.end(onClose);
  session.faceStream.end(onClose);
});

app.get('/api/recordings', (req, res) => {
  if (!fs.existsSync(VIDEOS_DIR)) return res.json([]);

  const files = fs.readdirSync(VIDEOS_DIR).filter(f => f.endsWith('_screen.webm'));
  const result = files.map(f => {
    const hash = f.replace('_screen.webm', '');
    const screenPath = path.join(VIDEOS_DIR, `${hash}_screen.webm`);
    const facePath   = path.join(VIDEOS_DIR, `${hash}_face.webm`);
    const screenStat = fs.statSync(screenPath);
    const faceStat   = fs.existsSync(facePath) ? fs.statSync(facePath) : null;
    const student    = Object.values(students).find(s => s.recordingHash === hash);
    return {
      hash,
      screenUrl:   `/recordings/${hash}_screen.webm`,
      faceUrl:     fs.existsSync(facePath) ? `/recordings/${hash}_face.webm` : null,
      screenSize:  screenStat.size,
      faceSize:    faceStat?.size || 0,
      created:     screenStat.birthtime,
      studentName: student?.name || 'Неизвестно',
      studentId:   student?.id || null,
    };
  }).sort((a, b) => new Date(b.created) - new Date(a.created));

  res.json(result);
});

// ── Socket.IO ──────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[+] ${socket.id}`);

  socket.on('student_join', ({ studentId, name }) => {
    socket.studentId = studentId;
    socket.role = 'student';
    if (!students[studentId]) students[studentId] = createStudent(studentId, name);
    else students[studentId].status = 'active';
    socket.emit('init', students[studentId]);
    io.emit('students_update', Object.values(students));
    console.log(`[STUDENT] ${name}`);
  });

  socket.on('proctor_join', ({ username }) => {
    socket.role = 'proctor';
    socket.emit('init', Object.values(students));
    console.log(`[PROCTOR] ${username}`);
  });

  socket.on('ai_violation', ({ studentId, reason, severity }) => {
    const student = students[studentId];
    if (!student || student.status === 'banned') return;
    student.violations++;
    student.comments.push({
      id: Date.now(), author: '🤖 AI Proctor', text: reason, isAI: true, severity,
      time: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
    });
    if (student.violations >= 5) { student.status = 'banned'; socket.emit('banned'); }
    else if (student.violations >= 3) student.status = 'warned';
    io.emit('students_update', Object.values(students));
  });

  socket.on('disconnect', () => {
    if (socket.role === 'student' && socket.studentId) {
      const s = students[socket.studentId];
      if (s && s.status !== 'banned') { s.status = 'offline'; io.emit('students_update', Object.values(students)); }
    }
  });
});

const PORT = 5000;
server.listen(PORT, () => console.log(`🚀 TrustExam: http://localhost:${PORT}`));