---
description: Hand a long-context analysis task to the researcher (Gemini).
argument-hint: "<question> [--input <file>]"
---

Use `scripts/invoke-gemini.mjs` to run a researcher analysis with `$ARGUMENTS`. If the user passed `--input <file>`, stream that file as the corpus. Summarize the result with file/page citations.
