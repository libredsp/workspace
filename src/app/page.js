"use client"; // This is a client component 👈🏽
import React from 'react';
import { ZeroPole } from './components/AppFrame/ZeroPole/ZeroPole';
import { FIRFilterDesign } from './components/AppFrame/FIRFilterDesign/FIRFilterDesign';
import { IIRFilterDesign } from './components/AppFrame/IIRFilterDesign/IIRFilterDesign';
import { LeastSqaureLinearPhaseFIRDesign } from './components/AppFrame/LeastSquareLinearPhaseFIRDesign/LeastSqaureLinearPhaseFIRDesign';
import { ParksMcclellan }  from './components/AppFrame/ParksMcclellan/ParksMcclellan';
import { Periodogram } from './components/AppFrame/Periodogram/Periodogram';
import { Prompt } from './components/AppFrame/Prompt/Prompt';
import { WelchsEstimate } from './components/AppFrame/WelchsEstimate/WelchsEstimate';
import { Simulation } from './components/AppFrame/Simulation/Simulation';

import { BackgroundDenoise } from './components/AppFrame/AudioProcessing/BackgroundDenoise';
import { Mixing } from './components/AppFrame/AudioProcessing/Mixing';

import init from '@libredsp/core';

export default function Home() {
  const [wasmReady, setWasmReady] = React.useState(false);

  React.useEffect(() => {
    init().then(() => setWasmReady(true));
  }, []);

  const items = [
    { placeholder: "Filter Design", name: "title_filter_design" },
    { placeholder: "Zero-pole placement", name: "zero_pole" },
    { placeholder: "Windowing method", name: "fir_filter_design" },
    { placeholder: "Analog-to-digital transform", name: "iir_filter_design" },
    { placeholder: "Linear phase FIR-LS", name: "least_square_linear_phase_FIR" },
    { placeholder: "Parks-Mcclellan Algorithm", name: "parks_mcclellan" },
    { placeholder: "separator", name: "seperator" },

    { placeholder: "Design & Simulation", name: "title_sim" },
    { placeholder: "Hybrid Simulation", name: "sensor_fusion_simulation" },

    { placeholder: "separator", name: "seperator" },
    { placeholder: "Audio", name: "title_audio" },
    { placeholder: "Background Noise Removal", name: "background_noise_removal" },
    { placeholder: "Mixing", name: "audio_mixing" },


    { placeholder: "bottom_elements", name: "bottom_elements" },
    { placeholder: "separator", name: "seperator" },
    { placeholder: "Utilites", name: "title_utlities" },
    { placeholder: "Periodogram estimation", name: "periodogram" },
    { placeholder: "Welch's estimation", name: "welchs_estimate" },
    { placeholder: "separator2", name: "seperator" },
    { placeholder: "> Interactive Prompt", name: "prompt" },
    { placeholder: "Help?", name: "help" }
  ];


  const [selectedItem, setSelectedItem] = React.useState(items[1]);

  const addComponent = () => {
    switch (selectedItem.name) {
      case "zero_pole":
        return <ZeroPole />;
      case "fir_filter_design":
        return <FIRFilterDesign />;
      case "iir_filter_design":
        return <IIRFilterDesign />;
      case "least_square_linear_phase_FIR":
        return <LeastSqaureLinearPhaseFIRDesign />;
      case "parks_mcclellan":
        return <ParksMcclellan />;
      case "periodogram":
        return <Periodogram />
      case "welchs_estimate":
        return <WelchsEstimate />
      case "sensor_fusion_simulation":
        return <Simulation />
      case "background_noise_removal":
        return <BackgroundDenoise />
      case "audio_mixing":
        return <Mixing />
      case "prompt":
        return <Prompt />;
      case "help":
        return (
          <div className="rounded-lg shadow w-full p-5">
            <p>
              <a className="text-blue-600" href="https://github.com/LibreDSP">LibreDSP</a> is an opensource web app for designing and visualizing digital filters, estimating power spectral density, hybrid simulation and more.
              Features:
            </p>

            <br></br><h2 className="font-bold">Filter Design</h2>
            <p> The application supports designing digital filters using the following methods:</p>
            <ul>
              <li>- Visually placing poles and zeros on the Z-plane</li>
              <li>- Windowing methods for FIR filter design</li>
              <li>- Analog-to-digital IIR filter design using Butterworth and Chebyshev filters</li>
              <li>- Weighted least-squares design of linear-phase FIR filters</li>
            </ul>
            <br></br>
            After a filter is designed, the application:
            <br></br>

            <ul>
              <li>- Computes and displays the magnitude and phase of the frequency response</li>
              <li>- Generates the corresponding filter coefficients</li>
              <li>- Simulates and visualizes the filter’s output on user-selected input signals</li>
            </ul>

            <br></br><h2 className="font-bold">Hybrid Simulation</h2>
            A system consisting of the following elements can be simulated:
            <ul>
              <li>- Continuous Plant</li>
              <li>- Digital Filter</li>
              <li>- Discrete PID</li>
              <li>- Sum Block</li>
              <li>- Signal Modifier</li>
            </ul>

            <br></br><h2 className="font-bold">Spectral Estimation</h2>

            For spectrum estimation, the app can receive:

            <ul>
              <li>- a signal from a file, or</li>
              <li>- an expressions to generate signals directly.</li>
            </ul>
            <br></br>

            Afterwards, the app estimates power spectrum desnsity (PSD) via periodogram or Welch's method.
            <br></br>
            <br></br>
            <p>
              For additional information visit: <a className="text-blue-600" href="https://github.com/LibreDSP">https://github.com/LibreDSP</a></p>
            <br></br>
          </div >
        )
    }
  }

  if (!wasmReady) {
    return <div>Loading...</div>;
  }
  return (
    <div className="relative flex h-screen z-20">
      {/* Sidebar */}
      <aside className="fixed flex flex-col px-5 py-4 border-r border-slate-200 z-30 bg-white h-full">
        {items.map((item, index) => {
          if (item.name.match("title.*")) {
            return (
              <h1
                key={`prompt-${item.name}-${index}`}
                className={`flex font-bold h-10 p-2 text-sm w-48
                  ${selectedItem.name === item.name ? "bg-white hover:bg-gray-50 shadow" : ""}`}
              >
                <p className="font-bold">{item.placeholder}</p>
              </h1>
            );
          } else if (item.name === "prompt") {
            return (
              <button
                key={`prompt-${item.name}-${index}`}
                className={`flex h-10 p-2 text-sm rounded w-48
                  ${selectedItem.name === item.name ? "bg-white hover:bg-gray-50 shadow" : ""}`}
                onClick={() => setSelectedItem(item)}
              >
                <p className="font-bold">{item.placeholder}</p>
              </button>
            );
          } else if (item.name === "seperator") {
            return (
              <div
                key={`seperator-${item.name}-${index}`}
                className="h-px bg-gray-300 my-2 w-full"
              ></div>
            );
          } else if (item.name === "bottom_elements") {
            return (
              <div key={`seperator-${item.name}-${index}`} className="mt-auto"></div>
            )
          } else {
            return (
              <button
                key={`item-${item.name}-${index}`}
                className={`flex h-10 p-2 text-sm rounded
                ${selectedItem.name === item.name ? "bg-white hover:bg-gray-50 shadow" : ""}`}
                onClick={() => setSelectedItem(item)}
              >
                <p>{item.placeholder}</p>
              </button>
            );
          }
        })}

      </aside>
      {/* Main app */}
      <main className="absolute left-[230px] w-[calc(100vw-230px)] h-full overflow-y-auto flex z-10">
        {addComponent()}
      </main>
    </div>
  )
}
