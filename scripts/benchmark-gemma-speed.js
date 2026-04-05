#!/usr/bin/env node

const fs = require('node:fs/promises');

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
const DEFAULT_MODELS = ['gemma4:e2b', 'gemma4:e4b'];
const DEFAULT_PROMPTS = [
  'Explain why the sky looks blue during the day and red during sunset.',
  'Summarize the pros and cons of remote work for a small startup team.',
  'Write a concise step-by-step plan for learning linear algebra for machine learning.',
  'Compare SQL and NoSQL databases for a product that will launch quickly and then scale.',
  'Given a bug where a web app randomly logs users out, outline a debugging strategy.',
];
const DEFAULT_SAMPLING = {
  temperature: 1.0,
  top_p: 0.95,
  top_k: 64,
};
const DEFAULT_NUM_CTX = 8192;
const DEFAULT_NUM_PREDICT = 220;

function parseArgs(argv) {
  const options = {
    models: DEFAULT_MODELS,
    prompts: DEFAULT_PROMPTS,
    repeat: 1,
    numCtx: DEFAULT_NUM_CTX,
    numPredict: DEFAULT_NUM_PREDICT,
    output: '',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === '--models' && next) {
      options.models = next.split(',').map((value) => value.trim()).filter(Boolean);
      index += 1;
    } else if (arg === '--repeat' && next) {
      options.repeat = Math.max(1, Number.parseInt(next, 10) || 1);
      index += 1;
    } else if (arg === '--num-ctx' && next) {
      options.numCtx = Math.max(512, Number.parseInt(next, 10) || DEFAULT_NUM_CTX);
      index += 1;
    } else if (arg === '--num-predict' && next) {
      options.numPredict = Math.max(1, Number.parseInt(next, 10) || DEFAULT_NUM_PREDICT);
      index += 1;
    } else if (arg === '--prompts-file' && next) {
      options.promptsFile = next;
      index += 1;
    } else if (arg === '--output' && next) {
      options.output = next;
      index += 1;
    } else if (arg === '--help') {
      printHelp();
      process.exit(0);
    }
  }

  return options;
}

function printHelp() {
  console.log(`Gemma speed benchmark

Usage:
  node scripts/benchmark-gemma-speed.js [options]

Options:
  --models gemma4:e2b,gemma4:e4b  Comma-separated model list
  --repeat 2                      Repeat each prompt N times
  --num-ctx 8192                  Context size used for benchmark requests
  --num-predict 220               Max tokens to generate per request
  --prompts-file prompts.json     JSON file containing an array of prompt strings
  --output results.json           Write detailed results as JSON
  --help                          Show this help
`);
}

async function loadPrompts(promptsFile) {
  if (!promptsFile) {
    return DEFAULT_PROMPTS;
  }

  const raw = await fs.readFile(promptsFile, 'utf8');
  const parsed = JSON.parse(raw);

  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === 'string' && item.trim())) {
    throw new Error('Prompts file must be a JSON array of non-empty strings.');
  }

  return parsed.map((item) => item.trim());
}

function buildMessages(prompt, thinkingEnabled) {
  const benchmarkInstruction = 'Answer in roughly 180 to 220 tokens with clear structure and no filler.';
  const userPrompt = `${prompt.trim()}\n\n${benchmarkInstruction}`;

  if (!thinkingEnabled) {
    return [{ role: 'user', content: userPrompt }];
  }

  return [
    { role: 'system', content: '<|think|>' },
    { role: 'user', content: userPrompt },
  ];
}

function toTokensPerSecond(evalCount, evalDuration) {
  if (!Number.isFinite(evalCount) || !Number.isFinite(evalDuration) || evalCount <= 0 || evalDuration <= 0) {
    return null;
  }

  return (evalCount * 1_000_000_000) / evalDuration;
}

async function runBenchmarkCase({ model, prompt, promptIndex, thinkingEnabled, iteration, numCtx, numPredict }) {
  const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      model,
      stream: false,
      messages: buildMessages(prompt, thinkingEnabled),
      options: {
        ...DEFAULT_SAMPLING,
        num_ctx: numCtx,
        num_predict: numPredict,
      },
    }),
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok || !payload) {
    throw new Error(payload?.error || `Request failed with status ${response.status}.`);
  }

  const speed = toTokensPerSecond(payload.eval_count, payload.eval_duration);

  if (speed === null) {
    throw new Error('Ollama response did not include eval_count/eval_duration.');
  }

  return {
    model,
    promptIndex,
    prompt,
    thinkingEnabled,
    iteration,
    evalCount: Number(payload.eval_count),
    evalDuration: Number(payload.eval_duration),
    promptEvalCount: Number.isFinite(payload.prompt_eval_count) ? Number(payload.prompt_eval_count) : null,
    totalDuration: Number.isFinite(payload.total_duration) ? Number(payload.total_duration) : null,
    tokensPerSecond: speed,
  };
}

