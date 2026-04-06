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

- macOS, Linux, or Windows with Node.js installed
- Ollama installed locally
- At least one Ollama model already pulled

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

```bash
git clone <your-repo-url>
cd local-llm-chat
npm start
```

Then open:

```text
http://127.0.0.1:3000
```

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

- `server.js`: thin server entrypoint
- `server/config.js`: runtime paths, limits, and host configuration
- `server/router.js`: route matching and dispatch
- `server/handlers/api-handlers.js`: HTTP handlers for chat, status, history, and helpers
- `server/services/ollama-service.js`: Ollama API calls and response shaping
- `server/services/history-service.js`: chat-history normalization and disk persistence
- `server/services/static-service.js`: static asset serving
- `server/utils/http.js`: JSON body parsing and response helpers
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
