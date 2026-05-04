/**
 * Voice recorder — cross-platform via expo-audio (native iOS/Android) with
 * a MediaRecorder fallback on web.
 *
 * The hook returns a plain imperative API (start / stop / cancel) plus a
 * permission helper, so callers can drive it from event handlers without
 * reasoning about React Native's audio module surface.
 */
import { useCallback, useRef } from "react";
import { Platform } from "react-native";
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  useAudioRecorder,
} from "expo-audio";

export interface VoiceRecorderHandle {
  start(): Promise<void>;
  stop(): Promise<Blob | null>;
  cancel(): void;
}

/** Always available — expo-audio ships with a MediaRecorder-backed web shim,
 *  and on iOS/Android the hook is wired to AVFoundation / MediaRecorder. */
export const recorderAvailable = true;

export function useVoiceRecorder(): VoiceRecorderHandle {
  // expo-audio's hook owns lifecycle; we just dispatch start/stop and pull
  // the resulting URI on stop. RecordingPresets.HIGH_QUALITY is a sensible
  // default; Whisper accepts m4a/webm/mp3/wav/ogg etc.
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  // Web MediaRecorder ref — used as a more reliable fallback when expo-audio
  // web has issues (some browsers' MediaRecorder paths through expo-audio
  // are flaky in late 2025 as of SDK 54). Empty when running native.
  const webRef = useRef<{ recorder: MediaRecorder; chunks: Blob[]; stream: MediaStream } | null>(null);

  const start = useCallback(async () => {
    if (Platform.OS === "web") {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const candidates = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/mp4",
        "audio/ogg;codecs=opus",
      ];
      const mime = candidates.find(
        (c) => (window as any).MediaRecorder?.isTypeSupported?.(c),
      );
      const mr = new (window as any).MediaRecorder(
        stream,
        mime ? { mimeType: mime } : undefined,
      );
      const chunks: Blob[] = [];
      mr.ondataavailable = (e: any) => {
        if (e.data && e.data.size > 0) chunks.push(e.data);
      };
      webRef.current = { recorder: mr, chunks, stream };
      mr.start();
      return;
    }

    // Native: ask once, then begin.
    const perm = await requestRecordingPermissionsAsync();
    if (!perm.granted) {
      throw new Error("Microphone permission was not granted");
    }
    await recorder.prepareToRecordAsync();
    recorder.record();
  }, [recorder]);

  const stop = useCallback(async (): Promise<Blob | null> => {
    if (Platform.OS === "web") {
      const ctx = webRef.current;
      if (!ctx) return null;
      webRef.current = null;
      const done = new Promise<Blob>((resolve) => {
        ctx.recorder.onstop = () => {
          ctx.stream.getTracks().forEach((t) => t.stop());
          resolve(new Blob(ctx.chunks, { type: ctx.recorder.mimeType || "audio/webm" }));
        };
      });
      if (ctx.recorder.state !== "inactive") ctx.recorder.stop();
      return await done;
    }

    await recorder.stop();
    const uri = recorder.uri;
    if (!uri) return null;
    // expo-audio gives us a file:// URI on native; fetch reads it as a Blob
    // so the upload path is the same as web.
    const resp = await fetch(uri);
    return await resp.blob();
  }, [recorder]);

  const cancel = useCallback(() => {
    if (Platform.OS === "web") {
      const ctx = webRef.current;
      if (!ctx) return;
      try {
        ctx.stream.getTracks().forEach((t) => t.stop());
        if (ctx.recorder.state !== "inactive") ctx.recorder.stop();
      } catch {
        // noop
      }
      webRef.current = null;
      return;
    }
    recorder.stop().catch(() => {});
  }, [recorder]);

  return { start, stop, cancel };
}

/** Upload a recorded blob to /v1/voice and return the transcript. */
export async function transcribe(
  apiUrl: string,
  jwt: string,
  audio: Blob,
): Promise<string> {
  const fd = new FormData();
  const ext = (audio.type.split("/")[1] || "webm").split(";")[0];
  fd.append("audio", audio, `voice.${ext}`);
  const r = await fetch(`${apiUrl}/v1/voice`, {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}` },
    body: fd,
  });
  if (!r.ok) {
    const detail = await r.text().catch(() => "");
    throw new Error(`/v1/voice ${r.status}: ${detail.slice(0, 200)}`);
  }
  const data = await r.json();
  return (data?.text || "").trim();
}
