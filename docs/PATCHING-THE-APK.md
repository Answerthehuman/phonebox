# Patching the existing APK (no Gradle, no Android SDK)

The phone panel is a web page (`android/app/src/main/assets/www`) inside the app. To change how it looks you do not
have to rebuild the app: copy the released APK, swap its `assets/www` folder, align and sign it.

1. Put the released `PhoneBox-<version>.apk` in the repository root.
2. Get Google's Android **build-tools** (zipalign + apksigner) and a JDK 17+.
3. Make a signing key once (keep it OUT of the repository, `*.jks` is ignored):
   `keytool -genkeypair -keystore phonebox-local.jks -alias phonebox -keyalg RSA -keysize 2048 -validity 10000`
4. Build:

```sh
python tools/patch-apk.py PhoneBox-0.9.19.apk android/app/src/main/assets/www unaligned.apk
zipalign -p -f 4 unaligned.apk aligned.apk
apksigner sign --ks phonebox-local.jks --out PhoneBox-0.9.19-apple.apk aligned.apk
apksigner verify PhoneBox-0.9.19-apple.apk
```

5. Install over USB: `adb install -r PhoneBox-0.9.19-apple.apk`.
   The first time, uninstall the original first (different signing key); later installs with the same key keep the pairing.

Check every panel file before building, in module mode (a plain `node --check file.js` can miss a broken module):
`node --input-type=module --check < android/app/src/main/assets/www/main.js`

To see the panel with your computer's live data in a desktop browser: `python tools/live-panel.py`, then open
<http://127.0.0.1:8791/panel/>.
