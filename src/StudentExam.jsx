import React, { useState, useRef, useEffect, useCallback } from 'react';
import { socket } from './socket';
import { useProctoring } from './useProctoring';
import { useRecording } from './useRecording';

const SERVER = 'http://localhost:5000';

const QUESTIONS = [
  { id: 1, text: 'Какой алгоритм имеет временную сложность O(n log n) в среднем случае?', options: ['Пузырьковая сортировка O(n²)', 'Быстрая сортировка O(n log n)', 'Линейный поиск O(n)', 'Сортировка подсчётом O(n+k)'] },
  { id: 2, text: 'Что такое REST API?', options: ['Протокол передачи файлов', 'Архитектурный стиль для веб-сервисов', 'Язык программирования', 'База данных'] },
  { id: 3, text: 'Какая структура данных работает по принципу LIFO?', options: ['Очередь', 'Массив', 'Стек', 'Связный список'] },
  { id: 4, text: 'Что означает SQL?', options: ['Structured Query Language', 'Simple Queue List', 'System Query Logic', 'Sequential Query Layer'] },
  { id: 5, text: 'Какой HTTP метод используется для создания ресурса?', options: ['GET', 'DELETE', 'POST', 'PATCH'] },
];

export default function StudentExam({ session, onLogout }) {
  const { studentId, username } = session;

  const [phase, setPhase]             = useState('setup');
  const [violations, setViolations]   = useState(0);
  const [score, setScore]             = useState(null);
  const [autoScore, setAutoScore]     = useState(null);
  const [cameraStream, setCameraStream] = useState(null);
  const [roomOk, setRoomOk]           = useState(false);
  const [currentQ, setCurrentQ]       = useState(0);
  const [answers, setAnswers]         = useState({});
  const [shareStatus, setShareStatus] = useState('');
  const [submitting, setSubmitting]   = useState(false);

  const videoRef = useRef(null);

  const {
    status, statusText, warning, isBlocked,
    initAI, startDetectionLoop, stopDetection,
  } = useProctoring({ studentId });

  const {
    recording, recordingHash, requestCamera,
    startRecording, stopRecording,
  } = useRecording({ studentId });

  // Прикрепить камеру к video элементу
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !cameraStream) return;
    video.srcObject = cameraStream;
    video.play().catch(() => {});
  }, [cameraStream, phase]);

  // Socket подключение
  useEffect(() => {
    socket.connect();
    socket.emit('student_join', { studentId, name: username });

    socket.on('students_update', (list) => {
      const me = list.find(s => s.id === studentId);
      if (!me) return;
      setViolations(me.violations);
      if (me.score != null) setScore(me.score);
      if (me.autoScore != null) setAutoScore(me.autoScore);
      if (me.status === 'banned') {
        handleBanned();
      }
    });

    socket.on('banned', () => {
      handleBanned();
    });

    return () => {
      socket.off('students_update');
      socket.off('banned');
      socket.disconnect();
    };
  }, [studentId, username]);

  // Обработка бана
  const handleBanned = useCallback(() => {
    setPhase('banned');
    stopDetection();
    stopRecording();
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }
  }, [stopDetection, stopRecording]);

  // Уход с вкладки во время экзамена
  useEffect(() => {
    if (phase !== 'exam') return;
    const onHide = () => {
      if (document.hidden) {
        socket.emit('ai_violation', {
          studentId,
          reason: '⚠️ Студент покинул окно экзамена',
          severity: 'warning',
        });
      }
    };
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
  }, [phase, studentId]);

  // Включить камеру
  async function handleCamera() {
    try {
      const stream = await requestCamera();
      setCameraStream(stream);
    } catch (e) {
      alert(e.message);
    }
  }

  // Начать экзамен
  const startExam = useCallback(async () => {
    setShareStatus('Запуск записи экрана...');
    try {
      await startRecording(cameraStream);
      setShareStatus('✅ Экран записывается');
    } catch (e) {
      setShareStatus(`❌ ${e.message}`);
      return;
    }
    document.documentElement.requestFullscreen().catch(() => {});
    setPhase('exam');
    await initAI(cameraStream);
    startDetectionLoop();
  }, [cameraStream, startRecording, initAI, startDetectionLoop]);

  // Сдать экзамен
  async function submitExam() {
    if (submitting) return;
    setSubmitting(true);

    // 1. Остановить запись (останавливает screen + камеру)
    await stopRecording();

    // 2. Остановить AI прокторинг
    stopDetection();

    // 3. Выйти из полноэкранного режима
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }

    // 4. Отправить ответы для автоподсчёта
    try {
      const res = await fetch(`${SERVER}/api/students/${studentId}/submit-answers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers }),
      });
      const data = await res.json();
      setAutoScore(data.autoScore);
    } catch (e) {
      console.error('Submit answers error:', e);
    }

    setPhase('done');
    setSubmitting(false);
  }

  function selectAnswer(qId, idx) {
    if (isBlocked) return;
    setAnswers(prev => ({ ...prev, [qId]: idx }));
  }

  const goNext = () => { if (currentQ < QUESTIONS.length - 1) setCurrentQ(q => q + 1); };
  const goPrev = () => { if (currentQ > 0) setCurrentQ(q => q - 1); };

  // ── BANNED ─────────────────────────────────────────────────────────────
  if (phase === 'banned') return (
    <div style={{ ...S.page, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
      <div>
        <div style={{ fontSize: 64, marginBottom: 16 }}>🚫</div>
        <h1 style={{ color: '#EF4444', fontSize: 32, margin: '0 0 10px' }}>Доступ заблокирован</h1>
        <p style={{ color: '#94A3B8' }}>Зафиксировано {violations} нарушений. Обратитесь к преподавателю.</p>
        <button onClick={onLogout} style={S.logoutBtn}>← Выйти</button>
      </div>
    </div>
  );

  // ── DONE ───────────────────────────────────────────────────────────────
  if (phase === 'done') return (
    <div style={{ ...S.page, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
      <div style={{ maxWidth: 420 }}>
        <div style={{ fontSize: 64, marginBottom: 16 }}>✅</div>
        <h1 style={{ color: '#4ADE80', fontSize: 28, margin: '0 0 20px' }}>Экзамен сдан!</h1>

        {autoScore !== null && (
          <div style={S.scoreCard}>
            <div style={{ fontSize: 12, color: '#64748B', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1 }}>
              Результат (автопроверка)
            </div>
            <div style={{
              fontSize: 56, fontWeight: 800, lineHeight: 1,
              color: autoScore >= 80 ? '#4ADE80' : autoScore >= 60 ? '#F59E0B' : '#EF4444',
            }}>
              {autoScore}%
            </div>
            <div style={{ fontSize: 13, color: '#64748B', marginTop: 6 }}>
              {Math.round(autoScore / 100 * QUESTIONS.length)} из {QUESTIONS.length} правильно
            </div>
          </div>
        )}

        {score !== null ? (
          <div style={{ ...S.scoreCard, marginTop: 12, borderColor: '#2563EB' }}>
            <div style={{ fontSize: 12, color: '#64748B', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1 }}>
              Оценка проктора
            </div>
            <div style={{ fontSize: 48, fontWeight: 800, color: '#60A5FA' }}>{score}</div>
          </div>
        ) : (
          <p style={{ color: '#475569', fontSize: 13, marginTop: 16 }}>⏳ Оценка проктора ещё не выставлена</p>
        )}

        {recordingHash && (
          <p style={{ color: '#475569', fontSize: 11, marginTop: 16 }}>
            Запись: <code style={{ color: '#64748B' }}>{recordingHash}</code>
          </p>
        )}
        <button onClick={onLogout} style={{ ...S.logoutBtn, marginTop: 24 }}>← Выйти на главную</button>
      </div>
    </div>
  );

  // ── SETUP ──────────────────────────────────────────────────────────────
  if (phase === 'setup') {
    const camOk = !!cameraStream;
    return (
      <div style={S.page}>
        <div style={S.setupWrap}>
          <header style={S.hdr}>
            <Logo />
            <span style={S.hdrTitle}>Подготовка к экзамену</span>
            <span style={S.hdrUser}>👤 {username}</span>
            <button onClick={onLogout} style={S.exitBtn}>Выйти</button>
          </header>
          <div style={S.card}>
            <h2 style={S.cardTitle}>Проверьте всё перед началом</h2>
            <Step n={1} title="Включите камеру" done={camOk} action={!camOk ? handleCamera : null} label="Включить камеру">
              {camOk && (
                <div style={{ position: 'relative', marginBottom: 10 }}>
                  <video ref={videoRef} autoPlay muted playsInline style={S.prevVideo} />
                  <div style={S.camLabel}>📷 Камера активна</div>
                </div>
              )}
              <p style={S.hint}>Вы должны быть видны в кадре, лицо хорошо освещено.</p>
            </Step>
            <Step n={2} title="Подтвердите что вы одни" done={roomOk} action={!roomOk ? () => setRoomOk(true) : null} label="Подтверждаю">
              <p style={S.hint}>В комнате не должно быть других людей. Запрещены телефон, шпаргалки.</p>
            </Step>
            <Step n={3} title="Шейринг экрана" done={false} action={null} label="">
              <p style={S.hint}>При нажатии «Начать» браузер попросит выбрать экран для записи.</p>
              {shareStatus && (
                <div style={{ fontSize: 13, color: shareStatus.startsWith('✅') ? '#4ADE80' : '#F59E0B', marginTop: 6 }}>
                  {shareStatus}
                </div>
              )}
            </Step>
            <button
              onClick={startExam}
              disabled={!camOk || !roomOk}
              style={{ ...S.startBtn, ...(!camOk || !roomOk ? S.startBtnOff : {}) }}
            >
              Начать экзамен →
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── EXAM ───────────────────────────────────────────────────────────────
  const q = QUESTIONS[currentQ];
  return (
    <div style={S.page}>
      {/* WARNING OVERLAY */}
      {warning && (
        <div style={S.overlay}>
          <div style={S.overlayBox}>
            <div style={{ fontSize: 48, marginBottom: 10 }}>⚠️</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: '#FDE047', marginBottom: 8 }}>{warning}</div>
            <div style={{ fontSize: 13, color: '#94A3B8' }}>Ответы заблокированы — вернитесь в кадр</div>
          </div>
        </div>
      )}

      <div style={S.layout}>
        {/* Sidebar */}
        <aside style={S.sidebar}>
          <div style={S.camBox}>
            <video
              ref={videoRef}
              autoPlay muted playsInline
              width={208} height={156}
              style={{ ...S.camVid, border: `2px solid ${isBlocked ? '#EF4444' : '#334155'}` }}
            />
            {recording && <div style={S.recDot}>● REC</div>}
          </div>

          <div style={S.statusBox}>
            <div style={{ ...S.dot, background: status === 'active' ? '#22C55E' : status === 'loading' ? '#F59E0B' : '#EF4444' }} />
            <span style={{ fontSize: 12, color: '#94A3B8' }}>{statusText}</span>
          </div>

          <div style={S.violBox}>
            <span style={{ fontSize: 24, fontWeight: 700, color: '#EF4444' }}>{violations}</span>
            <span style={{ fontSize: 12, color: '#64748B', marginLeft: 6 }}>нарушений</span>
          </div>

          <div style={S.progBox}>
            <div style={S.progLabel}>Прогресс</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
              {QUESTIONS.map((q2, i) => (
                <div
                  key={q2.id}
                  onClick={() => !isBlocked && setCurrentQ(i)}
                  style={{
                    width: 20, height: 20, borderRadius: 4,
                    cursor: isBlocked ? 'not-allowed' : 'pointer',
                    transition: 'background 0.2s',
                    background: answers[q2.id] !== undefined ? '#22C55E' : i === currentQ ? '#2563EB' : '#334155',
                  }}
                />
              ))}
            </div>
            <div style={{ fontSize: 11, color: '#64748B' }}>
              {Object.keys(answers).length} / {QUESTIONS.length} отвечено
            </div>
          </div>

          <div style={S.warnBox}>
            <p style={{ fontSize: 12, color: '#FDE047', lineHeight: 2, margin: 0 }}>
              📷 Не покидайте кадр<br />
              🔇 Не разговаривайте<br />
              📵 Не пользуйтесь телефоном<br />
              🚫 При 5 нарушениях — бан
            </p>
          </div>
        </aside>

        {/* Main */}
        <main style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <div style={S.examHdr}>
            <Logo />
            <span style={{ flex: 1, fontSize: 15, fontWeight: 600 }}>Midterm Exam 2025</span>
            {recordingHash && (
              <span style={S.hashBadge}>🎥 {recordingHash.slice(0, 8)}…</span>
            )}
            <ExamTimer />
          </div>

          <div style={{ flex: 1, padding: 28, overflowY: 'auto' }}>
            <div style={{ ...S.qCard, ...(isBlocked ? { opacity: 0.35, pointerEvents: 'none' } : {}) }}>
              <span style={S.qNum}>Вопрос {currentQ + 1} / {QUESTIONS.length}</span>
              <p style={S.qText}>{q.text}</p>
              {q.options.map((opt, i) => {
                const sel = answers[q.id] === i;
                return (
                  <div
                    key={i}
                    onClick={() => selectAnswer(q.id, i)}
                    style={{ ...S.opt, ...(sel ? S.optSel : {}), cursor: isBlocked ? 'not-allowed' : 'pointer' }}
                  >
                    <div style={{ ...S.circle, ...(sel ? S.circleSel : {}) }}>
                      {sel && <div style={S.circleDot} />}
                    </div>
                    {opt}
                  </div>
                );
              })}
            </div>

            <div style={S.nav}>
              <button
                onClick={goPrev}
                disabled={currentQ === 0 || isBlocked}
                style={{ ...S.navBtn, ...((currentQ === 0 || isBlocked) ? S.navOff : {}) }}
              >
                ← Назад
              </button>
              <span style={{ fontSize: 13, color: '#475569' }}>{currentQ + 1} из {QUESTIONS.length}</span>
              {currentQ < QUESTIONS.length - 1
                ? (
                  <button
                    onClick={goNext}
                    disabled={isBlocked}
                    style={{ ...S.navBtn, ...S.navNext, ...(isBlocked ? S.navOff : {}) }}
                  >
                    Далее →
                  </button>
                ) : (
                  <button
                    onClick={submitExam}
                    disabled={isBlocked || submitting}
                    style={{ ...S.navBtn, ...S.navSubmit, ...((isBlocked || submitting) ? S.navOff : {}) }}
                  >
                    {submitting ? '⏳ Отправка...' : '✅ Сдать экзамен'}
                  </button>
                )
              }
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function ExamTimer() {
  const [sec, setSec] = useState(90 * 60);
  useEffect(() => {
    const t = setInterval(() => setSec(s => s > 0 ? s - 1 : 0), 1000);
    return () => clearInterval(t);
  }, []);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return (
    <div style={{
      padding: '6px 14px',
      background: sec < 600 ? '#450A0A' : '#0F172A',
      borderRadius: 7,
      fontSize: 14,
      fontWeight: 700,
      color: sec < 600 ? '#EF4444' : '#94A3B8',
    }}>
      ⏱ {h > 0 ? `${h}:` : ''}{String(m).padStart(2, '0')}:{String(s).padStart(2, '0')}
    </div>
  );
}

function Step({ n, title, done, action, label, children }) {
  return (
    <div style={{ marginBottom: 24, paddingBottom: 24, borderBottom: '1px solid #334155' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <div style={{
          width: 28, height: 28, borderRadius: '50%',
          background: done ? '#166834' : '#334155',
          color: done ? '#4ADE80' : '#94A3B8',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 13, fontWeight: 700,
        }}>
          {done ? '✓' : n}
        </div>
        <span style={{ fontSize: 15, fontWeight: 600 }}>{title}</span>
        {done && (
          <span style={{ marginLeft: 'auto', fontSize: 12, color: '#4ADE80', background: '#052E16', padding: '3px 10px', borderRadius: 20 }}>
            Готово
          </span>
        )}
      </div>
      <div style={{ paddingLeft: 40 }}>
        {children}
        {action && (
          <button onClick={action} style={{ padding: '9px 20px', background: '#1D4ED8', border: 'none', borderRadius: 7, color: '#fff', fontSize: 14, cursor: 'pointer', fontWeight: 500 }}>
            {label}
          </button>
        )}
      </div>
    </div>
  );
}

function Logo() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <svg width="24" height="24" viewBox="0 0 32 32" fill="none">
        <rect width="32" height="32" rx="8" fill="#2563EB" />
        <path d="M12 16.5L15 19.5L20 14" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span style={{ color: '#94A3B8', fontSize: 14, fontWeight: 600 }}>TrustExam</span>
    </div>
  );
}

const S = {
  page: { minHeight: '100vh', background: '#0F172A', color: '#F1F5F9', fontFamily: "'IBM Plex Sans',sans-serif" },
  overlay: { position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  overlayBox: { background: '#1A0A00', border: '2px solid #F59E0B', borderRadius: 16, padding: '40px 48px', textAlign: 'center', maxWidth: 400, boxShadow: '0 0 60px rgba(245,158,11,0.3)' },
  scoreCard: { background: '#1E293B', border: '1px solid #334155', borderRadius: 14, padding: '20px 32px', display: 'inline-block', minWidth: 200 },
  setupWrap: { maxWidth: 680, margin: '0 auto', padding: '32px 20px' },
  hdr: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 32 },
  hdrTitle: { flex: 1, fontSize: 18, fontWeight: 600 },
  hdrUser: { fontSize: 14, color: '#64748B' },
  exitBtn: { padding: '6px 14px', background: '#1E293B', border: '1px solid #334155', borderRadius: 7, color: '#94A3B8', fontSize: 13, cursor: 'pointer' },
  logoutBtn: { padding: '10px 24px', background: '#1E293B', border: '1px solid #334155', borderRadius: 8, color: '#F1F5F9', fontSize: 14, cursor: 'pointer' },
  card: { background: '#1E293B', border: '1px solid #334155', borderRadius: 14, padding: 32 },
  cardTitle: { fontSize: 20, fontWeight: 600, margin: '0 0 28px' },
  hint: { fontSize: 13, color: '#64748B', margin: '0 0 12px', lineHeight: 1.6 },
  prevVideo: { width: '100%', maxWidth: 300, height: 'auto', aspectRatio: '4/3', borderRadius: 8, border: '2px solid #22C55E', display: 'block', objectFit: 'cover', backgroundColor: '#0F172A' },
  camLabel: { position: 'absolute', bottom: 10, left: 6, fontSize: 11, color: '#4ADE80', background: 'rgba(0,0,0,0.6)', padding: '2px 8px', borderRadius: 4 },
  startBtn: { width: '100%', padding: 14, background: '#2563EB', border: 'none', borderRadius: 9, color: '#fff', fontSize: 16, fontWeight: 700, cursor: 'pointer', marginTop: 8 },
  startBtnOff: { background: '#1E3A5F', color: '#475569', cursor: 'not-allowed' },
  layout: { display: 'flex', minHeight: '100vh' },
  sidebar: { width: 240, background: '#1E293B', borderRight: '1px solid #334155', padding: 16, display: 'flex', flexDirection: 'column', gap: 12, flexShrink: 0 },
  camBox: { position: 'relative', borderRadius: 8, overflow: 'hidden', background: '#0F172A' },
  camVid: { display: 'block', width: '100%', height: 'auto', aspectRatio: '4/3', objectFit: 'cover', background: '#0F172A' },
  recDot: { position: 'absolute', top: 6, right: 8, fontSize: 10, fontWeight: 700, color: '#EF4444', background: 'rgba(0,0,0,0.7)', padding: '2px 7px', borderRadius: 10 },
  statusBox: { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: '#0F172A', borderRadius: 7 },
  dot: { width: 8, height: 8, borderRadius: '50%', flexShrink: 0 },
  violBox: { padding: '10px 14px', background: '#0F172A', borderRadius: 7, display: 'flex', alignItems: 'baseline' },
  progBox: { padding: '10px 14px', background: '#0F172A', borderRadius: 7 },
  progLabel: { fontSize: 11, color: '#475569', marginBottom: 8, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1 },
  warnBox: { padding: 12, background: '#1A1200', border: '1px solid #854D0E', borderRadius: 7, marginTop: 'auto' },
  examHdr: { display: 'flex', alignItems: 'center', gap: 16, padding: '14px 28px', borderBottom: '1px solid #334155' },
  hashBadge: { fontSize: 11, color: '#475569', background: '#1E293B', padding: '3px 10px', borderRadius: 20, fontFamily: 'monospace' },
  qCard: { background: '#1E293B', border: '1px solid #334155', borderRadius: 12, padding: 28, maxWidth: 720, transition: 'opacity 0.2s' },
  qNum: { fontSize: 12, color: '#64748B', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1 },
  qText: { fontSize: 18, fontWeight: 500, margin: '16px 0 24px', lineHeight: 1.6 },
  opt: { display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', marginBottom: 8, background: '#0F172A', border: '1px solid #334155', borderRadius: 8, fontSize: 14, userSelect: 'none' },
  optSel: { background: '#0F2550', border: '1px solid #2563EB' },
  circle: { width: 18, height: 18, borderRadius: '50%', border: '2px solid #334155', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  circleSel: { border: '2px solid #2563EB' },
  circleDot: { width: 8, height: 8, borderRadius: '50%', background: '#2563EB' },
  nav: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 24, maxWidth: 720 },
  navBtn: { padding: '10px 24px', background: '#1E293B', border: '1px solid #334155', borderRadius: 8, color: '#F1F5F9', fontSize: 14, cursor: 'pointer' },
  navOff: { opacity: 0.4, cursor: 'not-allowed' },
  navNext: { background: '#2563EB', border: 'none', fontWeight: 600 },
  navSubmit: { background: '#166834', border: 'none', fontWeight: 600, color: '#4ADE80' },
};