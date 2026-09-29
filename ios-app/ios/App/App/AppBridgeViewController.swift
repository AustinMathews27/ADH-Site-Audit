import UIKit
import WebKit
import Capacitor

/// Capacitor's bridge view controller with one extra job: deciding when the
/// native launch screen (the SplashScreen plugin) must come down on its own.
///
/// The web page hides the splash itself once it is signed in and rendered
/// (`_hideNativeSplash()` in index.html). A sign-in that needs the user —
/// first run, password change, MFA — never gets that far: the WebView sits
/// on a Microsoft login page underneath the splash. So whenever the WebView
/// *settles* (finished loading, no new navigation for `idleSeconds`) on any
/// page that is not our own site, the splash is hidden. Silent single-sign-on
/// passes through the same Microsoft hosts but auto-submits within a few
/// hundred milliseconds, so it never settles and stays covered.
///
/// `plugins.SplashScreen.launchShowDuration` in capacitor.config.json is only
/// the last-resort cap behind this.
class AppBridgeViewController: CAPBridgeViewController {
    private let idleSeconds: TimeInterval = 1.5
    private var urlObservation: NSKeyValueObservation?
    private var loadingObservation: NSKeyValueObservation?
    private var idleTimer: Timer?

    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        guard let webView = webView else { return }
        urlObservation = webView.observe(\.url, options: [.new]) { [weak self] _, _ in
            self?.webViewChanged()
        }
        loadingObservation = webView.observe(\.isLoading, options: [.new]) { [weak self] _, _ in
            self?.webViewChanged()
        }
    }

    private func webViewChanged() {
        idleTimer?.invalidate()
        idleTimer = nil
        guard let webView = webView, !webView.isLoading else { return }

        let appHost = bridge?.config.serverURL.host?.lowercased() ?? ""
        let host = webView.url?.host?.lowercased() ?? ""
        // Our own site hides the splash from JavaScript; everything else
        // (Microsoft sign-in, an error page, about:blank) is on us.
        if !host.isEmpty && host == appHost { return }

        idleTimer = Timer.scheduledTimer(withTimeInterval: idleSeconds, repeats: false) { [weak self] _ in
            self?.hideSplash()
        }
    }

    private func hideSplash() {
        guard let plugin = bridge?.plugin(withName: "SplashScreen") else { return }
        let call = CAPPluginCall(callbackId: "app-webview-settled",
                                 methodName: "hide",
                                 options: ["fadeOutDuration": 200],
                                 success: { _, _ in },
                                 error: { _ in })
        // `hide:` is the plugin's @objc method; calling it through the
        // runtime avoids importing the plugin module from app code.
        let selector = NSSelectorFromString("hide:")
        if plugin.responds(to: selector) {
            plugin.perform(selector, with: call)
        }
    }
}
