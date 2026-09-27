import React from 'react';
import Infobox from '../../ui/Infobox';

export const Panel = ({
  fileName,
  duration,
  noiseStart,
  noiseEnd,
  frameLenMs,
  alpha,
  onFileChange,
  onNoiseStartChange,
  onNoiseEndChange,
  onFrameLenChange,
  onAlphaChange,
  onDenoise,
  processing,
  outputReady,
  onDownload,
  onPlayInput,
  onPlayOutput,
  inputPlaying,
  outputPlaying,
}) => {
  return (
    <div className="self-start bg-gray-50 p-4 my-5 mx-2 rounded-2xl shadow-md" style={{ width: '560px' }}>
      <div className="flex justify-between">
        <h2 className="text-lg font-semibold mb-4">Background Noise Removal</h2>
        <Infobox text='This panel allows you to perform background noise removal via FFT and overlapping subsection of your input audio file.' />

      </div>

      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          WAV file
        </label>
        <input
          type="file"
          accept=".wav,audio/wav"
          onChange={onFileChange}
          className="w-full text-sm text-gray-700 border border-gray-300 rounded-md p-2 cursor-pointer
                     bg-white hover:bg-gray-50 focus:outline-none focus:ring-2
                     focus:ring-indigo-400 focus:border-indigo-400"
        />
        {fileName && (
          <p className="text-xs text-gray-500 mt-2 truncate" title={fileName}>
            {fileName}{duration > 0 ? ` — ${duration.toFixed(2)} s` : ''}
          </p>
        )}

      </div>

      <div className="border-t border-gray-200 pt-4 mb-4">
        <p className="text-xs text-gray-700 mb-3">
          Select an interval in the recording where only the background noise is present.
        </p>

        <div className="flex gap-3">
          <div className="flex-1">
            <label className="block text-xs text-gray-600 mb-1">Start (s)</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={noiseStart}
              onChange={(e) => onNoiseStartChange(e.target.value)}
              className="w-full border border-gray-300 rounded-lg p-2 bg-white outline-none
                         focus:ring-2 focus:ring-indigo-400"
            />
          </div>
          <div className="flex-1">
            <label className="block text-xs text-gray-600 mb-1">End (s)</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={noiseEnd}
              onChange={(e) => onNoiseEndChange(e.target.value)}
              className="w-full border border-gray-300 rounded-lg p-2 bg-white outline-none
                         focus:ring-2 focus:ring-indigo-400"
            />
          </div>
        </div>
      </div>

      <div className="border-t border-gray-200 pt-4 mb-4">
        <p className="text-sm font-medium text-gray-700 mb-3">Spectral subtraction settings:</p>
        <div className="flex gap-3">
          <div className="flex-1">
            <label className="block text-xs text-gray-600 mb-1">Frame length (ms)</label>
            <input
              type="number"
              min="1"
              step="1"
              value={frameLenMs}
              onChange={(e) => onFrameLenChange(e.target.value)}
              className="w-full border border-gray-300 rounded-lg p-2 bg-white outline-none
                         focus:ring-2 focus:ring-indigo-400"
            />
          </div>
          <div className="flex-1">
            <label className="block text-xs text-gray-600 mb-1">Oversubtraction (α)</label>
            <input
              type="number"
              min="0"
              step="0.1"
              value={alpha}
              onChange={(e) => onAlphaChange(e.target.value)}
              className="w-full border border-gray-300 rounded-lg p-2 bg-white outline-none
                         focus:ring-2 focus:ring-indigo-400"
            />
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between mt-5">
        <div className="flex gap-2">
          <button
            onClick={onPlayInput}
            disabled={!fileName}
            className="h-10 text-sm px-5 bg-gray-200 text-black rounded-lg hover:bg-gray-300 disabled:opacity-50"
          >
            {inputPlaying ? 'Stop' : 'Play input'}
          </button>
          <button
            onClick={onPlayOutput}
            disabled={!outputReady}
            className="h-10 text-sm px-5 bg-gray-200 text-black rounded-lg hover:bg-gray-300 disabled:opacity-50"
          >
            {outputPlaying ? 'Stop' : 'Play output'}
          </button>
        </div>

        <button
          onClick={onDenoise}
          disabled={!fileName || processing}
          className="h-10 text-sm px-6 bg-indigo-600 rounded-lg text-white hover:bg-blue-800 disabled:opacity-50"
        >
          {processing ? 'Processing...' : 'Denoise'}
        </button>
      </div>

      {outputReady && (
        <div className="mt-4 pt-4 border-t border-gray-200 flex items-center justify-between">
          <span className="text-sm text-gray-700">Denoised WAV ready.</span>
          <button
            onClick={onDownload}
            className="h-9 text-sm px-4 bg-slate-700 text-white rounded-lg hover:bg-slate-800"
          >
            Download
          </button>
        </div>
      )}
    </div>
  );
};
