# ventuz-stream-player

![Build Status](https://github.com/VentuzTechnology/streamout-webcomponent/actions/workflows/build.yml/badge.svg)

A web component for playing back [Ventuz](https://www.ventuz.com/) Stream Out outputs in the browser, with keyboard, mouse, and touch input support.

Tested on Chrome, Edge and Firefox on Windows, Safari and Chrome on MacOS, Chrome on Android, and Safari on iPadOS.

## Usage

### Ventuz configuration

- ventuz-stream-player requires at least Ventuz 8.1. Earlier versions are missing the required Websocket API needed for the component to run.
- Add any number of Stream Out outputs to your Device Configuration. The following settings are required or recommended:
  - __Codec__: Both H.264 and HEVC are supported. To enable HEVC on Windows machines, you will need to install the [HEVC Video Extensions](https://apps.microsoft.com/detail/9nmzlz57r3t7).
  - __Color Sampling__: 4:2:0 is the safe choice; some browsers (eg. Chrome/Edge on Windows and Safari on iPad) may support 4:4:4.
  - __Encode Mode__: Low latency if you want input, Streaming otherwise.
  - __Rate Control__ etc: What suits you best. Please note that this choice may impact input latency depending on the browser and platform. If in doubt, experiment.
  - __HDR Color Space__: Rec.2100 HDR is fully supported with HEVC (on Chromium based browsers on Windows and MacOS, and Safari on MacOS and iPadOS). In other cases, please select Rec.709 as a fallback.

### Including the component in your project

[npm](https://www.npmjs.com/) based projects can just run `npm install ventuz-stream-player` and add `import 'ventuz-stream-player'` to the code. Otherwise, download the current release and include or import `ventuz-stream-player-min.js` from the package's `dist` directory.

Then add the web component anywhere in your markup or DOM. It might look like this:

`<ventuz-stream-player url="http://localhost:22404/remoting/2.0/streamoutws?o=0" latency="0" fullscreenbutton></ventuz-stream-player>`

Note that the component's default width and height is `100%` so it's the parent container's job to decide the actual size.

#### Attributes

ventuz-stream-player supports the following HTML attributes:

- __url__: URL of the Stream Out web socket endpoint. Usually this is `http://<host>:22404/remoting/2.0/streamoutws?o=<outputno>` for Ventuz 8.
- __latency__: Minimum playback latency in seconds. The default is zero, increasing it trades latency for playback stability.
- __noinput__/__nokeyboard__/__nomouse__/__notouch__: Disable all / keyboard / mouse / touch input
- __fullscreenbutton__: Display a button to enter fullscreen
- __retryinterval__: Connection retry delay in seconds. Default is 3, 0 means don't retry

#### Styling

You can style the appearance of ventuz-stream-player by overriding the following CSS selectors:

* `ventuz-stream_player` for the main element
* `ventuz-stream-player .vsp-statusdisplay` for the status display (errors, etc)
* `ventuz-stream-player .vsp-fsbutton` for the fullscreen button

#### Internationalization

You can change the error message strings by listening to the `ventuz-stream-player:strings` event. The event details contain an object with 
all built-in messages; just change the strings in that object to anything you'd like. For a list of all possible strings, check the `defaultStatusMsgs` object in `ventuz-stream-player.ts´.

## Building

This project is using [npm](https://www.npmjs.com/) and [Vite](https://vite.dev/) so the usual commands apply:
- `npm install` installs all prerequisites
- `npm run dev` runs the Vite development server
- `npm run build` builds the minified bundle and packages it in the `dist` folder
- `npm pack` creates a tarball for offline distribution

## 3rd party Credits

Portions from [wfs.js](https://github.com/ChihChengYang/wfs.js), Copyright (c) 2018 ChihChengYang, licensed under the BSD-2-Clause license

Portions from [hls.js](https://github.com/dailymotion/hls.js), Copyright (c) 2017 Dailymotion, licensed under the Apache License, Version 2.0 