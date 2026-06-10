import React, { useState } from 'react';
import StudentExam from './StudentExam';
import ProctorDashboard from './ProctorDashboard';

export default function App() {
  const [session, setSession] = useState(null);

  function handleLogout() {
    setSession(null);
  }

  if (!session) return <LoginPage onLogin={setSession} />;
  if (session.role === 'student') return <StudentExam session={session} onLogout={handleLogout} />;
  if (session.role === 'proctor') return <ProctorDashboard session={session} onLogout={handleLogout} />;
}

function LoginPage({ onLogin }) {
  const [username, setUsername] = useState('');
  const [role, setRole] = useState('student');

  function handleLogin() {
    if (!username.trim()) return;
    const studentId = role === 'student' ? `student_${username.toLowerCase().replace(/\s+/g, '_')}` : null;
    onLogin({ role, username, studentId });
  }

  return (
    <div style={styles.loginPage}>
      <div style={styles.loginCard}>
        <div style={styles.logo}>
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
            <rect width="32" height="32" rx="8" fill="#2563EB"/>
            <path d="M16 6L26 11V17C26 22.5 21.5 27.4 16 29C10.5 27.4 6 22.5 6 17V11L16 6Z" fill="white" fillOpacity="0.15"/>
            <path d="M16 8L24 12.5V17C24 21.5 20.5 25.8 16 27C11.5 25.8 8 21.5 8 17V12.5L16 8Z" stroke="white" strokeWidth="1.5"/>
            <path d="M12 16.5L15 19.5L20 14" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <span style={styles.logoText}>TrustExam</span>
        </div>
        <h1 style={styles.loginTitle}>Вход в систему</h1>
        <p style={styles.loginSubtitle}>Система онлайн-прокторинга</p>
        <div style={styles.roleSwitch}>
          {['student', 'proctor'].map(r => (
            <button key={r} onClick={() => setRole(r)}
              style={{ ...styles.roleBtn, ...(role === r ? styles.roleBtnActive : {}) }}>
              {r === 'student' ? '🎓 Студент' : '👁 Проктор'}
            </button>
          ))}
        </div>
        <input
          placeholder={role === 'student' ? 'Ваше имя (напр. Erkebulan)' : 'Имя проктора'}
          value={username}
          onChange={e => setUsername(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleLogin()}
          style={styles.input}
          autoFocus
        />
        <button onClick={handleLogin} style={styles.loginBtn}>Войти →</button>
        <p style={styles.loginHint}>
          {role === 'student'
            ? 'Студент: нужна камера + разрешение на запись экрана'
            : 'Проктор: наблюдение за студентами, оценки и записи'}
        </p>
      </div>
    </div>
  );
}

const styles = {
  loginPage: { minHeight: '100vh', background: '#0F172A', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'IBM Plex Sans', sans-serif" },
  loginCard: { background: '#1E293B', border: '1px solid #334155', borderRadius: 16, padding: '40px 48px', width: 400, textAlign: 'center' },
  logo: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, marginBottom: 28 },
  logoText: { fontSize: 22, fontWeight: 700, color: '#F1F5F9', letterSpacing: '-0.5px' },
  loginTitle: { fontSize: 22, fontWeight: 600, color: '#F1F5F9', margin: '0 0 6px' },
  loginSubtitle: { fontSize: 14, color: '#64748B', margin: '0 0 28px' },
  roleSwitch: { display: 'flex', background: '#0F172A', borderRadius: 10, padding: 4, gap: 4, marginBottom: 20 },
  roleBtn: { flex: 1, padding: '8px 0', border: 'none', borderRadius: 7, background: 'transparent', color: '#64748B', fontSize: 14, cursor: 'pointer', transition: 'all 0.15s' },
  roleBtnActive: { background: '#2563EB', color: '#fff', fontWeight: 600 },
  input: { width: '100%', padding: '12px 14px', background: '#0F172A', border: '1px solid #334155', borderRadius: 8, color: '#F1F5F9', fontSize: 15, boxSizing: 'border-box', marginBottom: 14, outline: 'none' },
  loginBtn: { width: '100%', padding: '13px', background: '#2563EB', border: 'none', borderRadius: 8, color: '#fff', fontSize: 15, fontWeight: 600, cursor: 'pointer', marginBottom: 16 },
  loginHint: { fontSize: 12, color: '#475569', margin: 0, lineHeight: 1.6 },
};