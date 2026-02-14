#!/usr/bin/env node
import React from "react";
import { render } from "ink";
import { App } from "./app.js";

// Enter alternate screen buffer (fullscreen, like vim/htop)
const ALT_SCREEN_ON = "\x1B[?1049h\x1B[H";
const ALT_SCREEN_OFF = "\x1B[?1049l";

process.stdout.write(ALT_SCREEN_ON);

const app = render(<App />);

// Restore original screen on exit
const restore = () => process.stdout.write(ALT_SCREEN_OFF);
app.waitUntilExit().then(restore);
process.on("SIGINT", restore);
process.on("SIGTERM", restore);
