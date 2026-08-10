# LibreDSP Workspace
An interactive DSP software that performs:
- Design and visualization of digital filters
- Hybrid simulation of dynamic systems
- Power spectral density estimation

### Filter Design
The application supports designing digital filters using the following methods:

- Visually placing poles and zeros on the Z-plane
- Windowing methods for FIR filter design
- Analog-to-digital IIR filter design using Butterworth and Chebyshev filters
- Weighted least-squares design of linear-phase FIR filters
- Parks-Mcclellan Algorithm to design equiripple filters

After a filter is designed, the application:

- Computes and displays the magnitude and phase of the frequency response
- Generates the corresponding filter coefficients
- Simulates and visualizes the filter’s output on user-selected input signals

### Hybrid Simulation
A system consisting of the following elements can be simulated:

- Continuous Plant
- Digital Filter
- Discrete PID
- Sum Block
- Signal Modifier

### Spectral Estimation

For spectrum estimation, the app can receive:

- a signal from a file, or
- an expressions to generate signals directly.

Afterwards, the app estimates power spectrum desnsity (PSD) via periodogram or Welch's method.

## Getting Started
To use the app, simply visit [libredsp.github.io/workspace](https://LibreDSP.github.io/).
Alternatively, to install and run the app locally, make sure you have a recent version of [Node](https://nodejs.org/en) installed.
Afterwards:

- Clone the repository:
```shell
git clone git@github.com:LibreDSP/workspace.git
cd workspace
```
- Install the dependencies:
```shell
npm install
```
- Run the web app:
```shell
npm run dev
```
- The app should become accessible on 'http://localhost:3000' or on a similar port.

Screenshot:

![](https://raw.githubusercontent.com/LibreDSP/LibreDSP.github.io/refs/heads/main/screenshot.png)
<!-- ## Demo
The following video shows the design of a low-pass filter:
![](https://raw.githubusercontent.com/alavifazel/demo/refs/heads/main/animation-smaller.gif) -->

## License
The software is released under Apache License 2.0. View the LICENSE file for more info.
