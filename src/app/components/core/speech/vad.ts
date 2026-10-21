import { LogisticRegressionModel, predictProbability } from "./logistic_regression";

export type SpeechSegment = { start: number; end: number; isSpeech: boolean };

const FRAME_LENGTH_MS = 25;
const FRAME_HOP_MS = 10;
const MOVING_STD_HALF_WIDTH = 15;
const ROLLOFF_PERCENT = 0.85;

const frameParams = (sampleRate: number) => ({
  frameLength: Math.floor(FRAME_LENGTH_MS * sampleRate / 1000),
  frameHop: Math.floor(FRAME_HOP_MS * sampleRate / 1000),
});

const framesOf = (samples: Float64Array, frameLength: number, frameHop: number) => {
  const frames: Float64Array[] = [];
  for (let start = 0; start + frameLength <= samples.length; start += frameHop) {
    frames.push(samples.slice(start, start + frameLength));
  }
  return frames;
};

const nextPowerOfTwo = (n: number) => {
  let p = 1;
  while (p < n) p *= 2;
  return p;
};

function powerSpectrum(frame: Float64Array) {
  const n = nextPowerOfTwo(frame.length);
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < frame.length; i++) {
    const hann = 0.5 * (1 - Math.cos(2 * Math.PI * i / (frame.length - 1)));
    re[i] = frame[i] * hann;
  }

  // Iterative radix-2 FFT, equivalent to the Rust library's zero-padded FFT.
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = -2 * Math.PI / len;
    const wLenRe = Math.cos(angle), wLenIm = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let wRe = 1, wIm = 0;
      for (let j = 0; j < len / 2; j++) {
        const uRe = re[i + j], uIm = im[i + j];
        const vRe = re[i + j + len / 2] * wRe - im[i + j + len / 2] * wIm;
        const vIm = re[i + j + len / 2] * wIm + im[i + j + len / 2] * wRe;
        re[i + j] = uRe + vRe; im[i + j] = uIm + vIm;
        re[i + j + len / 2] = uRe - vRe; im[i + j + len / 2] = uIm - vIm;
        const nextRe = wRe * wLenRe - wIm * wLenIm;
        wIm = wRe * wLenIm + wIm * wLenRe; wRe = nextRe;
      }
    }
  }
  const power = new Float64Array(n / 2 + 1);
  for (let k = 0; k < power.length; k++) power[k] = re[k] * re[k] + im[k] * im[k];
  return power;
}

function zcr(frame: Float64Array) {
  if (frame.length < 2) return 0;
  let crossings = 0;
  for (let i = 1; i < frame.length; i++) {
    if ((frame[i - 1] >= 0 && frame[i] < 0) || (frame[i - 1] < 0 && frame[i] >= 0)) crossings++;
  }
  return crossings / (frame.length - 1);
}
function movingStd(values: number[], halfWidth: number) {
  return values.map((_, i) => {
    const lo = Math.max(0, i - halfWidth), hi = Math.min(values.length, i + halfWidth + 1);
    const slice = values.slice(lo, hi);
    const mean = slice.reduce((a, b) => a + b, 0) / slice.length;
    return Math.sqrt(slice.reduce((a, v) => a + (v - mean) ** 2, 0) / slice.length);
  });
}
function spectralFeatures(power: Float64Array, sampleRate: number) {
  const binHz = sampleRate / ((power.length - 1) * 2);
  const nyquist = sampleRate / 2;
  const total = power.reduce((a, b) => a + b, 0) + 1e-10;
  const centroid = power.reduce((a, p, k) => a + k * binHz * p, 0) / total / nyquist;
  let cumulative = 0, rolloff = 1;
  for (let k = 0; k < power.length; k++) {
    cumulative += power[k];
    if (cumulative >= ROLLOFF_PERCENT * total) { rolloff = k * binHz / nyquist; break; }
  }
  const meanLog = power.reduce((a, p) => a + Math.log(p + 1e-10), 0) / power.length;
  const flatness = Math.exp(meanLog) / (power.reduce((a, b) => a + b, 0) / power.length);
  return [centroid, rolloff, flatness];
}

export function detectSpeech(
  model: LogisticRegressionModel,
  samples: Float64Array,
  sampleRate: number,
  config = { threshold: 0.6, smoothingFrames: 11, minSpeech: 0.5, minNonSpeech: 0.5 },
): SpeechSegment[] {
  const { frameLength, frameHop } = frameParams(sampleRate);
  if (!samples.length || !frameLength || !frameHop) return [];
  const frames = framesOf(samples, frameLength, frameHop);
  const logEnergy = frames.map(frame => {
    const rms = Math.sqrt(frame.reduce((a, x) => a + x * x, 0) / frame.length);
    return Math.log(rms * rms + 1e-10);
  });
  const zeroCrossings = frames.map(zcr);
  const energyStd = movingStd(logEnergy, MOVING_STD_HALF_WIDTH);
  const zcrStd = movingStd(zeroCrossings, MOVING_STD_HALF_WIDTH);
  const features = frames.map((frame, i) => {
    const power = powerSpectrum(frame);
    return [logEnergy[i], zeroCrossings[i], ...spectralFeatures(power, sampleRate), energyStd[i], zcrStd[i]];
  });
  const probabilities = features.map(row => predictProbability(model, row));
  const half = Math.floor(config.smoothingFrames / 2);
  const decisions = probabilities.map((_, i) => {
    const lo = Math.max(0, i - half), hi = Math.min(probabilities.length, i + half + 1);
    const avg = probabilities.slice(lo, hi).reduce((a, b) => a + b, 0) / (hi - lo);
    return avg >= config.threshold;
  });

  const flipShortRuns = (value: boolean, minLength: number, keepEdges: boolean) => {
    const original = decisions.slice();
    let start = 0;
    while (start < original.length) {
      let end = start + 1;
      while (end < original.length && original[end] === original[start]) end++;
      if (original[start] === value && end - start < minLength &&
          !(keepEdges && (start === 0 || end === original.length))) {
        for (let j = start; j < end; j++) decisions[j] = !value;
      }
      start = end;
    }
  };
  const hopSeconds = frameHop / sampleRate;
  flipShortRuns(false, Math.round(config.minNonSpeech / hopSeconds), true);
  flipShortRuns(true, Math.round(config.minSpeech / hopSeconds), false);

  const duration = samples.length / sampleRate;
  const segments: SpeechSegment[] = [];
  if (decisions.length === 0) return [];
  let start = 0;
  for (let i = 1; i <= decisions.length; i++) {
    if (i === decisions.length || decisions[i] !== decisions[start]) {
      segments.push({ start: start * hopSeconds, end: i * hopSeconds, isSpeech: decisions[start] });
      start = i;
    }
  }
  segments[segments.length - 1].end = duration;
  return segments;
}