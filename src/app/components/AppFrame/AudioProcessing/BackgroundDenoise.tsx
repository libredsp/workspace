"use client";

import React, { useEffect, useRef, useState } from 'react';
import FFT from 'fft.js';
import { Panel } from './Panel';

const DEFAULT_FRAME_LEN_MS = 30;
const DEFAULT_ALPHA = 2.0;

const getAudioContext = () => {
  const AudioContextClass =
    window.AudioContext ||
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

  if (!AudioContextClass) {
    throw new Error('Web Audio is not supported by this browser.');
  }

  return AudioContextClass;
};

/*
 * Spectral subtraction corresponding to the DSP pipeline used by
 * libredsp::noise_reduction::spectral_subtraction:
 *
 * - Hann window
 * - 50% overlap
 * - noise spectrum estimated from the user-selected noise-only interval
 * - power-spectrum subtraction with an oversubtraction factor alpha
 * - original phase retained
 * - overlap-add reconstruction
 */
const spectralSubtractChannel = (
  input,
  sampleRate,
  noiseStart,
  noiseEnd,
  frameLenMs,
  alpha,
) => {
  let frameSize = Math.floor((frameLenMs / 1000) * sampleRate);

  if (frameSize < 2) {
    throw new Error('Frame length is too small.');
  }

  // fft.js requires the FFT size to be a power of two.
  frameSize = 2 ** Math.ceil(Math.log2(frameSize));

  const hop = Math.floor(frameSize / 2);
  const fft = new FFT(frameSize);

  const window = new Float64Array(frameSize);
  for (let n = 0; n < frameSize; n++) {
    window[n] = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / (frameSize - 1));
  }

  const noiseStartSample = Math.floor(noiseStart * sampleRate);
  const noiseEndSample = Math.floor(noiseEnd * sampleRate);

  if (
    noiseStartSample < 0 ||
    noiseEndSample <= noiseStartSample ||
    noiseEndSample > input.length
  ) {
    throw new Error('The background-noise interval is outside the audio.');
  }

  // A frame is used for noise estimation when its samples lie inside
  // the selected background-only interval.
  const firstNoiseFrame = Math.max(
    0,
    Math.ceil((noiseStartSample - frameSize) / hop),
  );
  const lastNoiseFrame = Math.floor((noiseEndSample - frameSize) / hop);

  if (lastNoiseFrame < firstNoiseFrame) {
    throw new Error(
      'The selected background interval is shorter than one analysis frame.',
    );
  }

  const noisePower = new Float64Array(frameSize);
  let noiseFrameCount = 0;

  const inputFrame = new Float64Array(frameSize);
  const spectrum = fft.createComplexArray();

  const processFrame = (start) => {
    inputFrame.fill(0);

    const available = Math.min(frameSize, input.length - start);
    if (available > 0) {
      for (let i = 0; i < available; i++) {
        inputFrame[i] = input[start + i] * window[i];
      }
    }

    fft.realTransform(spectrum, inputFrame);
    fft.completeSpectrum(spectrum);

    return spectrum;
  };

  // Estimate average noise power spectrum.
  for (let frame = firstNoiseFrame; frame <= lastNoiseFrame; frame++) {
    const spec = processFrame(frame * hop);

    for (let k = 0; k < frameSize; k++) {
      const re = spec[2 * k];
      const im = spec[2 * k + 1];
      noisePower[k] += re * re + im * im;
    }

    noiseFrameCount++;
  }

  for (let k = 0; k < frameSize; k++) {
    noisePower[k] /= noiseFrameCount;
  }

  const frameCount = Math.max(1, Math.ceil((input.length - frameSize) / hop) + 1);
  const outputLength = Math.max(input.length, (frameCount - 1) * hop + frameSize);

  const output = new Float64Array(outputLength);
  const windowPower = new Float64Array(outputLength);

  // Spectral subtraction and overlap-add.
  for (let frame = 0; frame < frameCount; frame++) {
    const start = frame * hop;
    const spec = processFrame(start);
    const cleanSpectrum = fft.createComplexArray();

    for (let k = 0; k < frameSize; k++) {
      const re = spec[2 * k];
      const im = spec[2 * k + 1];
      const power = re * re + im * im;

      // Preserve the noisy phase and subtract estimated noise power.
      const cleanPower = Math.max(power - alpha * noisePower[k], 0);
      const gain = power > 1e-20 ? Math.sqrt(cleanPower / power) : 0;

      cleanSpectrum[2 * k] = re * gain;
      cleanSpectrum[2 * k + 1] = im * gain;
    }

    const timeFrame = fft.createComplexArray();
    fft.inverseTransform(timeFrame, cleanSpectrum);

    for (let i = 0; i < frameSize; i++) {
      const value = timeFrame[2 * i] * window[i];
      const index = start + i;

      if (index < outputLength) {
        output[index] += value;
        windowPower[index] += window[i] * window[i];
      }
    }
  }

  for (let i = 0; i < output.length; i++) {
    if (windowPower[i] > 1e-10) {
      output[i] /= windowPower[i];
    }
  }

  return output.slice(0, input.length);
};

