package com.dilarion.app.ui.screens.devices

import com.journeyapps.barcodescanner.CaptureActivity

/**
 * ZXing's default capture screen opens in landscape. This subclass is declared
 * with android:screenOrientation="portrait" in the manifest so the QR scanner
 * fills the screen in portrait, like other messengers' link-device scanners.
 */
class PortraitCaptureActivity : CaptureActivity()
