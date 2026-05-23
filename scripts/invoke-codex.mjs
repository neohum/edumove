#!/usr/bin/env node
// invoke-codex.mjs — drive the `codex` CLI as the typist.
// Usage: node scripts/invoke-codex.mjs "<task>"

import { spawn } from "node:child_process";

const task = process.argv.slice(2).join(" ").trim();
if (!task) {
  console.error('usage: node scripts/invoke-codex.mjs "<task>"');
  process.exit(2);
}

const prompt = [
  "You are the **typist** agent. Apply the change with the smallest possible diff.",
  "Do not redesign anything; do not invent new abstractions.",
  "If the task implies a design call, stop and say so.",
  "",
  "Task:",
  task,
].join("\n");

const child = spawn("codex", ["exec", prompt], { stdio: "inherit" });
child.on("error", (e) => {
  if (e.code === "ENOENT") {
    console.error("codex CLI not found. Install: https://github.com/openai/codex");
    process.exit(127);
  }
  throw e;
});
child.on("exit", (code) => process.exit(code ?? 0));
