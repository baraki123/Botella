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
  setAudioModeAsync,
  useAudioRecorder,
} from "expo-audio";

/** Native uploads use the file URI directly; web uploads a Blob captured
 *  from MediaRecorder. The transcribe() helper accepts either. */
export type AudioSource =
  | { kind: "blob"; blob: Blob }
  | { kind: "file"; uri: string; mime: string; size: number };

export interface VoiceRecorderHandle {
  start(): Promise<void>;
  stop(): Promise<AudioSource | null>;
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
    // iOS routes audio through an AVAudioSession category — without this,
    // prepareToRecordAsync() flips on a "playback only" session and record()
    // captures silence. Has to be called before prepare; safe to call every
    // start (idempotent at the OS level).
    await setAudioModeAsync({
      allowsRecording: true,
      playsInSilentMode: true,
    });
    await recorder.prepareToRecordAsync();
    recorder.record();
  }, [recorder]);

  const stop = useCallback(async (): Promise<AudioSource | null> => {
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
      const blob = await done;
      return { kind: "blob", blob };
    }

    await recorder.stop();
    // Hand audio session back to "playback" so subsequent media (Layla's
    // future TTS, ringtones, etc.) plays through the speaker normally.
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(
      () => {},
    );
    const uri = recorder.uri;
    if (!uri) return null;
    // Hand the URI to the upload directly — converting via fetch(uri) →
    // .blob() causes RN's Hermes fetch to send an empty multipart body on
    // iOS in late 2025. Pass {uri, type, name} into FormData instead.
    // expo-audio's HIGH_QUALITY preset writes m4a (AAC) on iOS.
    const lower = uri.toLowerCase();
    const mime = lower.endsWith(".m4a")
      ? "audio/m4a"
      : lower.endsWith(".caf")
      ? "audio/x-caf"
      : lower.endsWith(".wav")
      ? "audio/wav"
      : "audio/m4a";
    let size = 0;
    try {
      const head = await fetch(uri);
      size = parseInt(head.headers.get("content-length") || "0", 10) || 0;
      // Fall back to reading the body length if the local "server" doesn't
      // surface content-length (some RN versions don't).
      if (!size) {
        const ab = await head.arrayBuffer();
        size = ab.byteLength;
      }
    } catch {
      size = 0;
    }
    return { kind: "file", uri, mime, size };
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

/** Upload a recorded source (web Blob OR native file URI) to /v1/voice and
 *  return the transcript. */
export async function transcribe(
  apiUrl: string,
  jwt: string,
  source: AudioSource,
): Promise<string> {
  const fd = new FormData();
  if (source.kind === "blob") {
    const ext = (source.blob.type.split("/")[1] || "webm").split(";")[0];
    fd.append("audio", source.blob, `voice.${ext}`);
  } else {
    // RN multipart shape: append the {uri, type, name} object directly so
    // RN's fetch reads the file off disk. Passing a Blob here goes through
    // a Hermes path that sends an empty body on iOS.
    const ext = (source.mime.split("/")[1] || "m4a").split(";")[0];
    fd.append("audio", {
      uri: source.uri,
      type: source.mime,
      name: `voice.${ext}`,
    } as any);
  }
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
