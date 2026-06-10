/**
 * useRecording.js — РАЗДЕЛЬНАЯ запись экрана и лица
 *
 * Создаёт ДВА файла:
 *   {hash}_screen.webm — запись экрана  (1280×720, VP9, 3 Mbps)
 *   {hash}_face.webm   — запись лица    (640×480,  VP9, 1.5 Mbps)
 */

import { useRef, useState, useCallback } from 'react';

const SERVER = 'http://localhost:5000';
const CHUNK_INTERVAL_MS = 5000;

export function useRecording({ studentId }) {
  const [recording, setRecording]         = useState(false);
  const [recordingHash, setRecordingHash] = useState(null);
  const [recordingUrl, setRecordingUrl]   = useState(null);
  const [faceUrl, setFaceUrl]             = useState(null);
  const [screenStream, setScreenStream]   = useState(null);

  const cameraStreamRef   = useRef(null);
  const screenStreamRef   = useRef(null);
  const screenRecorderRef = useRef(null);
  const faceRecorderRef   = useRef(null);
  const screenChunksRef   = useRef([]);
  const faceChunksRef     = useRef([]);
  const chunkTimerRef     = useRef(null);
  const hashRef           = useRef(null);

  const requestCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 }, facingMode: 'user' },
        audio: false,
      });
      cameraStreamRef.current = stream;
      return stream;
    } catch (err) {
      console.error('[REC] Camera error:', err);
      throw new Error('Не удалось получить доступ к камере. Разрешите в настройках браузера.');
    }
  }, []);

  const requestScreenShare = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30, max: 60 } },
        audio: false,
      });
      screenStreamRef.current = stream;
      setScreenStream(stream);
      stream.getVideoTracks()[0].addEventListener('ended', () => {
        console.log('[REC] Screen share stopped by user');
        stopRecording();
      });
      return stream;
    } catch (err) {
      console.error('[REC] Screen share error:', err);
      throw new Error('Не удалось получить доступ к экрану. Разрешите шейринг.');
    }
  }, []);

  const flushChunks = useCallback(async (type, chunksRef) => {
    if (chunksRef.current.length === 0) return;
    const mimeType = getSupportedMimeType();
    const blob = new Blob(chunksRef.current, { type: mimeType });
    chunksRef.current = [];
    try {
      const arrayBuf = await blob.arrayBuffer();
      await fetch(`${SERVER}/api/recording/chunk`, {
        method: 'POST',
        headers: { 'Content-Type': 'video/webm', 'x-student-id': studentId, 'x-recording-type': type },
        body: arrayBuf,
      });
    } catch (err) {
      console.error(`[REC] Chunk send error (${type}):`, err);
    }
  }, [studentId]);

  const startRecording = useCallback(async (cameraStream) => {
    if (!cameraStream && !cameraStreamRef.current) throw new Error('Сначала включите камеру');
    const camStream = cameraStream || cameraStreamRef.current;

    const scrStream = await requestScreenShare();

    const res = await fetch(`${SERVER}/api/recording/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentId }),
    });
    const { hash } = await res.json();
    hashRef.current = hash;
    setRecordingHash(hash);

    const mimeType = getSupportedMimeType();

    // Recorder для экрана — 3 Mbps высокое качество
    const screenRecorder = new MediaRecorder(scrStream, { mimeType, videoBitsPerSecond: 3_000_000 });
    screenRecorder.ondataavailable = (e) => { if (e.data?.size > 0) screenChunksRef.current.push(e.data); };
    screenRecorderRef.current = screenRecorder;

    // Recorder для лица — 1.5 Mbps высокое качество
    const faceRecorder = new MediaRecorder(camStream, { mimeType, videoBitsPerSecond: 1_500_000 });
    faceRecorder.ondataavailable = (e) => { if (e.data?.size > 0) faceChunksRef.current.push(e.data); };
    faceRecorderRef.current = faceRecorder;

    screenRecorder.start(1000);
    faceRecorder.start(1000);

    chunkTimerRef.current = setInterval(() => {
      flushChunks('screen', screenChunksRef);
      flushChunks('face', faceChunksRef);
    }, CHUNK_INTERVAL_MS);

    setRecording(true);
    console.log(`[REC] Started — hash: ${hash}`);
  }, [studentId, requestScreenShare, flushChunks]);

  const stopRecording = useCallback(async () => {
    if (!screenRecorderRef.current && !faceRecorderRef.current) return;

    clearInterval(chunkTimerRef.current);

    await Promise.all([
      new Promise((resolve) => {
        const rec = screenRecorderRef.current;
        if (!rec) return resolve();
        rec.onstop = resolve;
        if (rec.state !== 'inactive') rec.stop(); else resolve();
      }),
      new Promise((resolve) => {
        const rec = faceRecorderRef.current;
        if (!rec) return resolve();
        rec.onstop = resolve;
        if (rec.state !== 'inactive') rec.stop(); else resolve();
      }),
    ]);

    await flushChunks('screen', screenChunksRef);
    await flushChunks('face', faceChunksRef);

    screenStreamRef.current?.getTracks().forEach(t => t.stop());
    screenStreamRef.current = null;
    setScreenStream(null);

    cameraStreamRef.current?.getTracks().forEach(t => t.stop());
    cameraStreamRef.current = null;

    const res = await fetch(`${SERVER}/api/recording/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentId }),
    }).catch(() => null);

    if (res?.ok) {
      const data = await res.json();
      setRecordingUrl(data.screenUrl);
      setFaceUrl(data.faceUrl);
      console.log(`[REC] Stopped — screen: ${data.screenUrl}, face: ${data.faceUrl}`);
    }

    screenRecorderRef.current = null;
    faceRecorderRef.current = null;
    setRecording(false);
  }, [studentId, flushChunks]);

  return {
    recording, recordingHash, recordingUrl, faceUrl,
    screenStream, requestCamera, startRecording, stopRecording, cameraStreamRef,
  };
}

function getSupportedMimeType() {
  const types = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  for (const t of types) { if (MediaRecorder.isTypeSupported(t)) return t; }
  return 'video/webm';
}