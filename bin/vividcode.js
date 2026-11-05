#!/usr/bin/env node
"use strict";

const { main } = require("../src/main");

main(process.argv.slice(2)).catch((err) => {
  const { paint, PALETTE } = require("../src/ui");
  console.error();
  console.error(paint("  ✖ VividCode crashed:", PALETTE.red), err && err.message ? err.message : err);
  if (process.env.VIVIDCODE_DEBUG && err && err.stack) console.error(err.stack);
  console.error();
  process.exitCode = 1;
});
