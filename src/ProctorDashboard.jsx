/**
 * ProctorDashboard.jsx v4
 * Таб "Записи": для каждого студента две кнопки — "Экран" и "Лицо"
 */

import React, { useState, useEffect, useRef } from 'react';
import { socket } from './socket';

const SERVER = 'http://localhost:5000';

const STATUS_CONFIG = {
  active:  { label: 'Онлайн',       color: '#22C55E', bg: '#052E16' },
  warned:  { label: 'Предупреждён', color: '#F59E0B', bg: '#451A03' },
  banned:  { label: 'Забанен',       color: '#EF4444', bg: '#450A0A' },
  offline: { label: 'Оффлайн',       color: '#475569', bg: '#1E293B' },
};

export default function ProctorDashboard({ session }) {
  const { username } = session;

  const [students, setStudents]         = useState([]);
  const [selectedId, setSelectedId]     = useState(null);
  const [commentText, setCommentText]   = useState('');
  const [connectedCount, setConnectedCount] = useState(0);
  const [tab, setTab]                   = useState('students');
  const [recordings, setRecordings]     = useState([]);
  const [playingUrl, setPlayingUrl]     = useState(null);
  const [playingTitle, setPlayingTitle] = useState('');
  const [scoreInput, setScoreInput]     = useState('');

  const commentsEndRef = useRef(null);

  useEffect(() => {
    socket.connect();
    socket.emit('proctor_join', { username });
    socket.on('init', (initial) => {
      setStudents(initial);
      setConnectedCount(initial.filter(s => s.status === 'active' || s.status === 'warned').length);
    });
    socket.on('students_update', (updated) => {
      setStudents(updated);
      setConnectedCount(updated.filter(s => s.status === 'active' || s.status === 'warned').length);
    });
    return () => { socket.off('init'); socket.off('students_update'); socket.disconnect(); };
  }, [username]);

  useEffect(() => {
    if (tab === 'recordings') loadRecordings();
  }, [tab]);

  async function loadRecordings() {
    try {
      const res = await fetch(`${SERVER}/api/recordings`);
      setRecordings(await res.json());
    } catch { console.error('Failed to load recordings'); }
  }

  useEffect(() => { commentsEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [students, selectedId]);

  const selectedStudent = students.find(s => s.id === selectedId);

  function sendComment() {
    if (!commentText.trim() || !selectedId) return;
    fetch(`${SERVER}/api/students/${selectedId}/comment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ author: username, text: commentText }),
    });
    setCommentText('');
  }

  function setVerdict(verdict) {
    if (!selectedId) return;
    fetch(`${SERVER}/api/students/${selectedId}/verdict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ verdict }),
    });
  }

  function submitScore() {
    if (!selectedId || !scoreInput.trim()) return;
    fetch(`${SERVER}/api/students/${selectedId}/score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ score: scoreInput.trim() }),
    });
    setScoreInput('');
  }

  function openVideo(url, title) {
    setPlayingUrl(SERVER + url);
    setPlayingTitle(title);
  }

  function formatSize(bytes) {
    if (!bytes) return '—';
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  return (
    <div style={S.page}>
      {/* Header */}
      <header style={S.header}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <svg width="24" height="24" viewBox="0 0 32 32" fill="none">
            <rect width="32" height="32" rx="8" fill="#2563EB"/>
            <path d="M12 16.5L15 19.5L20 14" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <span style={S.headerBrand}>TrustExam</span>
          <span style={S.headerRole}>Панель проктора</span>
        </div>

        <div style={S.tabSwitch}>
          <button onClick={() => setTab('students')} style={{ ...S.tabBtn, ...(tab === 'students' ? S.tabBtnActive : {}) }}>
            👥 Студенты
          </button>
          <button onClick={() => setTab('recordings')} style={{ ...S.tabBtn, ...(tab === 'recordings' ? S.tabBtnActive : {}) }}>
            🎥 Записи
          </button>
        </div>

        <div style={S.headerStats}>
          <Stat label="Онлайн" value={connectedCount} color="#22C55E" />
          <Stat label="Всего" value={students.length} color="#94A3B8" />
          <Stat label="Нарушений" value={students.reduce((s, st) => s + st.violations, 0)} color="#EF4444" />
        </div>
        <span style={S.headerUser}>👁 {username}</span>
      </header>

      {/* ── STUDENTS TAB ──────────────────────────────────────────────── */}
      {tab === 'students' && (
        <div style={S.body}>
          <aside style={S.studentList}>
            <div style={S.listHeader}>Студенты</div>
            {students.length === 0 && <div style={S.emptyList}>Ожидание студентов...</div>}
            {students.map(student => {
              const cfg = STATUS_CONFIG[student.status] || STATUS_CONFIG.offline;
              const isSelected = student.id === selectedId;
              return (
                <div key={student.id} onClick={() => setSelectedId(student.id)}
                  style={{ ...S.studentCard, ...(isSelected ? S.studentCardSelected : {}) }}>
                  <div style={S.avatar}>{student.name[0].toUpperCase()}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={S.studentName}>{student.name}</div>
                    <div style={S.studentExam}>{student.examTitle}</div>
                    {student.recordingHash && (
                      <div style={{ fontSize: 10, color: '#475569', fontFamily: 'monospace', marginTop: 2 }}>
                        🎥 {student.recordingHash}
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                    <span style={{ ...S.statusBadge, color: cfg.color, background: cfg.bg }}>{cfg.label}</span>
                    {student.violations > 0 && <span style={S.violBadge}>{student.violations} наруш.</span>}
                  </div>
                </div>
              );
            })}
          </aside>

          <main style={S.detail}>
            {!selectedStudent ? (
              <div style={S.noSelection}>
                <span style={{ fontSize: 48 }}>👈</span>
                <p>Выберите студента из списка</p>
              </div>
            ) : (
              <>
                <div style={S.detailHeader}>
                  <div style={S.detailAvatar}>{selectedStudent.name[0].toUpperCase()}</div>
                  <div>
                    <div style={S.detailName}>{selectedStudent.name}</div>
                    <div style={S.detailSub}>
                      {selectedStudent.examTitle} · Вошёл в {selectedStudent.joinedAt}
                      {selectedStudent.recordingHash && (
                        <span style={{ marginLeft: 10, fontFamily: 'monospace', color: '#475569' }}>
                          hash: {selectedStudent.recordingHash}
                        </span>
                      )}
                    </div>
                  </div>
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {/* Кнопки просмотра двух видео */}
                    {selectedStudent.screenUrl && (
                      <button onClick={() => openVideo(selectedStudent.screenUrl, `${selectedStudent.name} — Экран`)}
                        style={{ ...S.verdictBtn, background: '#0C2240', color: '#60A5FA' }}>
                        🖥 Экран
                      </button>
                    )}
                    {selectedStudent.faceUrl && (
                      <button onClick={() => openVideo(selectedStudent.faceUrl, `${selectedStudent.name} — Лицо`)}
                        style={{ ...S.verdictBtn, background: '#1A0A2E', color: '#C084FC' }}>
                        📷 Лицо
                      </button>
                    )}
                    <button onClick={() => setVerdict('cleared')} style={{ ...S.verdictBtn, ...S.verdictClear }}>✅ Оправдать</button>
                    <button onClick={() => setVerdict('banned')} style={{ ...S.verdictBtn, ...S.verdictBan }}>🚫 Забанить</button>
                  </div>
                </div>

                <div style={S.statsRow}>
                  <MiniStat label="Нарушений" value={selectedStudent.violations} danger={selectedStudent.violations >= 3} />
                  <MiniStat label="Комментариев" value={selectedStudent.comments.length} />
                  <MiniStat label="Статус" value={(STATUS_CONFIG[selectedStudent.status] || STATUS_CONFIG.offline).label} />
                  <MiniStat label="Автооценка" value={selectedStudent.autoScore != null ? `${selectedStudent.autoScore}%` : '—'} />
                  <MiniStat label="Оценка проктора" value={selectedStudent.score ?? '—'} />
                </div>

                {/* Выставить оценку */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 24px', borderBottom: '1px solid #1E293B' }}>
                  <span style={{ fontSize: 12, color: '#64748B', flexShrink: 0 }}>Выставить оценку:</span>
                  <input value={scoreInput} onChange={e => setScoreInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && submitScore()}
                    placeholder="напр. 85 или A+"
                    style={{ ...S.commentInput, flex: 1, fontSize: 13, padding: '7px 12px' }} />
                  <button onClick={submitScore} style={{ ...S.commentBtn, padding: '7px 16px', fontSize: 13 }}>Сохранить</button>
                </div>

                <div style={S.logTitle}>Журнал событий</div>
                <div style={S.logContainer}>
                  {selectedStudent.comments.length === 0 && <div style={S.logEmpty}>Нарушений не зафиксировано</div>}
                  {selectedStudent.comments.map((c, i) => (
                    <div key={c.id || i} style={{
                      ...S.logEntry,
                      ...(c.isAI ? S.logEntryAI : {}),
                      ...(c.severity === 'critical' ? S.logEntryCritical : {}),
                    }}>
                      <span style={S.logAuthor}>{c.author}</span>
                      <span style={S.logText}>{c.text}</span>
                      <span style={S.logTime}>{c.time}</span>
                    </div>
                  ))}
                  <div ref={commentsEndRef} />
                </div>

                <div style={S.commentBox}>
                  <input value={commentText} onChange={e => setCommentText(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && sendComment()}
                    placeholder="Добавить комментарий проктора..."
                    style={S.commentInput} />
                  <button onClick={sendComment} style={S.commentBtn}>Отправить</button>
                </div>
              </>
            )}
          </main>
        </div>
      )}

      {/* ── RECORDINGS TAB ───────────────────────────────────────────── */}
      {tab === 'recordings' && (
        <div style={{ flex: 1, padding: 24, overflowY: 'auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <h2 style={{ margin: 0, fontSize: 18 }}>Сохранённые записи</h2>
            <button onClick={loadRecordings} style={S.refreshBtn}>↻ Обновить</button>
          </div>

          {recordings.length === 0 ? (
            <div style={{ color: '#475569', textAlign: 'center', marginTop: 60, fontSize: 16 }}>
              <div style={{ fontSize: 48, marginBottom: 12 }}>🎥</div>
              Записи появятся когда студенты начнут экзамен.
            </div>
          ) : (
            <div style={S.recordingsGrid}>
              {recordings.map(rec => (
                <div key={rec.hash} style={S.recCard}>
                  {/* Два превью — экран и лицо */}
                  <div style={{ display: 'flex', gap: 2 }}>
                    <div style={{ ...S.recThumb, flex: 1 }} onClick={() => openVideo(rec.screenUrl, `${rec.studentName} — Экран`)}>
                      <span style={{ fontSize: 24 }}>🖥</span>
                      <span style={{ fontSize: 11, marginTop: 4, color: '#60A5FA' }}>Экран</span>
                      <span style={{ fontSize: 10, color: '#475569', marginTop: 2 }}>{formatSize(rec.screenSize)}</span>
                    </div>
                    {rec.faceUrl ? (
                      <div style={{ ...S.recThumb, flex: 1, borderLeft: '1px solid #0F172A' }} onClick={() => openVideo(rec.faceUrl, `${rec.studentName} — Лицо`)}>
                        <span style={{ fontSize: 24 }}>📷</span>
                        <span style={{ fontSize: 11, marginTop: 4, color: '#C084FC' }}>Лицо</span>
                        <span style={{ fontSize: 10, color: '#475569', marginTop: 2 }}>{formatSize(rec.faceSize)}</span>
                      </div>
                    ) : (
                      <div style={{ ...S.recThumb, flex: 1, borderLeft: '1px solid #0F172A', opacity: 0.3 }}>
                        <span style={{ fontSize: 24 }}>📷</span>
                        <span style={{ fontSize: 11, marginTop: 4, color: '#475569' }}>Нет</span>
                      </div>
                    )}
                  </div>

                  <div style={S.recInfo}>
                    <div style={S.recStudent}>{rec.studentName}</div>
                    <div style={S.recHash}>🔑 {rec.hash}</div>
                    <div style={S.recMeta}>{new Date(rec.created).toLocaleString('ru-RU')}</div>

                    {/* Кнопки просмотра */}
                    <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
                      <button onClick={() => openVideo(rec.screenUrl, `${rec.studentName} — Экран`)}
                        style={{ ...S.recBtn, background: '#1D4ED8' }}>
                        ▶ Экран
                      </button>
                      {rec.faceUrl && (
                        <button onClick={() => openVideo(rec.faceUrl, `${rec.studentName} — Лицо`)}
                          style={{ ...S.recBtn, background: '#6D28D9' }}>
                          ▶ Лицо
                        </button>
                      )}
                      <a href={SERVER + rec.screenUrl} download={`${rec.hash}_screen.webm`} style={S.recBtnDownload}>
                        ↓ Экран
                      </a>
                      {rec.faceUrl && (
                        <a href={SERVER + rec.faceUrl} download={`${rec.hash}_face.webm`} style={S.recBtnDownload}>
                          ↓ Лицо
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Видеоплеер ────────────────────────────────────────────────── */}
      {playingUrl && (
        <div style={S.modal} onClick={() => setPlayingUrl(null)}>
          <div style={S.modalContent} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: '#F1F5F9' }}>{playingTitle}</span>
              <button onClick={() => setPlayingUrl(null)} style={S.closeBtn}>✕</button>
            </div>
            <video src={playingUrl} controls autoPlay
              style={{ width: '100%', borderRadius: 8, background: '#000', maxHeight: '70vh' }} />
            <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
              <a href={playingUrl} download style={{ ...S.recBtnDownload, textAlign: 'center' }}>
                ↓ Скачать это видео
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, color }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 20, fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: 11, color: '#475569' }}>{label}</div>
    </div>
  );
}

function MiniStat({ label, value, danger }) {
  return (
    <div style={S.miniStat}>
      <div style={{ fontSize: 22, fontWeight: 700, color: danger ? '#EF4444' : '#F1F5F9' }}>{value}</div>
      <div style={{ fontSize: 12, color: '#64748B' }}>{label}</div>
    </div>
  );
}

const S = {
  page: { minHeight: '100vh', background: '#0F172A', color: '#F1F5F9', fontFamily: "'IBM Plex Sans', sans-serif", display: 'flex', flexDirection: 'column' },
  header: { display: 'flex', alignItems: 'center', gap: 16, padding: '14px 24px', borderBottom: '1px solid #1E293B', background: '#0F172A', flexWrap: 'wrap' },
  headerBrand: { fontSize: 16, fontWeight: 700 },
  headerRole: { fontSize: 13, color: '#475569', padding: '3px 10px', background: '#1E293B', borderRadius: 20 },
  tabSwitch: { display: 'flex', background: '#1E293B', borderRadius: 8, padding: 3, gap: 3 },
  tabBtn: { padding: '6px 16px', border: 'none', borderRadius: 6, background: 'transparent', color: '#64748B', fontSize: 13, cursor: 'pointer' },
  tabBtnActive: { background: '#2563EB', color: '#fff', fontWeight: 600 },
  headerStats: { display: 'flex', gap: 24, marginLeft: 'auto' },
  headerUser: { fontSize: 13, color: '#64748B' },
  body: { display: 'flex', flex: 1, overflow: 'hidden' },
  studentList: { width: 280, borderRight: '1px solid #1E293B', overflowY: 'auto', flexShrink: 0 },
  listHeader: { padding: '14px 16px', fontSize: 11, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: 1, borderBottom: '1px solid #1E293B' },
  emptyList: { padding: 24, color: '#475569', fontSize: 14, textAlign: 'center' },
  studentCard: { display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px 16px', cursor: 'pointer', borderBottom: '1px solid #1E293B', transition: 'background 0.1s' },
  studentCardSelected: { background: '#1E293B' },
  avatar: { width: 36, height: 36, borderRadius: '50%', background: '#1D4ED8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, flexShrink: 0 },
  studentName: { fontSize: 14, fontWeight: 600 },
  studentExam: { fontSize: 11, color: '#64748B' },
  statusBadge: { fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20 },
  violBadge: { fontSize: 10, color: '#EF4444', background: '#450A0A', padding: '2px 7px', borderRadius: 20 },
  detail: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  noSelection: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#334155', gap: 12 },
  detailHeader: { display: 'flex', alignItems: 'center', gap: 14, padding: '20px 24px', borderBottom: '1px solid #1E293B', flexWrap: 'wrap' },
  detailAvatar: { width: 44, height: 44, borderRadius: '50%', background: '#1D4ED8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 700, flexShrink: 0 },
  detailName: { fontSize: 17, fontWeight: 700 },
  detailSub: { fontSize: 12, color: '#64748B', marginTop: 3 },
  verdictBtn: { padding: '8px 14px', border: 'none', borderRadius: 7, fontSize: 13, cursor: 'pointer', fontWeight: 600 },
  verdictClear: { background: '#052E16', color: '#4ADE80' },
  verdictBan: { background: '#450A0A', color: '#EF4444' },
  statsRow: { display: 'flex', gap: 1, borderBottom: '1px solid #1E293B', flexWrap: 'wrap' },
  miniStat: { flex: 1, padding: '16px 20px', borderRight: '1px solid #1E293B', minWidth: 80 },
  logTitle: { padding: '10px 24px', fontSize: 11, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: 1 },
  logContainer: { flex: 1, overflowY: 'auto', padding: '0 24px 12px' },
  logEmpty: { color: '#334155', fontSize: 14, padding: '24px 0', textAlign: 'center' },
  logEntry: { display: 'flex', alignItems: 'baseline', gap: 10, padding: '9px 12px', marginBottom: 6, background: '#1E293B', borderRadius: 8, fontSize: 13 },
  logEntryAI: { background: '#1A1200', borderLeft: '3px solid #F59E0B' },
  logEntryCritical: { background: '#450A0A', borderLeft: '3px solid #EF4444' },
  logAuthor: { fontSize: 11, color: '#64748B', flexShrink: 0 },
  logText: { flex: 1, color: '#F1F5F9' },
  logTime: { fontSize: 11, color: '#475569', flexShrink: 0 },
  commentBox: { display: 'flex', gap: 10, padding: '14px 24px', borderTop: '1px solid #1E293B' },
  commentInput: { flex: 1, padding: '10px 14px', background: '#1E293B', border: '1px solid #334155', borderRadius: 8, color: '#F1F5F9', fontSize: 14, outline: 'none' },
  commentBtn: { padding: '10px 20px', background: '#2563EB', border: 'none', borderRadius: 8, color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer' },
  refreshBtn: { padding: '7px 16px', background: '#1E293B', border: '1px solid #334155', borderRadius: 7, color: '#94A3B8', fontSize: 13, cursor: 'pointer' },
  recordingsGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 16 },
  recCard: { background: '#1E293B', border: '1px solid #334155', borderRadius: 12, overflow: 'hidden' },
  recThumb: { background: '#0F172A', height: 100, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#475569', transition: 'background 0.15s' },
  recInfo: { padding: 16 },
  recStudent: { fontSize: 15, fontWeight: 600, marginBottom: 6 },
  recHash: { fontSize: 11, color: '#475569', fontFamily: 'monospace', marginBottom: 4 },
  recMeta: { fontSize: 12, color: '#64748B' },
  recBtn: { padding: '6px 14px', border: 'none', borderRadius: 6, color: '#fff', fontSize: 13, cursor: 'pointer', fontWeight: 500 },
  recBtnDownload: { padding: '6px 14px', background: '#1E293B', border: '1px solid #334155', borderRadius: 6, color: '#94A3B8', fontSize: 13, cursor: 'pointer', textDecoration: 'none' },
  modal: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modalContent: { background: '#1E293B', border: '1px solid #334155', borderRadius: 14, padding: 20, width: '90%', maxWidth: 960 },
  closeBtn: { padding: '6px 12px', background: '#334155', border: 'none', borderRadius: 6, color: '#F1F5F9', cursor: 'pointer', fontSize: 14, flexShrink: 0 },
};