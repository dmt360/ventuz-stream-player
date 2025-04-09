# streamout-webcomponent

![Build Status](https://github.com/VentuzTechnology/streamout-webcomponent/actions/workflows/build.yml/badge.svg)

INTERNAL DOC SO FAR

Development:
- "npm install" to init project
- use Ventuz Trunk or >=8.2, set up device config with stream output, run something
- "npm run dev" to start the dev server
- "npm run build" to build the component in /dist

Usage:
- NPM based projects, eg. Ventuz:
  - run "npm pack" to create a tarball
  - put that tarball somewhere and add a dependency in your package.json like this:
    `"ventuz-stream-player": "somefolder/ventuz-stream-player-<version>.tgz"`
- Others: Just include dist/ventuz-stream-player-min.js in your project
- For the rest, check out dist/index.html, it's not really hard :)