function summarizeResults(results) {
  const groups = new Map();

  for (const result of results) {
    const key = `${result.model}::${result.thinkingEnabled ? 'thinking-on' : 'thinking-off'}`;
    const existing = groups.get(key) || {
      model: result.model,
      thinkingEnabled: result.thinkingEnabled,
      speeds: [],
      evalCounts: [],
      promptEvalCounts: [],
    };

    existing.speeds.push(result.tokensPerSecond);
    existing.evalCounts.push(result.evalCount);
    if (Number.isFinite(result.promptEvalCount)) {
      existing.promptEvalCounts.push(result.promptEvalCount);
    }
    groups.set(key, existing);
  }

  return [...groups.values()].map((group) => {
    const totalSpeed = group.speeds.reduce((sum, value) => sum + value, 0);
    const averageSpeed = totalSpeed / group.speeds.length;
    const minSpeed = Math.min(...group.speeds);
    const maxSpeed = Math.max(...group.speeds);

    return {
      model: group.model,
      thinkingEnabled: group.thinkingEnabled,
      runs: group.speeds.length,
      averageTokensPerSecond: averageSpeed,
      minTokensPerSecond: minSpeed,
      maxTokensPerSecond: maxSpeed,
      averageEvalCount: group.evalCounts.reduce((sum, value) => sum + value, 0) / group.evalCounts.length,
      averagePromptEvalCount: group.promptEvalCounts.length
        ? group.promptEvalCounts.reduce((sum, value) => sum + value, 0) / group.promptEvalCounts.length
        : null,
    };
  });
}

function formatNumber(value) {
  return Number(value).toFixed(1);
}

function printSummary(summary) {
  console.log('');
  console.log('Summary');
  console.log('-------');

  for (const item of summary) {
    console.log(
      `${item.model} | ${item.thinkingEnabled ? 'thinking on ' : 'thinking off'} | `
      + `avg ${formatNumber(item.averageTokensPerSecond)} tok/s | `
      + `min ${formatNumber(item.minTokensPerSecond)} | `
      + `max ${formatNumber(item.maxTokensPerSecond)} | `
      + `${item.runs} runs`,
    );
  }
}

function printDetailedResults(results) {
  console.log('');
  console.log('Detailed runs');
  console.log('-------------');

  for (const result of results) {
    console.log(
      `${result.model} | prompt ${result.promptIndex + 1} | ${result.thinkingEnabled ? 'thinking on ' : 'thinking off'} | `
      + `run ${result.iteration} | ${formatNumber(result.tokensPerSecond)} tok/s | `
      + `${result.evalCount} output tokens`,
    );
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const prompts = await loadPrompts(options.promptsFile);
  const results = [];

  console.log(`Benchmarking ${options.models.join(', ')} against ${prompts.length} prompts.`);
  console.log(`Thinking modes: off, on | repeat: ${options.repeat} | num_ctx: ${options.numCtx} | num_predict: ${options.numPredict}`);

  for (const model of options.models) {
    for (const thinkingEnabled of [false, true]) {
      for (let promptIndex = 0; promptIndex < prompts.length; promptIndex += 1) {
        for (let iteration = 1; iteration <= options.repeat; iteration += 1) {
          const label = `${model} | prompt ${promptIndex + 1}/${prompts.length} | ${thinkingEnabled ? 'thinking on ' : 'thinking off'} | run ${iteration}/${options.repeat}`;
          process.stdout.write(`${label} ... `);

          const result = await runBenchmarkCase({
            model,
            prompt: prompts[promptIndex],
            promptIndex,
            thinkingEnabled,
            iteration,
            numCtx: options.numCtx,
            numPredict: options.numPredict,
          });

          results.push(result);
          console.log(`${formatNumber(result.tokensPerSecond)} tok/s`);
        }
      }
    }
  }

  const summary = summarizeResults(results).sort((a, b) => {
    if (a.model === b.model) {
      return Number(a.thinkingEnabled) - Number(b.thinkingEnabled);
    }
    return a.model.localeCompare(b.model);
  });

  printSummary(summary);
  printDetailedResults(results);

  if (options.output) {
    await fs.writeFile(options.output, JSON.stringify({
      baseUrl: OLLAMA_BASE_URL,
      generatedAt: new Date().toISOString(),
      models: options.models,
      prompts,
      repeat: options.repeat,
      numCtx: options.numCtx,
      numPredict: options.numPredict,
      results,
      summary,
    }, null, 2));
    console.log('');
    console.log(`Wrote detailed results to ${options.output}`);
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
