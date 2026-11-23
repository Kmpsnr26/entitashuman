package __APP_PACKAGE__;

import android.content.Intent;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.net.URI;

/** Opens an unprivileged viewer. Remote runtime pages never receive a Capacitor bridge. */
@CapacitorPlugin(name = "HumanALERuntime")
public class HumanALERuntimePlugin extends Plugin {
    @PluginMethod public void open(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            String caller = getBridge().getWebView().getUrl();
            if (!RuntimeUrlPolicy.isLocalApp(caller)) {
                call.reject("Runtime hanya dapat dibuka dari aplikasi lokal.", "UNTRUSTED_CALLER"); return;
            }
            final URI uri;
            final String authOrigin;
            try {
                uri = RuntimeUrlPolicy.parse(call.getString("url", ""));
                String auth = call.getString("authOrigin", "");
                authOrigin = auth.isEmpty() ? "" : RuntimeUrlPolicy.origin(RuntimeUrlPolicy.parse(auth));
            }
            catch (IllegalArgumentException error) { call.reject(error.getMessage(), "INVALID_URL"); return; }
            try {
                Intent intent = new Intent(getActivity(), RuntimeActivity.class);
                intent.putExtra(RuntimeActivity.EXTRA_URL, uri.toASCIIString());
                intent.putExtra(RuntimeActivity.EXTRA_AUTH_ORIGIN, authOrigin);
                getActivity().startActivity(intent);
                JSObject result = new JSObject();
                result.put("opened", true); result.put("url", uri.toASCIIString());
                result.put("origin", RuntimeUrlPolicy.origin(uri));
                result.put("authOrigin", authOrigin);
                // Opening a viewer does not imply a connected server or authenticated owner.
                call.resolve(result);
            } catch (RuntimeException error) {
                call.reject("Penampil runtime tidak dapat dibuka.", "OPEN_FAILED");
            }
        });
    }
}
