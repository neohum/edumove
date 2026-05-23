#!/usr/bin/env node
// invoke-claude.mjs — drive the `claude` CLI as the architect.
// Usage: node scripts/invoke-claude.mjs "<task>"

import { spawn } from "node:child_process";

const task = process.argv.slice(2).join(" ").trim();
if (!task) {
  console.error('usage: node scripts/invoke-claude.mjs "<task>"');
  process.exit(2);
}

const prompt = [
  "You are the **architect** agent for this repo.",
  "Read CLAUDE.md, lat.md, and DESIGN.md first (cite them if you rely on them).",
  "Then handle this task with the minimum diff that solves the stated problem:",
  "",
  task,
].join("\n");

const child = spawn("claude", ["-p", prompt], { stdio: "inherit" });
child.on("error", (e) => {
  if (e.code === "ENOENT") {
    console.error("claude CLI not found. Install: https://docs.claude.com/en/docs/claude-code");
    process.exit(127);
  }
  throw e;
});
child.on("exit", (code) => process.exit(code ?? 0));
