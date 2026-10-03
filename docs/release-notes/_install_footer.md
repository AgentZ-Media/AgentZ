## Installation (first time only)

### macOS (Apple Silicon)

1. Download the `.dmg` below and open it.
2. Drag **{{PRODUCT_NAME}}.app** into your **Applications** folder.
3. The app is **not signed** (no Apple Developer account), so macOS
   refuses to launch it. Run this command in Terminal once to remove
   the quarantine flag:

   ```bash
   xattr -cr "/Applications/{{PRODUCT_NAME}}.app"
   ```

4. Open {{PRODUCT_NAME}} from the Applications folder - it now launches
   normally.

Without step 3, you'll see the message "{{PRODUCT_NAME}} is damaged and can't
be opened" or "can't be opened because the developer cannot be
verified". That's macOS Gatekeeper, not the app.

### Windows (x64)

1. Download the `.exe` installer below and run it.
2. On first launch, **Windows SmartScreen** kicks in: "Windows
   protected your PC". The app is **not signed** (no EV code-signing
   certificate), so SmartScreen doesn't know it yet.
3. Click **"More info"**, then the button that appears: **"Run
   anyway"**.
4. From there on, {{PRODUCT_NAME}} runs normally. Auto-updates work without
   any further friction.

Without step 3, SmartScreen aborts the launch. That's Windows
protection, not the app.
