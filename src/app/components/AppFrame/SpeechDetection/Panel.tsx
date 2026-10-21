 "use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Infobox from "../../ui/Infobox";
import { LogisticRegressionModel, parseModel } from "../../core/speech/logistic_regression";
import { detectSpeech, SpeechSegment } from "../../core/speech/vad";

type PanelProps = { model: LogisticRegressionModel | null; updateModel: (m: LogisticRegressionModel | null) => void };
const fmt = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, "0")}`;

export const Panel = ({ model, updateModel }: PanelProps) => {
  const [modelName, setModelName] = useState("");
  const [audioName, setAudioName] = useState("");
  const [samples, setSamples] = useState<Float64Array | null>(null);
  const [sampleRate, setSampleRate] = useState(0);
  const [duration, setDuration] = useState(0);
  const [segments, setSegments] = useState<SpeechSegment[]>([]);
  const [error, setError] = useState("");
  const [processing, setProcessing] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [playhead, setPlayhead] = useState(0);
  const [zoom, setZoom] = useState(100);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const startedAtRef = useRef(0);
  const startPositionRef = useRef(0);
  const pixelsPerSecond = zoom;
  const timelineWidth = Math.max(1, duration * pixelsPerSecond);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      try { sourceRef.current?.stop(); } catch {}
      audioContextRef.current?.close().catch(() => {});
    };
  }, []);

  const stop = (reset = true) => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    try { sourceRef.current?.stop(); } catch {}
    sourceRef.current = null;
    audioContextRef.current?.close().catch(() => {});
    audioContextRef.current = null;
    setPlaying(false);
    if (reset) setPlayhead(0);
  };

  const loadModel = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        updateModel(parseModel(String(reader.result ?? "")));
        setModelName(file.name);
        setError("");
        setSegments([]);
      } catch (e) {
        updateModel(null); setModelName("");
        setError(e instanceof Error ? e.message : "Could not read model file.");
      }
    };
    reader.readAsText(file);
  };

  const loadAudio = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    stop();
    setError(""); setSegments([]); setSamples(null); setAudioName("");
    try {
      const Ctx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) throw new Error("Web Audio is not supported by this browser.");
      const wavBytes = await file.arrayBuffer();
      const header = new DataView(wavBytes);
      if (wavBytes.byteLength < 44 ||
          String.fromCharCode(header.getUint8(0), header.getUint8(1), header.getUint8(2), header.getUint8(3)) !== "RIFF" ||
          String.fromCharCode(header.getUint8(8), header.getUint8(9), header.getUint8(10), header.getUint8(11)) !== "WAVE") {
        throw new Error("Please choose a valid WAV file.");
      }
      const wavSampleRate = header.getUint32(24, true);
      const context = new Ctx({ sampleRate: wavSampleRate });
      const buffer = await context.decodeAudioData(wavBytes);
      const mono = new Float64Array(buffer.length);
      for (let c = 0; c < buffer.numberOfChannels; c++) {
        const channel = buffer.getChannelData(c);
        for (let i = 0; i < channel.length; i++) mono[i] += channel[i] / buffer.numberOfChannels;
      }
      await context.close();
      setSamples(mono); setSampleRate(buffer.sampleRate); setDuration(buffer.duration);
      setAudioName(file.name); setPlayhead(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not decode this WAV file.");
    }
  };

  const runDetection = () => {
    if (!model || !samples) return;
    setProcessing(true); setError("");
    try {
      const result = detectSpeech(model, samples, sampleRate);
      setSegments(result);
      setPlayhead(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Speech detection failed.");
    } finally { setProcessing(false); }
  };

  const play = async () => {
    if (!samples || playing) return;
    try {
      const Ctx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) throw new Error("Web Audio is not supported by this browser.");
      const context = new Ctx();
      await context.resume();
      const buffer = context.createBuffer(1, samples.length, sampleRate);
      buffer.copyToChannel(Float32Array.from(samples), 0);
      const source = context.createBufferSource();
      source.buffer = buffer; source.connect(context.destination);
      const from = playhead >= duration ? 0 : playhead;
      source.start(0, from);
      audioContextRef.current = context; sourceRef.current = source;
      startedAtRef.current = context.currentTime; startPositionRef.current = from;
      setPlayhead(from); setPlaying(true);
      source.onended = () => {
        if (sourceRef.current === source) {
          setPlaying(false); setPlayhead(0);
          sourceRef.current = null;
          context.close().catch(() => {});
          audioContextRef.current = null;
        }
      };
      const tick = () => {
        if (sourceRef.current !== source || !audioContextRef.current) return;
        setPlayhead(Math.min(duration, startPositionRef.current + context.currentTime - startedAtRef.current));
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch (e) { setError(e instanceof Error ? e.message : "Playback failed."); }
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !samples || duration <= 0) return;
    const height = 100, dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.ceil(timelineWidth));
    canvas.width = width * dpr; canvas.height = height * dpr;
    canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#f8fafc"; ctx.fillRect(0, 0, width, height);
    for (let t = 0; t <= duration; t++) {
      const x = t * pixelsPerSecond;
      ctx.strokeStyle = "#e2e8f0"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
    }
    segments.forEach(s => {
      if (!s.isSpeech) return;
      const x = s.start * pixelsPerSecond, w = Math.max(1, (s.end - s.start) * pixelsPerSecond);
      ctx.fillStyle = "rgba(34, 197, 94, 0.20)"; ctx.fillRect(x, 0, w, height);
      ctx.fillStyle = "#15803d"; ctx.fillRect(x, 0, w, 4);
    });
    ctx.beginPath(); ctx.strokeStyle = "#2563eb"; ctx.lineWidth = 1;
    const step = Math.max(1, Math.floor(samples.length / width));
    for (let x = 0; x < width; x++) {
      const a = Math.min(samples.length, x * step), b = Math.min(samples.length, a + step);
      let min = 1, max = -1;
      for (let i = a; i < b; i++) { min = Math.min(min, samples[i]); max = Math.max(max, samples[i]); }
      ctx.moveTo(x, height / 2 + min * height * 0.42);
      ctx.lineTo(x, height / 2 + max * height * 0.42);
    }
    ctx.stroke();
    const px = playhead * pixelsPerSecond;
    ctx.strokeStyle = "#dc2626"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, height); ctx.stroke();
  }, [samples, duration, timelineWidth, pixelsPerSecond, segments, playhead]);

  const speechSegments = useMemo(() => segments.filter(s => s.isSpeech), [segments]);
  return (
    <div className="flex flex-col self-start bg-gray-50 p-4 my-5 mx-2 rounded-2xl shadow-md w-full max-w-5xl">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Speech detection</h2>
        <Infobox text="Load the logistic regression model saved as model.txt and a WAV file. Speech regions are detected using frame features such as zero-crossing rate (ZCR), spectral centroid, log energy etc." />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
        <div className="bg-white border border-gray-200 rounded-xl p-3">
          <label className="block text-sm font-medium text-gray-700 mb-2">Model file (model.txt)</label>
          <input type="file" accept=".txt,text/plain" onChange={loadModel}
            className="w-full text-sm text-gray-700 border border-gray-300 rounded-md p-2 bg-white" />
          <p className={`text-xs mt-2 ${model ? "text-green-700" : "text-gray-500"}`}>
            {model ? `${modelName} · ${model.weights.length} weights loaded` : "Choose a trained model file"}
          </p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-3">
          <label className="block text-sm font-medium text-gray-700 mb-2">WAV audio file</label>
          <input type="file" accept=".wav,audio/wav,audio/x-wav" onChange={loadAudio}
            className="w-full text-sm text-gray-700 border border-gray-300 rounded-md p-2 bg-white" />
          <p className="text-xs text-gray-500 mt-2 truncate" title={audioName}>
            {audioName ? `${audioName} · ${sampleRate.toLocaleString()} Hz · ${duration.toFixed(2)} s` : "Choose the recording to analyze"}
          </p>
        </div>
      </div>

      {error && <p className="text-sm text-red-600 mt-3" role="alert">{error}</p>}

      <div className="flex flex-wrap items-center justify-between gap-3 mt-5 border-t border-gray-200 pt-4">
        <div className="flex gap-2">
          <button onClick={play} disabled={!samples || playing} className="h-9 px-4 text-sm bg-gray-200 text-gray-900 rounded-lg hover:bg-gray-300 disabled:opacity-50">Play</button>
          <button onClick={() => stop(false)} disabled={!playing} className="h-9 px-4 text-sm bg-gray-200 text-gray-900 rounded-lg hover:bg-gray-300 disabled:opacity-50">Pause</button>
          <button onClick={() => stop(true)} disabled={!samples} className="h-9 px-4 text-sm bg-gray-200 text-gray-900 rounded-lg hover:bg-gray-300 disabled:opacity-50">Stop</button>
        </div>
        <div className="flex items-center gap-3">
          <label className="text-xs text-gray-600">Zoom</label>
          <input aria-label="Timeline zoom" type="range" min="30" max="240" step="10" value={zoom} onChange={e => setZoom(Number(e.target.value))} />
          <button onClick={runDetection} disabled={!model || !samples || processing}
            className="h-9 px-5 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50">
            {processing ? "Detecting…" : "Detect speech"}
          </button>
        </div>
      </div>

      {samples && (
        <div className="mt-4 border border-gray-200 rounded-xl bg-white p-3">
          <div className="flex justify-between items-center mb-2 gap-3">
            <p className="text-sm font-medium text-gray-700">Audio timeline</p>
            <p className="text-xs text-gray-500">{fmt(duration)}</p>
          </div>
          <div className="overflow-x-auto border border-gray-200 rounded-lg">
            <div style={{ width: timelineWidth, minWidth: "100%" }} className="relative">
              <canvas ref={canvasRef} className="block" />
              <div className="h-6 bg-slate-50 border-t border-gray-200 relative text-xs text-gray-500">
                {Array.from({ length: Math.floor(duration) + 1 }, (_, i) => (
                  <span key={i} className="absolute top-1" style={{ left: i * pixelsPerSecond + 3 }}>{fmt(i)}</span>
                ))}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 mt-3 text-xs text-gray-600">
            <span className="inline-block w-3 h-3 rounded-sm bg-green-500" /> Speech
            <span className="inline-block w-3 h-3 rounded-sm bg-blue-500 ml-3" /> Waveform
          </div>
          {segments.length > 0 && (
            <div className="mt-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
                <h3 className="text-sm font-semibold text-gray-800">Detected speech sections</h3>
                <span className="text-xs text-gray-500">{speechSegments.length} speech region{speechSegments.length === 1 ? "" : "s"}</span>
              </div>
              {speechSegments.length === 0 ? <p className="text-sm text-gray-500">No speech regions detected.</p> : (
                <div className="max-h-48 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100">
                  {speechSegments.map((s, i) => (
                    <button key={`${s.start}-${s.end}`} onClick={() => { stop(false); setPlayhead(s.start); }}
                      className="w-full text-left flex justify-between gap-3 px-3 py-2 text-sm hover:bg-green-50">
                      <span className="text-gray-800">Speech {i + 1}</span>
                      <span className="font-mono text-xs text-gray-600">{fmt(s.start)} – {fmt(s.end)} <span className="text-gray-400">({(s.end - s.start).toFixed(2)} s)</span></span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};