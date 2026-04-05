# Contributing

Thanks for contributing.

## Local Setup

1. Install Node.js
2. Install Ollama
3. Pull at least one local model, for example:

```bash
ollama pull gemma4:e4b
```

4. Start Ollama:

```bash
ollama serve
```

5. Start the app:

```bash
npm start
```

Open `http://127.0.0.1:3000`.

## Development Notes

- This app is local-first and intended to work with Ollama on the same machine.
- The current UX is designed with Gemma 4 in mind, but contributions should avoid hard-coding the UI to a single model unless the behavior is truly model-specific.
- Keep chat history and any exported JSON files out of commits.
- Prefer small, focused changes over large rewrites.

## Before Opening a PR

- Make sure the app still starts locally
- Make sure changed JavaScript files pass:

```bash
node --check public/app.js
```

- If you add or split modules, run `node --check` on those too
- Smoke test the main flows you touched

Main flows:

- model refresh and selection
- send prompt and stream response
- markdown rendering
- history persistence
- image attach and preview
- mic dictation if your change affects it

## Style Expectations

- Keep the UI consistent with the existing monochrome visual language unless the change is intentionally expanding the design system
- Keep public repo content generic and free of personal machine-specific paths or data
- Do not commit local chat history

## Reporting Issues

When possible, include:

- browser and OS
- Ollama version
- model tag used
- steps to reproduce
- screenshots if the issue is visual
