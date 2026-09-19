# Qwen3.5-4B versus Gemma 4 E4B for book reading

Verified against published model configurations on September 19, 2026. Architecture suggests Qwen is worth testing; it does not establish better book summaries or lower total memory than Gemma on this Ollama installation.

- **Qwen3.5-4B** is dense, with 24 linear-attention layers and 8 full-attention layers. Its full-attention head dimension is 256, with four KV heads. Native context is 262,144 tokens. A single-sequence fp16 K+V estimate is `2 × 8 × 4 × 256 × 2 = 32,768 bytes/token`, or **4 GiB at 131,072 tokens**, before recurrent state, weights and runtime overhead. An 8-bit cache is roughly half that, plus quantization overhead. The supplied 16 KB/token and 2 GB fp16 estimate was too low. The MoE description applies to other family members, not this dense 4B configuration. [Official Qwen configuration](https://huggingface.co/Qwen/Qwen3.5-4B/raw/main/config.json)
- **Gemma 4 E4B** has **35 sliding-window layers and 7 full-attention layers**, not 36 and 6. Its configuration specifies a 512-token window, two KV heads, 18 KV-shared layers, and proportional RoPE. The configuration alone does not establish a 37.5% physical cache saving in Ollama. Its native context is 131,072 tokens. [Official Gemma configuration](https://huggingface.co/google/gemma-4-E4B-it/raw/main/config.json)
- Gemma’s 4.5B effective / 8B total parameter distinction is documented; the effective count should not be used directly to estimate resident weight memory. [Google model card](https://ai.google.dev/gemma/docs/core/model_card_4)
- The older full-attention Qwen3-4B has 36 layers, eight KV heads and head dimension 128: 144 KiB/token fp16, hypothetically 18 GiB at 128 Ki tokens. Its published native context is 40,960, so that 128K comparison assumes extension. [Older Qwen configuration](https://huggingface.co/Qwen/Qwen3-4B/raw/main/config.json)
- `--language-model-only` is a **vLLM** option, not an Ollama option. Likewise an MTP head does not imply speculative decoding is automatically enabled. [Qwen deployment instructions](https://huggingface.co/Qwen/Qwen3.5-4B)

The official Ollama Qwen3.5 4B download is about 3.4 GB; file size is not runtime memory. [Ollama model library](https://ollama.com/library/qwen3.5)

Recurrent state compresses history and can lose information. Sliding windows limit local attention while global layers still connect distant tokens. Neither architecture guarantees that a larger reading chunk improves comprehension.

For a useful comparison, keep book, chapter boundaries, focus and target fixed first; compare factual errors, omissions, caveats and synthesis quality alongside memory. Then increase the target for each model separately. Tokenizers differ, so equal token targets do not imply identical text boundaries. The UI records sampled memory, allocated context, measured input tokens and output generation speed. RSS covers all Ollama processes, so other loaded models confound that metric. Free RAM is not available-memory headroom on macOS. A larger configured context can allocate memory even when the actual passage is short.

## Local smoke test

On this 16 GiB Mac, Ollama 0.34.0 with `qwen3.5:4b` Q4_K_M successfully summarized the existing Tiny Habits Chapter 1 in one pass. Reading target: 16,000; allocated context: 18,432; measured input: 9,673; output: 355 tokens; no subdivision or truncated answer. The identical preflight and generation input counts passed the reader's checks.

Sampled model/GPU allocation peaked at 3.43 GiB; all-Ollama RSS at 4.05 GiB. Context check including initial model loading took about 31.6 seconds, and summary generation about 11.4 seconds, with Ollama reporting 31.6 output tokens/second. These are overlapping memory measures, not values to sum. The run used 43 samples at approximately one-second intervals. This is a compatibility smoke test, not a matched Gemma benchmark or a validated full-book quality evaluation.
