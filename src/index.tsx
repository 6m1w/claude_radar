#!/usr/bin/env node
import React from "react";
import { render } from "ink";
import { App } from "./app.js";

// Enter alternate screen buffer (fullscreen, like vim/htop)
const ALT_SCREEN_ON = "\x1B[?1049h\x1B[H";
const ALT_SCREEN_OFF = "\x1B[?1049l";
// Bracket paste mode: terminal wraps pasted text in escape sequences
// so we can detect and ignore it instead of treating each char as a keypress
const BRACKET_PASTE_ON = "\x1B[?2004h";
const BRACKET_PASTE_OFF = "\x1B[?2004l";

process.stdout.write(ALT_SCREEN_ON + BRACKET_PASTE_ON);

const app = render(<App />);

// Restore original screen + disable bracket paste on exit
const restore = () => process.stdout.write(BRACKET_PASTE_OFF + ALT_SCREEN_OFF);
app.waitUntilExit().then(restore);
process.on("SIGINT", restore);
process.on("SIGTERM", restore);
