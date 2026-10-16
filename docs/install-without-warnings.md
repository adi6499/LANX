# Installing LANX without warnings

Up to five different Windows messages can appear when installing or first opening a new program.
Here is each one, what LANX already fixes, and what you can do about the rest.

| # | Message | Status |
|---|---|---|
| 1 | "Windows Defender Firewall has blocked some features of this app" | **Fixed** — the installer adds the firewall rules |
| 2 | Antivirus says the file is a threat | **Clean** — scanned with Microsoft Defender; now built with Microsoft's own compiler (less prone to false alarms) |
| 3 | "Do you want to allow this app to make changes to your device?" | **Expected, once** — every installer that installs for all users asks this. Without a certificate it says *Publisher: Unknown* |
| 4 | Blue box **"Windows protected your PC"** (SmartScreen) | Appears only for **downloaded, unsigned** files — see below |
| 5 | Browser: "LANX-Setup.exe isn't commonly downloaded" | Same cause and same fixes as #4 |

## Why the blue "Windows protected your PC" box appears
When a file arrives from the internet (browser download, Outlook/Gmail attachment, WhatsApp or
Telegram desktop, or a zip that came from any of these), Windows tags it with a hidden
*"came from the internet"* mark. When you open a tagged program, Microsoft SmartScreen checks
whether it is **code-signed by a known publisher** with a good download history. A brand-new,
unsigned program fails that check, so Windows shows the blue box. **No change inside the app can
remove it** — only how the file is delivered or signed.

## Updating through LANX itself (LANX 1.2 and newer, recommended)
Files that LANX receives from a colleague carry **no** "came from the internet" mark, so the blue
box never appears for them.
1. Install the new version on your own PC straight from `release\LANX-Setup-<version>.exe` (its
   `.sig` file must be in the same folder; `npm run release` makes both). Your LANX then shares it by
   itself. (Or: **Settings → Updates → Choose installer…** on any PC that has both files.)
2. Colleagues on LANX 1.2 or newer get it in the background and see
   **"LANX x.y.z is ready to install — Update LANX now"** at the top of LANX. One click: Windows asks
   *"Do you want to allow this app to make changes?"* → **Yes**. LANX closes, updates and opens again
   with all chats. If they press **Remind me tomorrow**, it comes back the next day, every day.
3. Colleagues still on **1.1 or older** can't show that button yet: LANX sends them the installer
   once as an ordinary chat file; they open it from the chat and click Yes (no blue box either,
   because it came through LANX).
4. Each PC that has updated passes the update on by itself, so it reaches everyone even if your PC
   is off. **Peers** and **Settings → Updates** show who is still behind.

LANX only accepts an update that carries the **LANX release signature** made by `npm run release`
with the key in `signing\lanx-release-key.pem`. Keep a backup of that file (USB drive or password
manager) and never share it: without it, the next version must be installed by hand once.

## Free ways to install with no warning (office use)
1. **Copy it, don't download it.** Put `LANX-Setup-1.2.0.exe` on a USB pen drive, or in a shared
   folder opened by computer *name* (`\\ACCOUNTS-PC\Share`, not `\\192.168.1.5\Share`). Copy it to
   the Desktop, then double-click. Copied files carry no internet mark → no blue box.
2. **Already downloaded it?** Right-click the file → **Properties** → tick **Unblock** at the bottom
   → **OK**. Then double-click: no blue box.
3. If the blue box still shows: click **More info → Run anyway**. It is safe for your own build; this
   only tells Windows you trust it.

## Paid ways (for sending the installer by email/WhatsApp/website)
1. **Code-signing certificate (recommended).** An *OV* or *EV* certificate in your company's name
   from a certificate authority (e.g. Sectigo, DigiCert, GlobalSign, Certum; Indian resellers sell
   them too — prices change, typically a few hundred US dollars a year). Since 2023 the certificate
   comes on a USB token or in a cloud vault. Effects:
   - UAC and Windows show **"Verified publisher: <your company>"** instead of *Unknown*.
   - SmartScreen still learns a new certificate's reputation from real installs, so for the first
     few weeks some PCs may still see the blue box; after that it disappears for everyone.
2. **Microsoft Store.** Microsoft signs the app and Store installs never warn. Needs a developer
   account and a Store listing (can be hidden, link-only).
3. **Company device management** (Intune / Group Policy with Microsoft 365 Business): IT can push
   LANX to all PCs silently.

## Turning on signing once you have a certificate
Everything else is ready (the Windows SDK `signtool` is installed on this PC). With a USB-token
certificate, plug the token in, then add to `src-tauri/tauri.conf.json` under `bundle.windows`:

```json
"certificateThumbprint": "<thumbprint from certmgr.msc>",
"digestAlgorithm": "sha256",
"timestampUrl": "http://timestamp.digicert.com"
```

For a cloud-HSM certificate, use `"signCommand"` with the provider's tool instead. Then run
`npm run release` — both `lanx.exe` and the installer are signed automatically.
