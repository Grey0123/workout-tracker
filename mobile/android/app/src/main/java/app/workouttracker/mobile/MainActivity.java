package app.workouttracker.mobile;

import android.webkit.CookieManager;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    /**
     * The WebView writes cookies to disk only now and then, so an app closed soon
     * after logging in could forget the login. Save them whenever the app leaves the
     * screen (PRD M6: login persists).
     */
    @Override
    public void onPause() {
        super.onPause();
        CookieManager.getInstance().flush();
    }
}
