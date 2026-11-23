# AleCore Local AI

AleCore Local adds first-party, offline-capable conversation to the Windows desktop app. It runs a locally installed Ollama runtime and keeps prompts/model traffic on the same computer.

## Default model

The default is `qwen3.5:2b`. The model weights are downloaded separately and are not embedded in the application ZIP or APK.

## Windows setup

1. Install Ollama for Windows from its official website.
2. Open PowerShell and run:

   ```powershell
   ollama pull qwen3.5:2b
   ```

3. Confirm the runtime and model:

   ```powershell
   ollama list
   ```

4. Start AleCore AI Desktop, open its settings, select **AleCore Local**, and press **Periksa lagi**.

Ollama serves its local API at `http://127.0.0.1:11434`. AleCore Local hard-codes this loopback origin; the renderer cannot supply an arbitrary endpoint. No API key or ChatGPT login is required for this provider after the model is downloaded.

For the user's PC where the system drive is space-limited, model storage can be redirected to a data drive by setting the Windows user environment variable `OLLAMA_MODELS` before pulling the model. Restart Ollama after changing it.

## Runtime limits

The default context window is constrained to 4096 tokens and the response cap is 512 tokens to keep memory use bounded on entry-level GPUs. If the machine cannot fit the model fully in GPU memory, Ollama may use available system RAM/CPU and responses can be slower. This adapter does not silently fall back to a paid cloud provider.

## Android

The Android APK does not bundle this model or a local inference runtime. Mobile-to-desktop local-network routing is a separate integration phase and must use a secured AleCore bridge; do not expose Ollama's unauthenticated port directly to a Wi-Fi/LAN network.
