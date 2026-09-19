# Local LLM Chat

A local web UI for Ollama models, built around the latest Gemma 4 workflow but usable with any model you already have downloaded.

Created by Chao Li.

It is designed for people who want a cleaner local chat interface than the terminal, while still keeping everything on their own machine.

## What This App Does

- Streams model responses in real time
- Supports any Ollama model tag available locally
- Optimized for Gemma 4 usage patterns
- Supports text chat, image attachments, and browser mic dictation
- Supports Gemma-style thinking mode with a separate reasoning panel
- Renders markdown, including tables and lists
- Tracks context usage and generation speed
- Stores chat history locally with optional folder mirroring
- Lets each chat keep its own system prompt and settings
- Summarizes PDF books chapter by chapter with adjustable reading targets
- Preserves detailed summaries, with continuations instead of fixed word limits
- Provides chapter bookmarks, model comparisons, and sampled memory records

## Why Gemma 4

This version was shaped primarily around `gemma4:e4b`, especially:

- thinking mode as an on/off control
- multimodal prompting with images
- visual token budget control
- exact context measurement through Ollama

Even so, the UI is not Gemma-only. If Ollama can serve the model, this app can chat with it.

## Screens at a Glance

The app is organized around three ideas:

1. A left rail for session settings and chat history
2. A main conversation area with streamed replies and markdown rendering
3. A composer that supports text, drag-and-drop images, and mic dictation

## Requirements

- macOS, Linux, or Windows with Node.js 20 or newer installed
- Ollama installed locally (0.34 or newer for the book reader)
- At least one Ollama model already pulled
- For PDF books: Poppler (`pdfinfo` and `pdftotext`) available on your PATH

Default endpoints:

```text
UI:      http://127.0.0.1:3000
Ollama:  http://127.0.0.1:11434
```

## Ollama Setup

### 1. Install Ollama

Install Ollama from:

```text
https://ollama.com/download
```

### 2. Pull a model

For the intended Gemma 4 setup:

```bash
ollama pull gemma4:e4b
```

You can also pull any other Ollama model you want to use.

### 3. Start Ollama

If you use the Ollama desktop app, just keep it running.

If you use the CLI:

```bash
ollama serve
```

## Quick Start

Clone the repository once:

```bash
git clone https://github.com/Jerry-Li-Chao/local-llm-chat.git
cd local-llm-chat
```

The server uses Node's built-in modules; no npm dependencies need installing.

### Start the book reader

Install PDF extraction tools once. On macOS with Homebrew:

```bash
brew install poppler
```

On Ubuntu/Debian: `sudo apt install poppler-utils`. On Windows, install Poppler and add its executable directory to PATH. Check that both `pdfinfo -v` and `pdftotext -v` work in the terminal that will start the server.

Keep the Ollama desktop app running, or run `ollama serve` in a separate terminal. Do not start a second Ollama server if one is already running. Install a model once:

```bash
ollama pull qwen3.5:4b
```

From this repository directory, start the local UI:

```bash
npm run start:books
```

