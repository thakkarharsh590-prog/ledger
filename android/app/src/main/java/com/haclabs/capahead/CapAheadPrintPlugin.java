package com.haclabs.capahead;

import android.content.Context;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "CapAheadPrint")
public class CapAheadPrintPlugin extends Plugin {
  @PluginMethod
  public void printHtml(PluginCall call) {
    String html = call.getString("html");
    String title = call.getString("title", "CapAhead Monthly Review");
    if (html == null || html.trim().isEmpty()) {
      call.reject("Nothing to print.");
      return;
    }

    getActivity().runOnUiThread(() -> {
      try {
        WebView webView = new WebView(getContext());
        webView.getSettings().setJavaScriptEnabled(false);
        webView.setWebViewClient(new WebViewClient() {
          @Override
          public void onPageFinished(WebView view, String url) {
            PrintManager printManager = (PrintManager) getContext().getSystemService(Context.PRINT_SERVICE);
            if (printManager == null) {
              call.reject("Android print service is not available.");
              return;
            }
            PrintDocumentAdapter adapter = view.createPrintDocumentAdapter(title);
            PrintAttributes attributes = new PrintAttributes.Builder()
              .setMediaSize(PrintAttributes.MediaSize.ISO_A4)
              .setColorMode(PrintAttributes.COLOR_MODE_COLOR)
              .build();
            printManager.print(title, adapter, attributes);
            JSObject result = new JSObject();
            result.put("started", true);
            call.resolve(result);
          }
        });
        webView.loadDataWithBaseURL("https://capahead.local/", html, "text/html", "UTF-8", null);
      } catch (Exception err) {
        call.reject("Could not start Android print flow.", err);
      }
    });
  }
}