const encodeWav = (channels, sampleRate) => {
  const numChannels = channels.length;
  const numSamples = channels[0].length;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = numSamples * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeString = (offset, value) => {
    for (let i = 0; i < value.length; i++) {
      view.setUint8(offset + i, value.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    for (let channel = 0; channel < numChannels; channel++) {
      const sample = Math.max(-1, Math.min(1, channels[channel][i]));
      const pcm = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      view.setInt16(offset, Math.round(pcm), true);
      offset += 2;
    }
  }

  return new Blob([buffer], { type: 'audio/wav' });
};

export const BackgroundDenoise = () => {
  const [fileName, setFileName] = useState('');
  const [audioBuffer, setAudioBuffer] = useState(null);
  const [noiseStart, setNoiseStart] = useState('0');
  const [noiseEnd, setNoiseEnd] = useState('1');
  const [frameLenMs, setFrameLenMs] = useState(String(DEFAULT_FRAME_LEN_MS));
  const [alpha, setAlpha] = useState(String(DEFAULT_ALPHA));
  const [processing, setProcessing] = useState(false);
  const [outputUrl, setOutputUrl] = useState('');
  const [inputPlaying, setInputPlaying] = useState(false);
  const [outputPlaying, setOutputPlaying] = useState(false);

  const inputSourceRef = useRef(null);
  const outputAudioRef = useRef(null);
  const outputBlobRef = useRef(null);

  useEffect(() => {
    return () => {
      if (inputSourceRef.current) {
        try {
          inputSourceRef.current.stop();
        } catch (_) {}
      }
      if (outputAudioRef.current) {
        outputAudioRef.current.pause();
      }
      if (outputUrl) {
        URL.revokeObjectURL(outputUrl);
      }
    };
  }, [outputUrl]);

  const handleFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const arrayBuffer = await file.arrayBuffer();
      const AudioContextClass = getAudioContext();
      const context = new AudioContextClass();
      const decoded = await context.decodeAudioData(arrayBuffer.slice(0));

      setFileName(file.name);
      setAudioBuffer(decoded);
      setNoiseStart('0');
      setNoiseEnd(String(Math.min(1, decoded.duration).toFixed(2)));

      if (outputUrl) {
        URL.revokeObjectURL(outputUrl);
      }
      outputBlobRef.current = null;
      setOutputUrl('');
    } catch (error) {
      console.error(error);
      alert('Could not read this WAV file.');
    }
  };

  const stopInput = () => {
    if (inputSourceRef.current) {
      try {
        inputSourceRef.current.stop();
      } catch (_) {}
      inputSourceRef.current = null;
    }
    setInputPlaying(false);
  };

  const playInput = async () => {
    if (!audioBuffer) return;

    if (outputAudioRef.current) {
      outputAudioRef.current.pause();
      outputAudioRef.current.currentTime = 0;
      outputAudioRef.current = null;
      setOutputPlaying(false);
    }

    if (inputPlaying) {
      stopInput();
      return;
    }

    const AudioContextClass = getAudioContext();
    const context = new AudioContextClass();
    await context.resume();

    const source = context.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(context.destination);
    source.onended = () => {
      inputSourceRef.current = null;
      setInputPlaying(false);
      context.close();
    };

    inputSourceRef.current = source;
    source.start();
    setInputPlaying(true);
  };

  const playOutput = async () => {
    if (!outputUrl) return;

    if (inputSourceRef.current) {
      try {
        inputSourceRef.current.stop();
      } catch (_) {}
      inputSourceRef.current = null;
      setInputPlaying(false);
    }

    if (outputPlaying && outputAudioRef.current) {
      outputAudioRef.current.pause();
      outputAudioRef.current.currentTime = 0;
      setOutputPlaying(false);
      return;
    }

    const audio = new Audio(outputUrl);
    outputAudioRef.current = audio;
    audio.onended = () => setOutputPlaying(false);
    await audio.play();
    setOutputPlaying(true);
  };

  const denoise = async () => {
    if (!audioBuffer) return;

    const start = Number(noiseStart);
    const end = Number(noiseEnd);
    const frameMs = Number(frameLenMs);
    const oversubtraction = Number(alpha);

    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) {
      alert('Enter a valid background-noise interval.');
      return;
    }

    if (end > audioBuffer.duration) {
      alert('The background-noise interval extends beyond the audio.');
      return;
    }

    if (!Number.isFinite(frameMs) || frameMs <= 0) {
      alert('Enter a valid frame length.');
      return;
    }

    if (!Number.isFinite(oversubtraction) || oversubtraction < 0) {
      alert('Enter a valid oversubtraction factor.');
      return;
    }

    setProcessing(true);

    try {
      // Yield once so the browser can repaint the processing state.
      await new Promise((resolve) => setTimeout(resolve, 0));

      const channels = [];
      for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
        channels.push(
          spectralSubtractChannel(
            audioBuffer.getChannelData(channel),
            audioBuffer.sampleRate,
            start,
            end,
            frameMs,
            oversubtraction,
          ),
        );
      }

      const blob = encodeWav(channels, audioBuffer.sampleRate);

      if (outputUrl) {
        URL.revokeObjectURL(outputUrl);
      }

      const url = URL.createObjectURL(blob);
      outputBlobRef.current = blob;
      setOutputUrl(url);
    } catch (error) {
      console.error(error);
      alert(error instanceof Error ? error.message : 'Denoising failed.');
    } finally {
      setProcessing(false);
    }
  };

  const download = () => {
    if (!outputUrl) return;

    const anchor = document.createElement('a');
    anchor.href = outputUrl;
    anchor.download = fileName
      ? `${fileName.replace(/\.wav$/i, '')}_denoised.wav`
      : 'denoised.wav';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  };

  return (
    <Panel
      fileName={fileName}
      duration={audioBuffer?.duration || 0}
      noiseStart={noiseStart}
      noiseEnd={noiseEnd}
      frameLenMs={frameLenMs}
      alpha={alpha}
      onFileChange={handleFile}
      onNoiseStartChange={setNoiseStart}
      onNoiseEndChange={setNoiseEnd}
      onFrameLenChange={setFrameLenMs}
      onAlphaChange={setAlpha}
      onDenoise={denoise}
      processing={processing}
      outputReady={Boolean(outputUrl)}
      onDownload={download}
      onPlayInput={playInput}
      onPlayOutput={playOutput}
      inputPlaying={inputPlaying}
      outputPlaying={outputPlaying}
    />
  );
};
