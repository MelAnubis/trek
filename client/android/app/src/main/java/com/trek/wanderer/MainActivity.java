package com.trek.wanderer;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(BackgroundLocationHelperPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
