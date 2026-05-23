#!/usr/bin/env node
// invoke-gemini.mjs — drive the `gemini` CLI as the researcher.
// Usage: node scripts/invoke-gemini.mjs "<question>" [--input <file>]

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";

const args = process.argv.slice(2);
let inputFile = null;
const rest = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--input") inputFile = args[++i];
  else rest.push(args[i]);
}
const question = rest.join(" ").trim();
if (!question) {
  console.error('usage: node scripts/invoke-gemini.mjs "<question>" [--input <file>]');
  process.exit(2);
}

const corpus = inputFile ? await readFile(inputFile, "utf8") : "";
const prompt = [
  "You are the **researcher** agent. Long-context synthesis only.",
  "Return:",
  "  1. a 5-bullet executive summary,",
  "  2. a detailed section grouped by question, with citations (file:line or page#).",
  "Do not write or edit application code.",
  "",
  `Question: ${question}`,
  corpus ? `\n--- Corpus (${inputFile}) ---\n${corpus}` : "",
].join("\n");

const child = spawn("gemini", ["-p", prompt], { stdio: "inherit" });
child.on("error", (e) => {
  if (e.code === "ENOENT") {
    console.error("gemini CLI not found. Install: https://github.com/google-gemini/gemini-cli");
    process.exit(127);
  }
  throw e;
});
child.on("exit", (code) => process.exit(code ?? 0));
