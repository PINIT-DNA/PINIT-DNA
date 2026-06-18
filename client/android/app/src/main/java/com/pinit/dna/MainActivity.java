package com.pinit.dna;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Bundle;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.BridgeActivity;

import java.util.ArrayList;
import java.util.List;

/**
 * PINIT — main WebView host.
 *
 * Requests the camera + microphone runtime permissions on launch so the HOID
 * registration flow's getUserMedia() calls (face capture, liveness, voiceprint)
 * are granted inside the WebView. If the user denies, the web flow degrades
 * gracefully to a simulated capture.
 */
public class MainActivity extends BridgeActivity {

    private static final int PERMISSION_REQUEST_CODE = 4201;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestMediaPermissions();
    }

    private void requestMediaPermissions() {
        String[] needed = { Manifest.permission.CAMERA, Manifest.permission.RECORD_AUDIO };
        List<String> toRequest = new ArrayList<>();
        for (String perm : needed) {
            if (ContextCompat.checkSelfPermission(this, perm) != PackageManager.PERMISSION_GRANTED) {
                toRequest.add(perm);
            }
        }
        if (!toRequest.isEmpty()) {
            ActivityCompat.requestPermissions(this, toRequest.toArray(new String[0]), PERMISSION_REQUEST_CODE);
        }
    }
}
