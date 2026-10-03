package __APP_PACKAGE__;

import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Local Indonesian TTS. No network voice or microphone permission is used. */
@CapacitorPlugin(name = "HumanALEVoice")
public class HumanALEVoicePlugin extends Plugin {
    private static final int MAX_TEXT = 2000;
    private static final int MAX_WAV = 12 * 1024 * 1024;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService files = Executors.newSingleThreadExecutor();
    private TextToSpeech tts;
    private boolean initializing = true, ready = false, destroyed = false;
    private String reason = "initializing", engine = "";
    private long sequence = 0;
    private Request active;
    private final Runnable initTimeout = () -> initializationFailed("unavailable");

    private static final class Request {
        final PluginCall call;
        final String text, mode, id, utteranceId;
        final float pitch, rate;
        File file;
        Runnable timeout;
        Request(PluginCall call, String text, String mode, String id, String utteranceId, float pitch, float rate) {
            this.call = call; this.text = text; this.mode = mode; this.id = id;
            this.utteranceId = utteranceId; this.pitch = pitch; this.rate = rate;
        }
    }

    @Override public void load() {
        main.post(() -> {
            if (destroyed) return;
            main.postDelayed(initTimeout, 12000);
            try {
                tts = new TextToSpeech(getContext(), result -> main.post(() -> initialized(result)));
            } catch (RuntimeException error) { initializationFailed("unavailable"); }
        });
    }

