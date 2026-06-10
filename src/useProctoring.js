/**
 * useProctoring.js — AI proctoring hook (FIXED)
 *
 * Fixes:
 *  1. Face not in frame → triggers violation after 3 seconds
 *  2. Head turn → exposes `isBlocked` state so StudentExam can block answers
 *  3. Real-time warning text exposed to StudentExam for overlay display
 */

import { useRef, useState, useCallback } from 'react';
import { socket } from './socket';

const HEAD_TURN_THRESHOLD  = 0.28;   // ratio that counts as a turn
const HEAD_TURN_BLOCK_MS   = 500;    // block answers almost immediately on turn
const HEAD_TURN_VIOLATION_MS = 2500; // fire violation after 2.5s
const NO_FACE_VIOLATION_MS = 3000;   // fire violation after 3s of no face
const DETECTION_INTERVAL   = 2000;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Failed to load: ${src}`));
    document.head.appendChild(s);
  });
}

export function useProctoring({ studentId }) {
  const [status, setStatus]       = useState('idle');
  const [statusText, setStatusText] = useState('Камера не активна');
  // NEW: expose warning message and blocked state to StudentExam
  const [warning, setWarning]     = useState(null);   // null | string
  const [isBlocked, setIsBlocked] = useState(false);  // blocks answer selection

  const faceMeshRef        = useRef(null);
  const cocoModelRef       = useRef(null);
  const loopTimerRef       = useRef(null);
  const headTurnStartRef   = useRef(null);
  const headTurnFiredRef   = useRef(false);
  const noFaceStartRef     = useRef(null);
  const noFaceFiredRef     = useRef(false);
  const offscreenVideoRef  = useRef(null);

  const reportViolation = useCallback((reason, severity = 'warning') => {
    socket.emit('ai_violation', { studentId, reason, severity });
  }, [studentId]);

  const attachStream = useCallback((stream) => {
    if (!offscreenVideoRef.current) {
      const v = document.createElement('video');
      v.muted = true;
      v.playsInline = true;
      v.style.cssText = 'position:absolute;opacity:0;pointer-events:none;width:1px;height:1px;';
      document.body.appendChild(v);
      offscreenVideoRef.current = v;
    }
    offscreenVideoRef.current.srcObject = stream;
    offscreenVideoRef.current.play().catch(() => {});
  }, []);

  const initAI = useCallback(async (cameraStream) => {
    setStatus('loading');
    setStatusText('Загрузка AI моделей...');

    if (cameraStream) attachStream(cameraStream);

    try {
      await loadScript('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.20.0/dist/tf.min.js');
      setStatusText('TensorFlow загружен...');

      await loadScript('https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@2.2.3/dist/coco-ssd.min.js');
      setStatusText('COCO-SSD загружен...');

      await loadScript('https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4.1633559619/face_mesh.js');
      setStatusText('FaceMesh загружен...');

      cocoModelRef.current = await window.cocoSsd.load();

      const faceMesh = new window.FaceMesh({
        locateFile: (file) =>
          `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4.1633559619/${file}`,
      });

      faceMesh.setOptions({
        maxNumFaces: 1,
        refineLandmarks: false,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });

      faceMesh.onResults((results) => {
        // ── NO FACE IN FRAME ──────────────────────────────────────────
        if (!results.multiFaceLandmarks?.[0]) {
          // Reset head turn state
          headTurnStartRef.current = null;
          headTurnFiredRef.current = false;
          setIsBlocked(true);
          setWarning('⚠️ Лицо не в кадре — вернитесь в кадр!');
          setStatusText('⚠️ Лицо не в кадре');

          if (!noFaceStartRef.current) noFaceStartRef.current = Date.now();
          const elapsed = Date.now() - noFaceStartRef.current;

          if (elapsed > NO_FACE_VIOLATION_MS && !noFaceFiredRef.current) {
            noFaceFiredRef.current = true;
            reportViolation('⚠️ Лицо не в кадре более 3 секунд', 'warning');
          }
          return;
        }

        // Face found — reset no-face timer
        noFaceStartRef.current = null;
        noFaceFiredRef.current = false;

        const landmarks  = results.multiFaceLandmarks[0];
        const nose       = landmarks[1].x;
        const leftEye    = landmarks[33].x;
        const rightEye   = landmarks[263].x;
        const eyeCenter  = (leftEye + rightEye) / 2;
        const eyeWidth   = Math.abs(rightEye - leftEye);
        const turn       = (nose - eyeCenter) / eyeWidth;

        // ── HEAD TURN ────────────────────────────────────────────────
        if (Math.abs(turn) > HEAD_TURN_THRESHOLD) {
          if (!headTurnStartRef.current) headTurnStartRef.current = Date.now();
          const duration = Date.now() - headTurnStartRef.current;

          const dir = turn > 0 ? 'вправо →' : '← влево';

          // Block answers quickly
          if (duration > HEAD_TURN_BLOCK_MS) {
            setIsBlocked(true);
            setWarning(`⚠️ Поверните голову обратно! (${dir})`);
          }

          // Fire violation after longer duration
          if (duration > HEAD_TURN_VIOLATION_MS && !headTurnFiredRef.current) {
            headTurnFiredRef.current = true;
            reportViolation(`⚠️ Поворот головы ${turn > 0 ? 'вправо' : 'влево'} более 2.5 сек`, 'warning');
          }

          setStatusText(`👁 Поворот ${dir}`);
        } else {
          // Head is forward — unblock
          headTurnStartRef.current = null;
          headTurnFiredRef.current = false;
          setIsBlocked(false);
          setWarning(null);
          setStatusText('✅ Лицо в кадре');
        }
      });

      await faceMesh.initialize();
      faceMeshRef.current = faceMesh;

      setStatus('active');
      setStatusText('✅ AI прокторинг активен');
    } catch (err) {
      console.error('AI init error:', err);
      setStatus('error');
      setStatusText('❌ Ошибка загрузки AI');
    }
  }, [attachStream, reportViolation]);

  const startDetectionLoop = useCallback(() => {
    async function tick() {
      const video = offscreenVideoRef.current;
      if (!video || video.readyState < 2) {
        loopTimerRef.current = setTimeout(tick, DETECTION_INTERVAL);
        return;
      }

      if (faceMeshRef.current) {
        await faceMeshRef.current.send({ image: video }).catch(() => {});
      }

      if (cocoModelRef.current) {
        const detections = await cocoModelRef.current.detect(video).catch(() => []);
        const persons = detections.filter(d => d.class === 'person');
        if (persons.length > 1) {
          reportViolation('🚨 В кадре обнаружен второй человек!', 'critical');
        }
      }

      loopTimerRef.current = setTimeout(tick, DETECTION_INTERVAL);
    }
    tick();
  }, [reportViolation]);

  const stopDetection = useCallback(() => {
    clearTimeout(loopTimerRef.current);
    setStatus('idle');
    setStatusText('Экзамен завершён');
    setIsBlocked(false);
    setWarning(null);
    if (offscreenVideoRef.current) {
      offscreenVideoRef.current.srcObject = null;
      offscreenVideoRef.current.remove();
      offscreenVideoRef.current = null;
    }
  }, []);

  return {
    status,
    statusText,
    warning,       // NEW
    isBlocked,     // NEW
    initAI,
    startDetectionLoop,
    stopDetection,
    attachStream,
  };
}