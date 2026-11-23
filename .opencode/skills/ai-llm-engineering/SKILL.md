---
name: ai-llm-engineering
description: LLM application design, prompts, evaluation, RAG and agent workflows
---

For AI/LLM tasks:
1. Identify provider, model constraints, latency, cost, privacy, and data boundaries.
2. Separate system instructions, user input, retrieved context, and tool output.
3. For RAG, document chunking, embeddings, retrieval, reranking, citations, and freshness.
4. Add evaluation cases for correctness, refusal behavior, injection resistance, and regressions.
5. Keep secrets in environment variables or a secret manager; never commit keys.
6. Prefer reproducible tests and explicit fallbacks over unsupported claims.