    private void initialized(int result) {
        if (!initializing || destroyed) return;
        main.removeCallbacks(initTimeout);
        if (result != TextToSpeech.SUCCESS || tts == null) { initializationFailed("unavailable"); return; }
        try {
            engine = tts.getDefaultEngine();
            Voice best = null;
            Set<Voice> voices = tts.getVoices();
            if (voices != null) for (Voice voice : voices) {
                if (voice == null || voice.isNetworkConnectionRequired()) continue;
                String language = voice.getLocale().getLanguage();
                // Older Android Java Locale versions expose Indonesian as "in".
                if (!"id".equals(language) && !"in".equals(language)) continue;
                if (best == null || voiceScore(voice) > voiceScore(best)) best = voice;
            }
            if (best == null || tts.setVoice(best) != TextToSpeech.SUCCESS) { initializationFailed("missingData"); return; }
            tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                @Override public void onStart(String id) { main.post(() -> started(id)); }
                @Override public void onDone(String id) { main.post(() -> completed(id)); }
                @Override public void onError(String id) { onError(id, TextToSpeech.ERROR); }
                @Override public void onError(String id, int code) { main.post(() -> failed(id, "TTS_ERROR", code)); }
                @Override public void onStop(String id, boolean interrupted) { main.post(() -> failed(id, "CANCELLED", 0)); }
            });
            initializing = false; ready = true; reason = "ready";
            if (active != null) submit(active);
        } catch (RuntimeException error) { initializationFailed("unavailable"); }
    }

    private int voiceScore(Voice voice) {
        return ("ID".equals(voice.getLocale().getCountry()) ? 10000 : 0) + voice.getQuality();
    }

    private void initializationFailed(String why) {
        if (!initializing || destroyed) return;
        initializing = false; ready = false; reason = why;
        main.removeCallbacks(initTimeout);
        if (active != null) reject(active, "missingData".equals(why) ? "MISSING_DATA" : "UNAVAILABLE", 0);
    }

    @PluginMethod public void status(PluginCall call) { main.post(() -> {
        JSObject value = new JSObject();
        value.put("configured", ready); value.put("ready", ready); value.put("offline", true);
        value.put("engine", engine); value.put("reason", destroyed ? "unavailable" : reason);
        value.put("state", initializing ? "initializing" : active == null ? reason : active.mode.equals("speak") ? "speaking" : "synthesizing");
        value.put("language", "id-ID"); call.resolve(value);
    }); }

    @PluginMethod public void speak(PluginCall call) { main.post(() -> request(call, "speak")); }
    @PluginMethod public void synthesize(PluginCall call) { main.post(() -> request(call, "synthesize")); }

    private void request(PluginCall call, String mode) {
        String text = call.getString("text", "").trim();
        if (text.isEmpty() || text.length() > Math.min(MAX_TEXT, TextToSpeech.getMaxSpeechInputLength())) {
            call.reject("Teks suara harus berisi 1-2000 karakter.", "INVALID_TEXT"); return;
        }
        if (destroyed || (!initializing && !ready)) {
            call.reject("Suara Indonesia offline belum tersedia. Periksa mesin TTS dan data bahasa Indonesia.",
                "missingData".equals(reason) ? "MISSING_DATA" : "UNAVAILABLE"); return;
        }
        cancelActive();
        String utterance = "humanale-" + (++sequence);
        String id = call.getString("id", utterance);
        if (id.length() > 64 || !id.matches("[A-Za-z0-9_.:-]+")) id = utterance;
        boolean robotic = !"natural".equals(call.getString("style", "robotic"));
        float pitch = bounded(call.getDouble("pitch"), robotic ? 0.76f : 1f, 0.5f, 1.5f);
        float rate = bounded(call.getDouble("rate"), robotic ? 0.94f : 1f, 0.5f, 1.5f);
        Request request = new Request(call, text, mode, id, utterance, pitch, rate);
        active = request;
        request.timeout = () -> { if (active == request) { reject(request, "TIMEOUT", 0); if (tts != null) tts.stop(); } };
        main.postDelayed(request.timeout, Math.min(240000, 15000 + text.length() * 110L));
        if (ready) submit(request);
    }

    private float bounded(Double value, float fallback, float low, float high) {
        return value == null || Double.isNaN(value) || Double.isInfinite(value) ? fallback : (float)Math.max(low, Math.min(high, value));
    }

    private void submit(Request request) {
        if (active != request || !ready || destroyed) return;
        try {
            if (tts.setPitch(request.pitch) != TextToSpeech.SUCCESS || tts.setSpeechRate(request.rate) != TextToSpeech.SUCCESS) {
                reject(request, "TTS_ERROR", 0); return;
            }
            int result;
            if ("synthesize".equals(request.mode)) {
                request.file = File.createTempFile("humanale-voice-", ".wav", getContext().getCacheDir());
                result = tts.synthesizeToFile(request.text, new Bundle(), request.file, request.utteranceId);
            } else result = tts.speak(request.text, TextToSpeech.QUEUE_FLUSH, new Bundle(), request.utteranceId);
            if (result != TextToSpeech.SUCCESS) reject(request, "TTS_ERROR", result);
        } catch (IOException | RuntimeException error) { reject(request, "TTS_ERROR", 0); }
    }

    private void started(String id) {
        if (active != null && active.utteranceId.equals(id)) event(active, "started", null, 0);
    }

    private void completed(String id) {
        Request request = active;
        if (request == null || !request.utteranceId.equals(id) || destroyed) return;
        if ("speak".equals(request.mode)) {
            JSObject value = result(request); value.put("ok", true); finish(request, value); return;
        }
        files.execute(() -> {
            try {
                byte[] wav = readWav(request.file);
                String audio = Base64.encodeToString(wav, Base64.NO_WRAP);
                main.post(() -> {
                    if (active != request || destroyed) { cleanup(request); return; }
                    JSObject value = result(request); value.put("audio", audio); value.put("mime", "audio/wav");
                    value.put("ok", true); finish(request, value);
                });
            } catch (IOException | RuntimeException error) { main.post(() -> { if (active == request) reject(request, "INVALID_AUDIO", 0); }); }
        });
    }

    private byte[] readWav(File file) throws IOException {
        if (file == null || file.length() <= 44 || file.length() > MAX_WAV) throw new IOException("Invalid WAV size");
        try (FileInputStream input = new FileInputStream(file); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] chunk = new byte[8192]; int count;
            while ((count = input.read(chunk)) != -1) {
                if (output.size() + count > MAX_WAV) throw new IOException("WAV too large");
                output.write(chunk, 0, count);
            }
            byte[] data = output.toByteArray();
            if (data.length <= 44 || data[0] != 'R' || data[1] != 'I' || data[2] != 'F' || data[3] != 'F' ||
                data[8] != 'W' || data[9] != 'A' || data[10] != 'V' || data[11] != 'E') throw new IOException("Invalid WAV format");
            return data;
        }
    }

    private JSObject result(Request request) {
        JSObject value = new JSObject(); value.put("id", request.id); value.put("engine", engine); value.put("offline", true); return value;
    }

    private void finish(Request request, JSObject value) {
        if (active != request || destroyed) return;
        active = null; main.removeCallbacks(request.timeout); cleanup(request);
        event(request, "done", null, 0); request.call.resolve(value);
    }

    private void failed(String id, String code, int nativeCode) {
        if (active == null || !active.utteranceId.equals(id)) return;
        if ("TTS_ERROR".equals(code) && nativeCode == TextToSpeech.ERROR_NOT_INSTALLED_YET) {
            ready = false; reason = "missingData"; code = "MISSING_DATA";
        }
        reject(active, code, nativeCode);
    }

    private void reject(Request request, String code, int nativeCode) {
        if (active != request) return;
        active = null; main.removeCallbacks(request.timeout); cleanup(request);
        JSObject details = result(request); details.put("mode", request.mode); details.put("nativeCode", nativeCode);
        event(request, "error", code, nativeCode);
        request.call.reject("Suara Indonesia: " + code, code, details);
    }

    private void event(Request request, String state, String code, int nativeCode) {
        JSObject value = result(request); value.put("state", state); value.put("mode", request.mode);
        if (code != null) { value.put("code", code); value.put("nativeCode", nativeCode); }
        notifyListeners("speechState", value);
    }

    private void cleanup(Request request) { if (request.file != null) { request.file.delete(); request.file = null; } }

    private void cancelActive() {
        if (active != null) reject(active, "CANCELLED", 0);
        if (tts != null && ready) tts.stop();
    }

    @PluginMethod public void stop(PluginCall call) { main.post(() -> {
        cancelActive(); JSObject value = new JSObject(); value.put("ok", true); call.resolve(value);
    }); }

    @Override protected void handleOnDestroy() { main.post(() -> {
        cancelActive(); destroyed = true; ready = false; initializing = false; reason = "unavailable";
        main.removeCallbacks(initTimeout); files.shutdownNow();
        if (tts != null) { tts.shutdown(); tts = null; }
    }); }
}
