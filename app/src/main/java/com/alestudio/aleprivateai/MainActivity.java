package com.alestudio.aleprivateai;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.RectF;
import android.os.Bundle;
import android.speech.RecognizerIntent;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends Activity {
    private static final int REQ_AUDIO = 41;
    private static final int REQ_CAMERA = 42;
    private static final int REQ_SPEECH = 43;
    private static final String ENDPOINT =
            "https://kirim-cetak-dokumen.sitihasnah109.chatgpt.site/api/chat";

    private AvatarView avatar;
    private TextView statusView;
    private TextView logView;
    private EditText input;
    private TextToSpeech tts;
    private boolean privacy = false;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(Color.rgb(2, 8, 5));
        getWindow().setNavigationBarColor(Color.rgb(2, 8, 5));
        buildNativeUi();
        initTts();
    }

    private TextView text(String value, float sp, int color) {
        TextView v = new TextView(this);
        v.setText(value);
        v.setTextSize(sp);
        v.setTextColor(color);
        return v;
    }

    private Button button(String label) {
        Button b = new Button(this);
        b.setText(label);
        b.setAllCaps(false);
        b.setTextColor(Color.WHITE);
        b.setBackgroundColor(Color.rgb(14, 57, 31));
        b.setPadding(8, 8, 8, 8);
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(0, dp(50), 1f);
        p.setMargins(dp(4), dp(4), dp(4), dp(4));
        b.setLayoutParams(p);
        return b;
    }

    private void buildNativeUi() {
        int green = Color.rgb(105, 255, 154);
        int pale = Color.rgb(232, 255, 239);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.rgb(3, 9, 6));

        LinearLayout header = new LinearLayout(this);
        header.setOrientation(LinearLayout.VERTICAL);
        header.setPadding(dp(16), dp(14), dp(16), dp(12));
        TextView title = text("ALE • PRIVATE AI HUMAN", 17, green);
        title.setTypeface(null, 1);
        statusView = text("Native Android • Ready", 12, Color.rgb(174, 208, 185));
        header.addView(title);
        header.addView(statusView);
        root.addView(header);

        ScrollView scroll = new ScrollView(this);
        LinearLayout body = new LinearLayout(this);
        body.setOrientation(LinearLayout.VERTICAL);
        body.setPadding(dp(12), dp(4), dp(12), dp(24));
        scroll.addView(body);

        avatar = new AvatarView();
        body.addView(avatar, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, dp(365)));

        LinearLayout buttons = new LinearLayout(this);
        buttons.setOrientation(LinearLayout.HORIZONTAL);
        Button speak = button("🔊 Speak");
        Button mic = button("🎙 Mic");
        Button camera = button("📷 Kamera");
        buttons.addView(speak);
        buttons.addView(mic);
        buttons.addView(camera);
        body.addView(buttons);

        Button privacyButton = new Button(this);
        privacyButton.setText("Privacy Mode: OFF");
        privacyButton.setAllCaps(false);
        privacyButton.setTextColor(Color.WHITE);
        privacyButton.setBackgroundColor(Color.rgb(34, 58, 42));
        body.addView(privacyButton, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, dp(48)));

        TextView hint = text(
                "Avatar ini native Android. Ia tetap bergerak tanpa WebView atau JavaScript. " +
                "Chat memiliki mode lokal jika endpoint AI tidak tersedia.",
                12, Color.rgb(174, 208, 185));
        hint.setPadding(dp(4), dp(12), dp(4), dp(8));
        body.addView(hint);

        input = new EditText(this);
        input.setHint("Ketik pesan ke ALE...");
        input.setHintTextColor(Color.rgb(120, 145, 128));
        input.setTextColor(Color.WHITE);
        input.setSingleLine(false);
        input.setMinLines(2);
        input.setBackgroundColor(Color.rgb(7, 22, 13));
        input.setPadding(dp(12), dp(10), dp(12), dp(10));
        body.addView(input, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT));

        Button send = new Button(this);
        send.setText("Kirim ke ALE");
        send.setAllCaps(false);
        send.setTextColor(Color.rgb(3, 20, 9));
        send.setBackgroundColor(green);
        LinearLayout.LayoutParams sendParams = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, dp(52));
        sendParams.setMargins(0, dp(8), 0, dp(8));
        body.addView(send, sendParams);

        logView = text("ALE ready. Avatar native aktif.", 13, pale);
        logView.setBackgroundColor(Color.rgb(2, 7, 4));
        logView.setPadding(dp(12), dp(12), dp(12), dp(12));
        logView.setMinHeight(dp(120));
        body.addView(logView);

        root.addView(scroll, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f));
        setContentView(root);

        speak.setOnClickListener(v -> speakText(
                "Halo, saya ALE. Avatar native Android saya sekarang bergerak dan berbicara."));

        mic.setOnClickListener(v -> startSpeechInput());

        camera.setOnClickListener(v -> {
            if (privacy) {
                setStatus("Privacy mode aktif");
                return;
            }
            if (checkSelfPermission(Manifest.permission.CAMERA)
                    != PackageManager.PERMISSION_GRANTED) {
                requestPermissions(new String[]{Manifest.permission.CAMERA}, REQ_CAMERA);
            } else {
                openCamera();
            }
        });

        privacyButton.setOnClickListener(v -> {
            privacy = !privacy;
            avatar.setPrivacy(privacy);
            privacyButton.setText("Privacy Mode: " + (privacy ? "ON" : "OFF"));
            setStatus(privacy ? "Privacy mode" : "Ready");
            if (privacy && tts != null) {
                tts.stop();
                avatar.setSpeaking(false);
            }
        });

        send.setOnClickListener(v -> sendMessage());
    }

    private void initTts() {
        tts = new TextToSpeech(this, result -> {
            if (result == TextToSpeech.SUCCESS) {
                tts.setLanguage(new Locale("id", "ID"));
                tts.setSpeechRate(1.0f);
                tts.setPitch(1.0f);
                tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                    @Override public void onStart(String utteranceId) {
                        runOnUiThread(() -> {
                            avatar.setSpeaking(true);
                            setStatus("ALE berbicara");
                        });
                    }
                    @Override public void onDone(String utteranceId) {
                        runOnUiThread(() -> {
                            avatar.setSpeaking(false);
                            setStatus("Ready");
                        });
                    }
                    @Override public void onError(String utteranceId) {
                        runOnUiThread(() -> {
                            avatar.setSpeaking(false);
                            setStatus("TTS error");
                        });
                    }
                });
                setStatus("Native Android • Ready");
            } else {
                setStatus("TTS tidak tersedia");
            }
        });
    }

    private void speakText(String value) {
        if (privacy) {
            setStatus("Privacy mode aktif");
            return;
        }
        if (tts == null) return;
        avatar.setSpeaking(true);
        tts.speak(value, TextToSpeech.QUEUE_FLUSH, null,
                "ale-" + System.currentTimeMillis());
    }

    private void startSpeechInput() {
        if (privacy) {
            setStatus("Privacy mode aktif");
            return;
        }
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO)
                != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, REQ_AUDIO);
            return;
        }
        try {
            Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL,
                    RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            i.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "id-ID");
            i.putExtra(RecognizerIntent.EXTRA_PROMPT, "Bicara ke ALE");
            startActivityForResult(i, REQ_SPEECH);
            setStatus("Mendengarkan...");
        } catch (Exception e) {
            Toast.makeText(this,
                    "Speech recognition tidak tersedia di perangkat ini.",
                    Toast.LENGTH_LONG).show();
            setStatus("Mic tidak tersedia");
        }
    }

    private void openCamera() {
        try {
            Intent i = new Intent("android.media.action.IMAGE_CAPTURE");
            startActivity(i);
            setStatus("Kamera dibuka");
        } catch (Exception e) {
            Toast.makeText(this, "Aplikasi kamera tidak tersedia.",
                    Toast.LENGTH_LONG).show();
        }
    }

    private void sendMessage() {
        String message = input.getText().toString().trim();
        if (message.isEmpty()) return;

        input.setText("");
        logView.setText("Anda: " + message + "\nALE: memproses...");
        avatar.setThinking(true);
        setStatus("Thinking");

        executor.execute(() -> {
            String answer;
            boolean online = false;
            try {
                answer = callEndpoint(message);
                online = answer != null && !answer.trim().isEmpty();
                if (!online) answer = localReply(message);
            } catch (Exception e) {
                answer = localReply(message);
            }
            final String result = answer;
            final boolean usedOnline = online;
            runOnUiThread(() -> {
                avatar.setThinking(false);
                logView.setText("Anda: " + message + "\nALE: " + result);
                setStatus(usedOnline ? "Online response" : "Local mode");
                speakText(result);
            });
        });
    }

    private String callEndpoint(String message) throws Exception {
        HttpURLConnection conn = (HttpURLConnection) new URL(ENDPOINT).openConnection();
        conn.setConnectTimeout(3500);
        conn.setReadTimeout(5000);
        conn.setRequestMethod("POST");
        conn.setRequestProperty("Content-Type", "application/json; charset=UTF-8");
        conn.setDoOutput(true);

        JSONObject request = new JSONObject();
        request.put("message", message);
        byte[] bytes = request.toString().getBytes(StandardCharsets.UTF_8);
        try (OutputStream out = conn.getOutputStream()) {
            out.write(bytes);
        }

        int code = conn.getResponseCode();
        InputStream stream = code >= 200 && code < 300
                ? conn.getInputStream() : conn.getErrorStream();
        if (stream == null) throw new Exception("HTTP " + code);

        StringBuilder body = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(
                new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) body.append(line);
        }
        if (code < 200 || code >= 300) throw new Exception("HTTP " + code);

        JSONObject json = new JSONObject(body.toString());
        String reply = json.optString("reply", "");
        if (reply.isEmpty()) reply = json.optString("message", "");
        if (reply.isEmpty()) reply = json.optString("response", "");
        if (reply.isEmpty()) throw new Exception("Respons kosong");
        return reply;
    }

    private String localReply(String message) {
        String m = message.toLowerCase(Locale.ROOT);
        if (m.contains("halo") || m.contains("hai")) {
            return "Halo. Saya ALE. Mode native Android aktif.";
        }
        if (m.contains("siapa kamu")) {
            return "Saya ALE Private AI Human. Avatar dan suara saya berjalan langsung secara native di Android.";
        }
        if (m.contains("tes") || m.contains("test")) {
            return "Tes berhasil. Avatar native, chat lokal, dan suara Android berfungsi.";
        }
        if (m.contains("bergerak") || m.contains("avatar")) {
            return "Avatar saya seharusnya terus bergerak, berkedip, melihat ke kiri dan kanan, serta menggerakkan mulut saat berbicara.";
        }
        return "Pesan diterima. Mode lokal ALE berfungsi. Endpoint AI online belum memberikan respons.";
    }

    private void setStatus(String value) {
        statusView.setText(value);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_SPEECH && resultCode == RESULT_OK && data != null) {
            ArrayList<String> list =
                    data.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS);
            if (list != null && !list.isEmpty()) {
                input.setText(list.get(0));
                sendMessage();
            } else {
                setStatus("Ready");
            }
        }
    }

    @Override
    public void onRequestPermissionsResult(
            int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        boolean granted = grantResults.length > 0
                && grantResults[0] == PackageManager.PERMISSION_GRANTED;
        if (requestCode == REQ_AUDIO && granted) startSpeechInput();
        if (requestCode == REQ_CAMERA && granted) openCamera();
        if (!granted) setStatus("Izin ditolak");
    }

    @Override
    protected void onDestroy() {
        executor.shutdownNow();
        if (tts != null) {
            tts.stop();
            tts.shutdown();
        }
        super.onDestroy();
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private class AvatarView extends View {
        private final Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint particle = new Paint(Paint.ANTI_ALIAS_FLAG);
        private long start = System.currentTimeMillis();
        private boolean speaking = false;
        private boolean thinking = false;
        private boolean privacyMode = false;

        AvatarView() {
            super(MainActivity.this);
            setBackgroundColor(Color.rgb(5, 17, 10));
            p.setStrokeWidth(dp(3));
            particle.setTextSize(dp(9));
            particle.setTypeface(android.graphics.Typeface.MONOSPACE);
        }

        void setSpeaking(boolean value) {
            speaking = value;
            invalidate();
        }

        void setThinking(boolean value) {
            thinking = value;
            invalidate();
        }

        void setPrivacy(boolean value) {
            privacyMode = value;
            invalidate();
        }

        @Override
        protected void onDraw(Canvas canvas) {
            super.onDraw(canvas);
            float w = getWidth();
            float h = getHeight();
            float cx = w / 2f;
            float cy = h / 2f;
            float t = (System.currentTimeMillis() - start) / 1000f;

            float bob = (float) Math.sin(t * 1.8f) * dp(6);
            float turn = (float) Math.sin(t * 1.05f) * 0.035f;
            float pulse = 1f + (float) Math.sin(t * 2.2f) * 0.012f;

            canvas.save();
            canvas.translate(cx, cy + bob);
            canvas.rotate((float) Math.toDegrees(turn));
            canvas.scale(pulse, pulse);

            float rx = Math.min(w * 0.31f, dp(145));
            float ry = Math.min(h * 0.40f, dp(190));

            p.setStyle(Paint.Style.STROKE);
            p.setStrokeWidth(dp(3));
            p.setColor(privacyMode ? Color.DKGRAY : Color.rgb(105, 255, 154));
            p.setShadowLayer(dp(14), 0, 0, p.getColor());
            setLayerType(View.LAYER_TYPE_SOFTWARE, p);
            canvas.drawOval(new RectF(-rx, -ry, rx, ry), p);
            p.clearShadowLayer();

            if (!privacyMode) {
                particle.setColor(Color.argb(130, 105, 255, 154));
                for (int i = 0; i < 150; i++) {
                    double a = i * 2.399963 + t * 0.28;
                    float r = 14 + (i % 47) * 3.0f;
                    float px = (float) Math.cos(a) * Math.min(rx * .91f, r);
                    float py = (float) Math.sin(a) * Math.min(ry * .91f, r * 1.28f);
                    if ((px * px) / (rx * rx) + (py * py) / (ry * ry) < .92f) {
                        canvas.drawText(((i + (int)(t * 5)) & 1) == 0 ? "1" : "0",
                                px, py, particle);
                    }
                }
            }

            float blinkPhase = t % 3.1f;
            float eyeH = blinkPhase > 2.92f ? dp(1.5f) : dp(13);
            float eyeY = -dp(28);
            float eyeDx = Math.min(rx * .39f, dp(58));

            p.setStyle(Paint.Style.FILL);
            p.setColor(privacyMode ? Color.GRAY : Color.rgb(235, 255, 240));
            canvas.drawOval(new RectF(-eyeDx-dp(34), eyeY-eyeH,
                    -eyeDx+dp(34), eyeY+eyeH), p);
            canvas.drawOval(new RectF(eyeDx-dp(34), eyeY-eyeH,
                    eyeDx+dp(34), eyeY+eyeH), p);

            if (eyeH > dp(3)) {
                float lookX = (float) Math.sin(t * 1.3f) * dp(7);
                float lookY = (float) Math.cos(t * .9f) * dp(3);
                p.setColor(privacyMode ? Color.DKGRAY : Color.rgb(105, 255, 154));
                canvas.drawCircle(-eyeDx + lookX, eyeY + lookY, dp(9), p);
                canvas.drawCircle(eyeDx + lookX, eyeY + lookY, dp(9), p);
                p.setColor(Color.rgb(3, 12, 7));
                canvas.drawCircle(-eyeDx + lookX, eyeY + lookY, dp(3), p);
                canvas.drawCircle(eyeDx + lookX, eyeY + lookY, dp(3), p);
            }

            float mouthBase = speaking
                    ? dp(10) + (float)(Math.abs(Math.sin(t * 10.5f)) * dp(22))
                    : thinking
                    ? dp(8) + (float)(Math.abs(Math.sin(t * 5.5f)) * dp(8))
                    : dp(5) + (float)(Math.abs(Math.sin(t * 1.6f)) * dp(2));

            p.setStyle(Paint.Style.STROKE);
            p.setStrokeWidth(dp(3));
            p.setColor(privacyMode ? Color.DKGRAY : Color.rgb(105, 255, 154));
            canvas.drawOval(new RectF(-dp(42), dp(78)-mouthBase,
                    dp(42), dp(78)+mouthBase), p);

            if (thinking && !privacyMode) {
                p.setStyle(Paint.Style.STROKE);
                p.setStrokeWidth(dp(2));
                p.setColor(Color.argb(170, 105, 255, 154));
                float ring = rx + dp(16) + (float)Math.sin(t * 4) * dp(5);
                canvas.drawCircle(0, 0, ring, p);
            }

            canvas.restore();

            if (privacyMode) {
                p.setStyle(Paint.Style.FILL);
                p.setTextSize(dp(18));
                p.setColor(Color.WHITE);
                p.setTextAlign(Paint.Align.CENTER);
                canvas.drawText("PRIVACY MODE", cx, cy, p);
                p.setTextAlign(Paint.Align.LEFT);
            }

            postInvalidateOnAnimation();
        }
    }
}
