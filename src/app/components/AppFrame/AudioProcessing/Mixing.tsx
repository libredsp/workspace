"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

type Clip = {
  id: string;
  name: string;
  buffer: AudioBuffer;
  offset: number;
};

type Track = {
  id: string;
  clips: Clip[];
  muted: boolean;
};

const getAudioContext = () => {
  const AudioContextClass =
    window.AudioContext ||
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

  if (!AudioContextClass) {
    throw new Error("Web Audio is not supported by this browser.");
  }

  return AudioContextClass;
};

const makeId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const clipEnd = (clip: Clip) => clip.offset + clip.buffer.duration;

const sliceAudioBuffer = (
  context: AudioContext,
  buffer: AudioBuffer,
  start: number,
  end: number,
) => {
  const first = Math.max(0, Math.floor(start * buffer.sampleRate));
  const last = Math.min(buffer.length, Math.ceil(end * buffer.sampleRate));
  const length = Math.max(0, last - first);

  const result = context.createBuffer(
    buffer.numberOfChannels,
    length,
    buffer.sampleRate,
  );

  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    result
      .getChannelData(channel)
      .set(buffer.getChannelData(channel).subarray(first, last));
  }

  return result;
};

const encodeWav = (channels: Float32Array[], sampleRate: number) => {
  const numChannels = channels.length;
  const numSamples = channels.reduce(
    (max, channel) => Math.max(max, channel.length),
    0,
  );
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = numSamples * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeString = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) {
      view.setUint8(offset + i, value.charCodeAt(i));
    }
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    for (let channel = 0; channel < numChannels; channel++) {
      const sample = channels[channel]?.[i] ?? 0;
      const clamped = Math.max(-1, Math.min(1, sample));
      const pcm = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
      view.setInt16(offset, Math.round(pcm), true);
      offset += 2;
    }
  }

  return new Blob([buffer], { type: "audio/wav" });
};

const formatTime = (seconds: number) => {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const secs = Math.floor(safe % 60);
  return `${minutes}:${String(secs).padStart(2, "0")}`;
};