Open **[Book reader](http://127.0.0.1:3020/books.html)** or **[Chat](http://127.0.0.1:3020/)**. Keep that terminal open while processing. The startup command defaults to port 3020 and honors an existing `PORT` environment variable.

Import a text PDF, confirm its title and chapter boundaries, choose a model and reading target, then select **Start reading**. The Summaries tab includes sticky chapter bookmarks. To compare models, use **New comparison run** so the original summaries remain available.

### Start chat on the original default port

```bash
npm start
```

This serves both chat and books at port **3000** by default: [Chat](http://127.0.0.1:3000/) and [Book reader](http://127.0.0.1:3000/books.html). You only need one UI server.

### Stop, restart, and update

Press **Ctrl+C** in the server terminal to stop it. Start it again with the same command; saved books and chats remain in `data/`. Interrupted book tasks can be resumed from the UI. Closing a browser tab does not stop the server or reading job.

For future updates, stop the UI server, run `git pull --ff-only` from the repository directory, then run `npm run start:books` again. Your local `data/` directory is excluded from Git.

If startup reports **EADDRINUSE**, that port is already occupied; use the existing reader or stop its terminal before restarting. If models are unavailable, check that Ollama is running and use **Refresh models**. If a book request loses its connection, completed chapters remain saved: use **Retry unfinished tasks** after restoring Ollama. Summary responses are streamed to avoid waiting for an entire long answer before receiving data.

Chapter detection is heuristic: a body-text reference such as “chapter 5 …” can be mistaken for a heading. Review the suggested ranges before starting; this known limitation is not yet fixed.

## First Run Guide

1. Confirm the sidebar says Ollama is `Connected`
2. Pick a model such as `gemma4:e4b`
3. Optionally set a system prompt
4. Optionally enable thinking mode
5. Optionally attach an image or drag one into the composer
6. Type a prompt and click `Send`

## Key Features

### 1. Streaming chat

Responses stream into the UI as they are generated.

### 2. Thinking mode

For Gemma 4, thinking mode prepends `<|think|>` to the system prompt. The UI can show reasoning separately while still keeping persisted multi-turn history clean by storing only the final answer.

### 3. Markdown rendering

Assistant replies render headings, lists, code blocks, tables, and other common markdown formatting.

### 4. Image input

You can attach images from the button or drag and drop them into the composer. Image previews stay constrained, and sent images can be opened in a floating viewer.

### 5. Per-chat system prompts

Each conversation keeps its own system prompt and session settings.

### 6. Chat history

Chats are saved locally, can be cleared individually, and can be exported or imported as JSON.

### 7. Context visibility

The header shows:

- generation speed in `tok/s`
- exact measured prompt context usage

This helps users see when a conversation is getting large enough that a fresh chat may be cleaner.

### 8. Sensible Gemma 4 defaults

The app uses:

- `temperature = 1.0`
- `top_p = 0.95`
- `top_k = 64`

And it exposes:

- context length
- thinking mode
- visual token budget

## Storage and Privacy

This app is local-first.

By default:

- the Node app saves history to a JSON file on your machine
- the browser keeps a local recovery/settings copy
- nothing is sent to any hosted third-party chat service by this UI

Chat history is stored in an app-managed file by default. You can also optionally mirror that history into a folder you choose from the UI.

### Default history location

```text
./data/chat-history.json
```

### Optional environment variables

You can change the save location:

```bash
CHAT_HISTORY_PATH=~/Library/Application\ Support/local-llm-chat/history.json npm start
```

Or move all app data into a different directory:

```bash
DATA_DIR=./my-local-data npm start
```

You can also point the UI at a non-default Ollama host:

```bash
OLLAMA_BASE_URL=http://127.0.0.1:11434 npm start
```

### Privacy notes before uploading this repo

- `data/` is ignored except for a placeholder file
- `.env` files are ignored
- local chat history should not be committed
- exported history JSON files should also be treated as private

If you have already created personal chats locally, review and remove them before making your first public commit.

## Browser Notes

### Mic dictation

The mic button uses browser speech recognition to turn speech into text. It does not send raw audio to Ollama.

Best results:

- use a current Chromium-based browser
- allow microphone access
- speak, stop dictation, then send the transcribed text

### Folder mirroring

Folder mirroring depends on browser support for choosing a local folder. The app still works without it.

## Benchmarking Gemma 4 Speed

This repo includes a local benchmark script for comparing token output speed across Gemma 4 variants with thinking on and off.

Default benchmark coverage:

- models: `gemma4:e2b` and `gemma4:e4b`
- prompts: 5 built-in prompts
- thinking modes: off and on
- output metric: `tok/s` from Ollama's `eval_count / eval_duration`
- summary stats: average, min, and max speed

Run it with:

```bash
npm run benchmark:gemma-speed
```

Useful options:

```bash
node scripts/benchmark-gemma-speed.js --repeat 2
node scripts/benchmark-gemma-speed.js --num-predict 300
node scripts/benchmark-gemma-speed.js --output data/gemma-speed-results.json
node scripts/benchmark-gemma-speed.js --models gemma4:e2b,gemma4:e4b
```

Notes:

- thinking-on speed includes the actual extra generated reasoning tokens
- prompts are normalized with a target answer length so runs are more comparable
- the benchmark talks directly to your local Ollama instance, not the browser UI

### Example benchmark result
rest
The full local comparison was run with these parameters:

- hardware: MacBook Pro with Apple M1 Pro and 16 GB memory
- models: `gemma4:e2b`, `gemma4:e4b`
- prompts: 5 built-in prompts
- thinking modes: off and on
- repeat: `1`
- `num_ctx`: `8192`
- `num_predict`: `220`
- sampling: `temperature=1.0`, `top_p=0.95`, `top_k=64`

In day-to-day use on this machine, the practical context setting is generally capped around `8,192` tokens.

Observed result from that run:

| Model | Thinking | Avg tok/s | Min tok/s | Max tok/s | Runs |
| :--- | :--- | ---: | ---: | ---: | ---: |
| `gemma4:e2b` | Off | 50.7 | 49.8 | 51.6 | 5 |
| `gemma4:e2b` | On | 50.9 | 50.0 | 51.9 | 5 |
| `gemma4:e4b` | Off | 30.0 | 29.1 | 30.8 | 5 |
| `gemma4:e4b` | On | 30.3 | 29.9 | 30.8 | 5 |

In this run, `gemma4:e2b` was roughly `1.7x` faster than `gemma4:e4b`, while thinking on/off changed output speed only slightly.

## Troubleshooting

### Ollama shows as offline

Make sure Ollama is running and listening on `127.0.0.1:11434`, then click `Refresh`.

### My model is not in the picker

Click `Refresh`, or type the model tag manually if you know it already exists locally.

### The first reply is slow

That usually means Ollama is loading the model into memory.

### Images are not being preserved

Make sure you are using the current server version and that history saving is enabled normally. Large image-bearing chats depend on the local history file being writable.

## Product Story

This app was not built as a single polished pass. It got better through a lot of real friction:

- The UI started as a straightforward local chat shell, then got reshaped around actual Gemma 4 use: thinking mode, multimodal prompts, and context awareness.
- Markdown rendering had to be hardened because model output was often technically markdown but not always cleanly spaced.
- Chat history started simple, then grew into a hybrid local system with immediate saves, recovery behavior, import/export, and optional folder mirroring.
- The composer kept being compressed and simplified so image attachment, dictation, and collapse behavior felt practical rather than noisy.
- The app was later refactored into smaller modules because a single giant frontend file had become too hard to maintain.

That iterative history is still visible in the current feature set: most things here exist because they solved a real annoyance during day-to-day local model use.

## Project Structure

- `server.js`: local HTTP server, Ollama proxy, persistence, title generation, and exact context helpers
- `public/index.html`: UI markup
- `public/styles.css`: styling
- `public/app.js`: app bootstrap and top-level composition
- `public/app-events.js`: DOM event wiring
- `public/app-shared.js`: shared normalization and prompt helpers
- `public/model-context.js`: model status, connection state, and context recommendation logic
- `public/chat.js`: request building, streaming, session title generation, and context measurement
- `public/media.js`: image handling, drag and drop, lightbox behavior, and mic dictation
- `public/render.js`: message rendering, markdown rendering, and message-level UI interactions
- `public/history.js`: history composition layer
- `public/history-storage.js`: persistence backends, import/export, and folder mirroring
- `public/history-sessions.js`: session CRUD, active chat switching, and history-list rendering
- `public/history-session-utils.js`: session normalization and merge helpers

## License

This project is licensed under Apache-2.0. See `LICENSE`.

## Book reader: PDFs larger than the context window

Open **Book reader** from the chat sidebar, or visit `/books.html`. It runs against the same configured Ollama server. Install [Poppler](https://poppler.freedesktop.org/) for `pdfinfo` and `pdftotext` (macOS: `brew install poppler`). No additional npm dependencies are needed.

1. Import a text PDF (up to 40 MB). Page count, word count, extracted-text size, and chapter suggestions are calculated locally before inference.
2. Review the book title and optional author in **Book details** (suggested from PDF metadata, otherwise the filename). Every prompt includes that identity separately from the section heading and page range. Details can be edited while paused; completed summaries are not rewritten. Review suggested chapter ranges. Contents titles are matched against headings; chapter-heading heuristics and a full-text fallback handle other documents. Page positions refer to the PDF, not printed page numbers. Ranges must cover all pages, including front matter, exactly once.
3. Choose a local model and summary focus, then start reading. The visible queue expands as oversized tasks are reached. Select a task to inspect the budget decision, source, exact prompt, token count, and result.
4. Pause/resume or retry unfinished tasks. Completed child summaries are reused. Export available chapter and book summaries as Markdown.
5. Use **Cancel and clear** to stop and permanently remove the selected book from the library after confirmation. Its extracted text, tasks, activity, summaries, and app-managed migration backup are removed; your original PDF, exports, and other books are kept.

The scheduler is deterministic orchestration, not a model inventing its own task plan. Ollama generates the summaries. Every inference uses a fresh prompt and a context allocation matching the reading target (8,192 by default); no chat history is accumulated. The book task receives chapter summaries only. Large collections of summaries are recursively split and reduced again.

### Context policy

By default, the planner targets **6,000 input tokens**, allows at most **6,656 measured input tokens**, reserves at least **1,024 output tokens**, and leaves **512 tokens** of spare context. It uses the observed bytes-per-token ratio only to propose passages; an Ollama one-token preflight measures each complete prompt (instructions, focus, and overlap included) before full generation. Both calls use the same configured `num_ctx`, `truncate=false`, and `shift=false`. Oversized candidates are rejected or subdivided, never silently shortened. This requires Ollama 0.34 or newer. Every accepted output is checked against the preflight count; missing counts stop processing. There is no summary word limit. Each generation may use the remaining measured context minus 512 safety tokens. If it fills that allowance, its unfinished draft is saved and a continuation is queued with the original source and a bounded ending of the previous output. Continuations are measured again and assembled outside model context. Incomplete drafts are never marked complete. Repeated output and a 24-request-per-resume guard stop runaway continuations while retaining the draft. Because only the ending of previous output is included, the model may repeat or omit material across continuations; inspect important procedures against the source. New runs use the installed model’s Ollama chat template with thinking disabled; the preflight includes template tokens. Existing runs retain their original raw-prompt mode.

The splitter scans text without an extra model pass. Near the proposed cut (the last 28% of its byte allowance), it prefers a heading, then a blank-line paragraph break, then a sentence ending, then whitespace. Unicode-safe character cuts are the final fallback. Up to 600 bytes from the previous passage are explicitly labelled as continuity context and included in the token budget. Non-overlapping source offsets preserve complete coverage; synthesis passes avoid adding overlap. This is structure-aware, not semantic understanding: an argument can span paragraphs, and PDF extraction can lose paragraph breaks. Actual measured token counts, boundary type, overlap, and the planned prompt are visible in the inspector. Summary prompts prioritize important explanations, evidence, and actionable procedures, including prerequisites, exceptions, and cautions. Length follows the material rather than a word-count target. Chapter tasks never combine source text from adjacent chapters, even if both would fit the selected reading target.

The Summaries tab and task summaries render escaped Markdown, including headings, emphasis, lists, code, quotes, and tables. Activity is a categorized timeline with reading/completion/planning/attention filters and links to tasks; older plain-text events are categorized for display. Existing completed summaries are retained on resume, while contiguous unfinished legacy passages are consolidated and replanned with the new budget. See the [Ollama API definitions](https://github.com/ollama/ollama/blob/main/api/types.go) for truncation controls.

PDF extraction and chapter discovery use local tools, not LLM context. Automatic chapter detection is heuristic and needs review. Image-only pages require OCR outside this app; diagrams and images are not interpreted. Chunk summaries are lossy, so exported summaries do not replace the original book.

Jobs, extracted text, prompts, and summaries are stored under `data/books/` (or `$DATA_DIR/books/`). The uploaded PDF is removed after extraction. Closing the browser does not stop a running job. After a server restart, interrupted jobs become resumable. Only one book runs at a time; pause it before starting another. Ordinary chat requests can still run independently.

Run `npm test` for context budgets, recursive reduction, structural boundaries, Unicode coverage, migration/resume, and Markdown rendering checks.


### Per-task memory records

The **Memory** tab and task inspector show sampled peak model allocation, GPU allocation, and resident memory (RSS) for all local Ollama processes. Readings start before each context check and summary request, repeat with a nominal one-second interval, and finish after the request. Sampling takes time and can miss brief spikes; these are observed maxima, not operating-system high-water marks. Interrupted attempts retain their records. The records are saved with the job at task boundaries, including pause/error completion, and can be exported as JSON. A sudden server crash can lose samples from the active request. Old tasks display **Not recorded**.

Model allocation and GPU allocation come from Ollama's `/api/ps` for the selected model. Local RSS includes the Ollama process tree, including any other loaded models, and may count shared mappings more than once. The reader's own memory is not included. On Apple silicon, GPU and CPU share physical memory; allocation and RSS overlap and must not be added. The **Lowest free memory** table column shows the lowest observed host free memory during each task (not its current value), but free memory is not equivalent to available headroom because caches, compression, and other applications matter. Remote Ollama connections report model allocation only; local host RSS/free-memory numbers are omitted. These measurements inform experiments but do not automatically increase the context limit. Compare the same model and workload at different configured contexts rather than extrapolating extra tokens directly from free RAM.

### Reading targets and model comparisons

Reading settings provides a 2,000–64,000 token target slider. The target includes instructions and overlap, so source text is shorter. Context is rounded up to a multiple of 1,024 after reserving 1,024 answer tokens and 512 safety tokens. This is an application range, not a claim that every setting fits available RAM. The model’s reported context capacity is checked before inference.

Pause a run to save a new target for unfinished passages. Completed summaries retain their original measurements. Use **New comparison run** to reuse extracted pages, metadata, focus and chapter boundaries with a different model, preserving the original run. Choose `qwen3.5:4b` after it is installed in Ollama. Memory history records context per attempt and output tokens/second for future generations; old records show missing values instead of invented measurements. Output speed excludes prompt processing and model loading.
