package com.haclabs.capahead;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    registerPlugin(CapAheadBillingPlugin.class);
    super.onCreate(savedInstanceState);
  }
}
