package __APP_PACKAGE__;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.Locale;

/** Pure Java policy shared by the local plugin and the unprivileged runtime WebView. */
public final class RuntimeUrlPolicy {
    private RuntimeUrlPolicy() {}

    public static URI parse(String value) {
        if (value == null || value.isEmpty() || value.length() > 4096 || value.matches(".*[\\\\\\s\\p{Cntrl}].*"))
            throw new IllegalArgumentException("Alamat runtime tidak valid.");
        try {
            URI uri = new URI(value);
            String scheme = uri.getScheme(), host = uri.getHost();
            if (scheme == null || host == null || uri.getRawUserInfo() != null || uri.isOpaque())
                throw new IllegalArgumentException("Gunakan alamat HTTPS atau HTTP loopback tanpa user/password.");
            scheme = scheme.toLowerCase(Locale.ROOT);
            host = host.toLowerCase(Locale.ROOT);
            int port = uri.getPort();
            if (port == 0 || port < -1 || port > 65535 || uri.getRawAuthority().endsWith(":"))
                throw new IllegalArgumentException("Port runtime tidak valid.");
            if (!"https".equals(scheme) && !("http".equals(scheme) && isLoopback(host)))
                throw new IllegalArgumentException("Server online wajib HTTPS; HTTP hanya untuk localhost.");
            return uri;
        } catch (URISyntaxException error) {
            throw new IllegalArgumentException("Alamat runtime tidak valid.");
        }
    }

    public static boolean isLoopback(String host) {
        return "localhost".equalsIgnoreCase(host) || "127.0.0.1".equals(host) || "[::1]".equals(host) || "::1".equals(host);
    }

    public static String origin(URI uri) {
        String scheme = uri.getScheme().toLowerCase(Locale.ROOT);
        int port = uri.getPort();
        boolean standard = port == -1 || ("https".equals(scheme) ? port == 443 : port == 80);
        return scheme + "://" + uri.getHost().toLowerCase(Locale.ROOT) + (standard ? "" : ":" + port);
    }

    public static boolean sameOrigin(URI target, String candidate) {
        try { return origin(target).equals(origin(parse(candidate))); }
        catch (IllegalArgumentException error) { return false; }
    }

    public static boolean isLocalApp(String candidate) {
        try { return "https://localhost".equals(origin(parse(candidate))); }
        catch (IllegalArgumentException error) { return false; }
    }
}
