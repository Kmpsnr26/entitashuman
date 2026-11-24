# AleCore Local AI

AleCore Local adds first-party, offline-capable conversation to the AleCore AI Windows desktop app. The app keeps model requests on the same computer by calling a fixed loopback address. It does not require ChatGPT login or a cloud API key.

## Model

The default model is `qwen3.5:2b`. The Ollama catalog currently lists approximately 2.7–3.1 GB for this model, with text and image input support. The weights are downloaded separately; they are not embedded in the desktop installer, portable ZIP, or Android APK.

AleCore AI contributes its own assistant identity, system instructions, reasoning guidance, context policy, and application integration. Qwen 3.5 2B is the underlying model that generates the text/image response. This is not a foundation model trained from scratch by this repository.

## Windows setup

1. Install the official native Windows version of Ollama using [Ollama's Windows instructions](https://github.com/ollama/ollama/blob/main/docs/windows.mdx). The official app runs in the background and provides the local API.
2. Extract the AleCore AI portable package to a folder you control. It includes `Setup-AleCore-Local.ps1`.
3. Open PowerShell in that folder and run `.\Setup-AleCore-Local.ps1`.
4. On the current development PC, the helper selects `D:\AleCoreAI\Models` when D: is available. Otherwise it uses an already configured `OLLAMA_MODELS` folder or the user's Ollama model folder. It creates the target directory but does not move, delete, or overwrite existing files.
5. On its first run, the helper sets the user-scoped `OLLAMA_MODELS` variable and asks you to quit Ollama from the system-tray icon and start it again. Run the helper once more after restarting Ollama. It then checks the local server, downloads `qwen3.5:2b` if missing, and verifies the model.
6. Start AleCore AI Desktop, select **AleCore Local**, and press **Periksa lagi**. The status should show that Ollama and the configured model are available.

Ollama's local API is expected at `http://127.0.0.1:11434`. AleCore Local hard-codes this loopback origin; the renderer cannot supply another host. Do not change Ollama to listen on `0.0.0.0` and do not expose port 11434 to Wi-Fi/LAN. The Android phase must use a separate authenticated bridge, not a direct connection to Ollama's unauthenticated API.

## Runtime limits

The adapter uses a 4096-token context setting, retains at most 6000 characters of recent conversation history, and caps output at 512 tokens to keep memory use bounded on entry-level GPUs. On a machine with 4 GB VRAM, Ollama may offload some layers to system RAM/CPU; responses may be slower. Actual speed and GPU memory use must be measured on the target computer.

The adapter does not silently fall back to a paid cloud provider. If Ollama is unavailable or the model is missing, AleCore Local reports that condition instead of pretending to be ready.

## Android

The current Android APK does not bundle this model or a local inference runtime and does not connect to the Windows-hosted model yet. Mobile-to-desktop routing is a separate milestone. It must use a secured, authenticated AleCore bridge; never expose the raw Ollama port directly to a local network.