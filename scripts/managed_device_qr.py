"""Print Android setup QR payload for a hosted, signed Dilarion APK.

Usage: python3 scripts/managed_device_qr.py app-production-release.apk https://example.com/app.apk
The URL must serve the exact APK supplied here over HTTPS.
"""

import argparse
import base64
import hashlib
import json
from pathlib import Path
from urllib.parse import urlparse


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("apk", type=Path)
    parser.add_argument("download_url")
    parser.add_argument("--png", type=Path, help="write a scannable QR image (requires qrcode[pil])")
    args = parser.parse_args()
    if urlparse(args.download_url).scheme != "https":
        parser.error("download_url must use HTTPS")
    digest = hashlib.sha256(args.apk.read_bytes()).digest()
    checksum = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
    payload = json.dumps({
        "android.app.extra.PROVISIONING_DEVICE_ADMIN_COMPONENT_NAME":
            "com.dilarion.app/.device.DilarionDeviceAdminReceiver",
        "android.app.extra.PROVISIONING_DEVICE_ADMIN_PACKAGE_DOWNLOAD_LOCATION":
            args.download_url,
        "android.app.extra.PROVISIONING_DEVICE_ADMIN_PACKAGE_CHECKSUM": checksum,
    }, separators=(",", ":"))
    print(payload)
    if args.png:
        try:
            import qrcode
        except ImportError:
            parser.error("--png requires: python3 -m pip install 'qrcode[pil]'")
        qrcode.make(payload).save(args.png)


if __name__ == "__main__":
    main()
