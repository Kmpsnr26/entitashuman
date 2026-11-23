# AleCore Local AI

AleCore Local adds first-party, offline-capable conversation to the AleCore AI Windows desktop app. The app keeps model requests on the same computer by calling a fixed loopback address. It does not require ChatGPT login or a cloud API key.

## Model

The default model is `qwen3.5:2b`. The Ollama catalog currently lists approximately 2.7–3.1 GB for this model, with text and image input support. The weights are downloaded separately; they are not embedded in the desktop installer, portable ZIP, or Android APK.

AleCore AI contributes its own assistant identity, system instructions, reasoning guidance, context policy, and application integration. Qwen 3.5 2B is the underlying model that generates the text/image response. This is not a foundation model trained from scratch by this repository.

## Windows setup

1. Install the official native Windows version of Ollama using [Ollama's Windows instructions](https://github.com/ollama/ollama/blob/main/docs/windows.mdx). The official app runs in the background and provides the local API.
2. On the current development PC, the C: drive has limited free space and D: has more room. To store model weights on D: without touching existing files, open PowerShell and run:

   `New-Item -ItemType Directory -Force -Path 'D:\AleCoreAI\Models' | Out-Null`
   `[Environment]::SetEnvironmentVariable('OLLAMA_MODELS', 'D:\AleCoreAI\Models', 'User')`

   This creates only the new folder and sets a user-scoped environment variable. It does not move, delete, or overwrite existing files. If D: is unavailable on another PC, choose a folder on a drive with enough free space instead.
3. Quit Ollama from its system-tray icon, then start Ollama again so it inherits the new environment variable. Open a new PowerShell window.
4. Download the model with `ollama pull qwen3.5:2b`.
5. Confirm it is installed with `ollama list`.
6. Start AleCore AI Desktop, select **AleCore Local**, and press **Periksa lagi**. The status should show that Ollama and the configured model are available.

Ollama's local API is expected at `http://127.0.0.1:11434`. AleCore Local hard-codes this loopback origin; the renderer cannot supply another host. Do not change Ollama to listen on `0.0.0.0` and do not expose port 11434 to Wi-Fi/LAN. The Android phase must use a separate authenticated bridge, not a direct connection to Ollama's unauthenticated API.

## Runtime limits

The adapter uses a 4096-token context setting, retains at most 6000 characters of recent conversation history, and caps output at 512 tokens to keep memory use bounded on entry-level GPUs. On a machine with 4 GB VRAM, Ollama may offload some layers to system RAM/CPU; responses may be slower. Actual speed and GPU memory use must be measured on the target computer.

The adapter does not silently fall back to a paid cloud provider. If Ollama is unavailable or the model is missing, AleCore Local reports that condition instead of pretending to be ready.

## Android

The current Android APK does not bundle this model or a local inference runtime and does not connect to the Windows-hosted model yet. Mobile-to-desktop routing is a separate milestone. It must use a secured, authenticated AleCore bridge; never expose the raw Ollama port directly to a local network.