export const Mixing = () => {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [selectedClip, setSelectedClip] = useState<{
    trackId: string;
    clipId: string;
  } | null>(null);
  const [mode, setMode] = useState<"select" | "cut">("select");
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [dragging, setDragging] = useState<{
    trackId: string;
    clipId: string;
    startX: number;
    originalOffset: number;
  } | null>(null);
  const [zoom, setZoom] = useState(90);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const canvasRefs = useRef<Record<string, HTMLCanvasElement | null>>({});
  const animationRef = useRef<number | null>(null);
  const playbackSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const playbackContextRef = useRef<AudioContext | null>(null);
  const playbackStartedAtRef = useRef(0);
  const playbackStartPositionRef = useRef(0);
  const playheadRef = useRef(0);
  const outputUrlRef = useRef<string | null>(null);

  const pixelsPerSecond = zoom;

  const duration = useMemo(
    () =>
      Math.max(
        1,
        ...tracks.flatMap((track) =>
          track.clips.map((clip) => clipEnd(clip)),
        ),
      ),
    [tracks],
  );

  useEffect(() => {
    playheadRef.current = playhead;
  }, [playhead]);

  useEffect(() => {
    return () => {
      stopPlayback(false);
      if (outputUrlRef.current) URL.revokeObjectURL(outputUrlRef.current);
    };
  }, []);

  useEffect(() => {
    const draw = () => {
      Object.entries(canvasRefs.current).forEach(([trackId, canvas]) => {
        if (!canvas) return;

        const track = tracks.find((item) => item.id === trackId);
        if (!track) return;

        const width = Math.max(1, Math.ceil(duration * pixelsPerSecond));
        const height = 74;
        const dpr = window.devicePixelRatio || 1;

        if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
          canvas.width = width * dpr;
          canvas.height = height * dpr;
          canvas.style.width = `${width}px`;
          canvas.style.height = `${height}px`;
        }

        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, width, height);

        ctx.fillStyle = "#f8fafc";
        ctx.fillRect(0, 0, width, height);

        ctx.strokeStyle = "#e5e7eb";
        ctx.lineWidth = 1;

        for (let t = 0; t <= duration; t++) {
          const x = t * pixelsPerSecond;
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, height);
          ctx.stroke();
        }

        track.clips.forEach((clip) => {
          const x = clip.offset * pixelsPerSecond;
          const w = Math.max(2, clip.buffer.duration * pixelsPerSecond);
          const isSelected =
            selectedClip?.trackId === track.id &&
            selectedClip.clipId === clip.id;

          ctx.fillStyle = isSelected ? "#bfdbfe" : "#dbeafe";
          ctx.fillRect(x, 3, w, height - 6);

          ctx.strokeStyle = isSelected ? "#4f46e5" : "#60a5fa";
          ctx.lineWidth = isSelected ? 2 : 1;
          ctx.strokeRect(x, 3, w, height - 6);

          const channel = clip.buffer.getChannelData(0);
          const step = Math.max(
            1,
            Math.floor(channel.length / Math.max(1, w)),
          );
          const middle = height / 2;
          const amplitude = height * 0.42;

          ctx.beginPath();
          ctx.strokeStyle = "#2563eb";
          ctx.lineWidth = 1;

          for (let px = 0; px < w; px++) {
            const sampleStart = Math.min(
              channel.length - 1,
              Math.floor((px / Math.max(1, w)) * channel.length),
            );
            const sampleEnd = Math.min(channel.length, sampleStart + step);

            let min = 1;
            let max = -1;

            for (let i = sampleStart; i < sampleEnd; i++) {
              min = Math.min(min, channel[i]);
              max = Math.max(max, channel[i]);
            }

            const drawX = x + px;
            ctx.moveTo(drawX, middle + min * amplitude);
            ctx.lineTo(drawX, middle + max * amplitude);
          }

          ctx.stroke();

          ctx.fillStyle = "#334155";
          ctx.font = "11px Arial";
          ctx.fillText(clip.name, x + 6, 15);
        });
      });

      animationRef.current = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [tracks, duration, pixelsPerSecond, selectedClip]);

  const stopPlayback = (resetPosition = true) => {
    playbackSourcesRef.current.forEach((source) => {
      try {
        source.stop();
      } catch (_) {}
    });

    playbackSourcesRef.current = [];

    if (playbackContextRef.current) {
      playbackContextRef.current.close().catch(() => {});
      playbackContextRef.current = null;
    }

    if (resetPosition) setPlayhead(0);
    setPlaying(false);
  };

  const pausePlayback = () => {
    if (!playing) return;

    const context = playbackContextRef.current;

    if (context) {
      const elapsed = context.currentTime - playbackStartedAtRef.current;
      setPlayhead(
        Math.min(
          duration,
          playbackStartPositionRef.current + Math.max(0, elapsed),
        ),
      );
    }

    stopPlayback(false);
  };

  const play = async () => {
    if (playing || tracks.length === 0) return;

    const AudioContextClass = getAudioContext();
    const context = new AudioContextClass();
    await context.resume();

    const startPosition = Math.min(playheadRef.current, duration);
    const actualStart = startPosition >= duration ? 0 : startPosition;

    if (actualStart === 0 && startPosition >= duration) {
      setPlayhead(0);
    }

    playbackContextRef.current = context;
    playbackStartedAtRef.current = context.currentTime;
    playbackStartPositionRef.current = actualStart;

    const sources: AudioBufferSourceNode[] = [];

    tracks.forEach((track) => {
      if (track.muted) return;

      track.clips.forEach((clip) => {
        const clipStart = clip.offset;
        const clipEndTime = clipEnd(clip);

        if (clipEndTime <= actualStart) return;

        const source = context.createBufferSource();
        source.buffer = clip.buffer;
        source.connect(context.destination);

        const offsetInClip = Math.max(0, actualStart - clipStart);
        const when = Math.max(0, clipStart - actualStart);

        source.start(context.currentTime + when, offsetInClip);
        sources.push(source);
      });
    });

    playbackSourcesRef.current = sources;
    setPlaying(true);

    const tick = () => {
      if (!playbackContextRef.current) return;

      const elapsed =
        playbackContextRef.current.currentTime -
        playbackStartedAtRef.current;

      const position = playbackStartPositionRef.current + elapsed;

      if (position >= duration) {
        stopPlayback(true);
        return;
      }

      setPlayhead(position);
      requestAnimationFrame(tick);
    };

    requestAnimationFrame(tick);
  };

  const timelineXToTime = (clientX: number) => {
    const timeline = timelineRef.current;

    if (!timeline) return 0;

    const rect = timeline.getBoundingClientRect();
    const x = Math.max(0, clientX - rect.left);

    return Math.max(0, Math.min(duration, x / pixelsPerSecond));
  };

  const addFiles = async (files: FileList | File[]) => {
    const wavFiles = Array.from(files).filter(
      (file) =>
        file.type === "audio/wav" ||
        file.type === "audio/x-wav" ||
        /\.wav$/i.test(file.name),
    );

    if (wavFiles.length === 0) {
      alert("Please select WAV files.");
      return;
    }

    try {
      const AudioContextClass = getAudioContext();
      const context = new AudioContextClass();
      const decodedTracks: Track[] = [];

      for (const file of wavFiles) {
        const arrayBuffer = await file.arrayBuffer();
        const buffer = await context.decodeAudioData(arrayBuffer.slice(0));

        decodedTracks.push({
          id: makeId(),
          muted: false,
          clips: [
            {
              id: makeId(),
              name: file.name,
              buffer,
              offset: 0,
            },
          ],
        });
      }

      await context.close();
      setTracks((previous) => [...previous, ...decodedTracks]);
    } catch (error) {
      console.error(error);
      alert("Could not read one or more WAV files.");
    }
  };

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault();
    void addFiles(event.dataTransfer.files);
  };

  const cutClipAtTime = (trackId: string, time: number) => {
    let didCut = false;
    const AudioContextClass = getAudioContext();
    const context = new AudioContextClass();

    setTracks((previous) =>
      previous.map((track) => {
        if (track.id !== trackId) return track;

        const newClips: Clip[] = [];

        track.clips.forEach((clip) => {
          const end = clipEnd(clip);

          // Only split the clip that contains the click.
          if (time <= clip.offset || time >= end) {
            newClips.push(clip);
            return;
          }

          const split = time - clip.offset;

          const leftBuffer = sliceAudioBuffer(
            context,
            clip.buffer,
            0,
            split,
          );

          const rightBuffer = sliceAudioBuffer(
            context,
            clip.buffer,
            split,
            clip.buffer.duration,
          );

          newClips.push(
            {
              ...clip,
              id: makeId(),
              name: `${clip.name} (1)`,
              buffer: leftBuffer,
              offset: clip.offset,
            },
            {
              ...clip,
              id: makeId(),
              name: `${clip.name} (2)`,
              buffer: rightBuffer,
              offset: time,
            },
          );

          didCut = true;
        });

        return { ...track, clips: newClips };
      }),
    );

    context.close().catch(() => {});

    if (didCut) {
      setPlayhead(time);
      setMode("select");
      setSelectedClip(null);
    }
  };

  const beginClipDrag = (
    event: React.PointerEvent,
    trackId: string,
    clip: Clip,
  ) => {
    if (event.button !== 0 || mode !== "select") return;

    event.stopPropagation();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);

    setSelectedClip({ trackId, clipId: clip.id });

    setDragging({
      trackId,
      clipId: clip.id,
      startX: event.clientX,
      originalOffset: clip.offset,
    });
  };

  const moveClip = (event: React.PointerEvent) => {
    if (!dragging) return;

    const delta = (event.clientX - dragging.startX) / pixelsPerSecond;
    const newOffset = Math.max(0, dragging.originalOffset + delta);

    setTracks((previous) =>
      previous.map((track) =>
        track.id !== dragging.trackId
          ? track
          : {
              ...track,
              clips: track.clips.map((clip) =>
                clip.id === dragging.clipId
                  ? { ...clip, offset: newOffset }
                  : clip,
              ),
            },
      ),
    );
  };

  const endClipDrag = () => setDragging(null);

  const deleteSelectedClip = () => {
    if (!selectedClip) return;

    setTracks((previous) =>
      previous
        .map((track) =>
          track.id !== selectedClip.trackId
            ? track
            : {
                ...track,
                clips: track.clips.filter(
                  (clip) => clip.id !== selectedClip.clipId,
                ),
              },
        )
        .filter((track) => track.clips.length > 0),
    );

    setSelectedClip(null);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        (event.key === "Delete" || event.key === "Backspace") &&
        selectedClip
      ) {
        event.preventDefault();
        deleteSelectedClip();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedClip]);

  const exportMix = async () => {
    if (tracks.length === 0) return;

    const sampleRate = Math.max(
      ...tracks.flatMap((track) =>
        track.clips.map((clip) => clip.buffer.sampleRate),
      ),
    );

    const channelCount = Math.max(
      1,
      ...tracks.flatMap((track) =>
        track.clips.map((clip) => clip.buffer.numberOfChannels),
      ),
    );

    const outputLength = Math.max(
      1,
      Math.ceil(duration * sampleRate),
    );

    const offline = new OfflineAudioContext(
      channelCount,
      outputLength,
      sampleRate,
    );

    tracks.forEach((track) => {
      if (track.muted) return;

      track.clips.forEach((clip) => {
        const source = offline.createBufferSource();
        source.buffer = clip.buffer;
        source.connect(offline.destination);
        source.start(Math.max(0, clip.offset));
      });
    });

    const rendered = await offline.startRendering();

    const channels = Array.from(
      { length: rendered.numberOfChannels },
      (_, channel) => rendered.getChannelData(channel).slice(),
    );

    const blob = encodeWav(channels, rendered.sampleRate);

    if (outputUrlRef.current) {
      URL.revokeObjectURL(outputUrlRef.current);
    }

    outputUrlRef.current = URL.createObjectURL(blob);

    const anchor = document.createElement("a");
    anchor.href = outputUrlRef.current;
    anchor.download = "mix.wav";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  };

  const removeTrack = (trackId: string) => {
    setTracks((previous) => previous.filter((track) => track.id !== trackId));

    if (selectedClip?.trackId === trackId) {
      setSelectedClip(null);
    }
  };

  const toggleMute = (trackId: string) => {
    setTracks((previous) =>
      previous.map((track) =>
        track.id === trackId
          ? { ...track, muted: !track.muted }
          : track,
      ),
    );
  };

  return (
    <div className="self-start bg-gray-50 p-4 my-5 mx-2 rounded-2xl shadow-md w-[calc(100%-1rem)]">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold">Audio Mixing</h2>

        <div className="flex gap-2">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="h-10 px-4 rounded bg-gray-500 hover:bg-gray-600 text-white text-sm"
          >
            Add WAV
          </button>

          <button
            onClick={() => void exportMix()}
            disabled={tracks.length === 0}
            className="h-10 px-4 rounded bg-teal-500 hover:bg-teal-600 text-white text-sm disabled:opacity-50"
          >
            Export WAV
          </button>

          <input
            ref={fileInputRef}
            type="file"
            accept=".wav,audio/wav"
            multiple
            className="hidden"
            onChange={(event) => {
              if (event.target.files) void addFiles(event.target.files);
              event.target.value = "";
            }}
          />
        </div>
      </div>

      <div className="flex items-center border-b border-gray-300 pb-2 mb-3">
        <button
          title="Play"
          onClick={() => void play()}
          disabled={tracks.length === 0}
          className="m-1 w-10 h-10 rounded bg-gray-500 hover:bg-gray-600 text-white text-sm disabled:opacity-50"
        >
          ▶
        </button>

        <button
          title="Pause"
          onClick={pausePlayback}
          disabled={!playing}
          className="m-1 w-10 h-10 rounded bg-gray-500 hover:bg-gray-600 text-white text-sm disabled:opacity-50"
        >
          ❚❚
        </button>

        <button
          title="Stop"
          onClick={() => stopPlayback(true)}
          className="m-1 w-10 h-10 rounded bg-gray-500 hover:bg-gray-600 text-white text-sm"
        >
          ■
        </button>

        <div className="m-1 h-10 w-[5px] bg-gray-300" />

        <button
          title="Select"
          onClick={() => setMode("select")}
          className={`m-1 w-10 h-10 rounded text-white text-xs ${
            mode === "select"
              ? "bg-indigo-600 hover:bg-indigo-700"
              : "bg-gray-500 hover:bg-gray-600"
          }`}
        >
          Sel
        </button>

        <button
          title="Cut mode: click inside a clip to split it"
          onClick={() => {
            setMode("cut");
            setSelectedClip(null);
          }}
          className={`m-1 w-10 h-10 rounded text-white text-s font-bold ${
            mode === "cut"
              ? "bg-indigo-600 hover:bg-indigo-700"
              : "bg-gray-500 hover:bg-gray-600"
          }`}
        >
          &#9986;
        </button>

        <div className="ml-4 text-xs text-gray-600">
          {formatTime(playhead)} / {formatTime(duration)}
        </div>

        <div className="ml-auto flex items-center gap-2 text-xs text-gray-600">
          Zoom
          <input
            type="range"
            min="40"
            max="280"
            value={zoom}
            onChange={(event) => setZoom(Number(event.target.value))}
          />
        </div>
      </div>

      <div
        className="border border-gray-300 rounded-lg bg-white overflow-auto"
        onDragOver={(event) => event.preventDefault()}
        onDrop={handleDrop}
      >
        {tracks.length === 0 ? (
          <div className="h-52 flex flex-col items-center justify-center text-gray-500 text-sm">
            <p>Drop WAV files here or click “Add WAV”.</p>
            <p className="text-xs mt-2">
              Tracks will appear one below another.
            </p>
          </div>
        ) : (
          <div className="min-w-max">
            <div className="h-8 flex items-end border-b border-gray-200 bg-gray-50">
              <div className="w-36 shrink-0 border-r border-gray-200 h-full" />

              <div
                className="relative h-full"
                style={{ width: duration * pixelsPerSecond }}
              >
                {Array.from({
                  length: Math.ceil(duration) + 1,
                }).map((_, i) => (
                  <span
                    key={i}
                    className="absolute bottom-1 text-[10px] text-gray-500"
                    style={{ left: i * pixelsPerSecond + 3 }}
                  >
                    {formatTime(i)}
                  </span>
                ))}
              </div>
            </div>

            {tracks.map((track, trackIndex) => (
              <div
                key={track.id}
                className="flex h-[92px] border-b border-gray-200"
              >
                <div className="w-36 shrink-0 bg-gray-50 border-r border-gray-200 p-2">
                  <div className="text-xs font-medium truncate">
                    Track {trackIndex + 1}
                  </div>

                  <div className="flex gap-1 mt-2">
                    <button
                      onClick={() => toggleMute(track.id)}
                      className={`px-2 py-1 rounded text-[10px] ${
                        track.muted
                          ? "bg-red-500 text-white"
                          : "bg-gray-200 hover:bg-gray-300"
                      }`}
                    >
                      M
                    </button>

                    <button
                      onClick={() => removeTrack(track.id)}
                      className="px-2 py-1 rounded bg-gray-200 hover:bg-gray-300 text-[10px]"
                    >
                      ×
                    </button>
                  </div>
                </div>

                <div
                  ref={timelineRef}
                  className="relative h-[92px] overflow-hidden"
                  style={{ width: duration * pixelsPerSecond }}
                  onPointerDown={(event) => {
                    const time = timelineXToTime(event.clientX);

                    if (mode === "cut") {
                      cutClipAtTime(track.id, time);
                      return;
                    }

                    setPlayhead(time);
                  }}
                  onPointerMove={moveClip}
                  onPointerUp={endClipDrag}
                  onPointerCancel={endClipDrag}
                >
                  <canvas
                    ref={(element) => {
                      canvasRefs.current[track.id] = element;
                    }}
                    className="absolute left-0 top-[9px] h-[74px] pointer-events-none"
                  />

                  {track.clips.map((clip) => {
                    const isSelected =
                      selectedClip?.trackId === track.id &&
                      selectedClip.clipId === clip.id;

                    return (
                      <div
                        key={clip.id}
                        className={`absolute top-[9px] h-[74px] cursor-grab active:cursor-grabbing rounded ${
                          isSelected
                            ? "ring-2 ring-indigo-600"
                            : ""
                        }`}
                        style={{
                          left: clip.offset * pixelsPerSecond,
                          width: Math.max(
                            3,
                            clip.buffer.duration * pixelsPerSecond,
                          ),
                          background: "transparent",
                        }}
                        onPointerDown={(event) =>
                          beginClipDrag(event, track.id, clip)
                        }
                      />
                    );
                  })}

                  <div
                    className="absolute top-0 bottom-0 w-px bg-red-500 pointer-events-none"
                    style={{
                      left: playhead * pixelsPerSecond,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="text-xs text-gray-500 mt-3">
        Select mode: click and drag clips to move them. Cut mode: click inside
        a clip to split it at that exact position. After splitting, each part
        can be moved or deleted independently.
      </p>
    </div>
  );
};
