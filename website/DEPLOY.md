# Putting the LANX website on Vercel

This `website` folder inside the LANX repository **is** the website. There is nothing to build:
Vercel just serves these files.

```
index.html        the page
style.css         its look
site.js           small helpers (light/dark, fills in the version)
version.json      which version is on offer (the page reads this)
vercel.json       the /download link and a few headers
files/            the installer, its .sig and its checksum
img/              icon and screenshots
update-website.mjs   one command to put a new version on the site
```

---

## First time: connect Vercel to GitHub (about 3 minutes)

The website is on GitHub at https://github.com/adi6499/LANX, in the `website` folder.

1. Go to https://vercel.com and sign in (GitHub is easiest).
2. **Add New… → Project**.
3. Find **LANX** in the list and press **Import** (if GitHub is not connected yet, Vercel asks you to
   connect it and to allow access to the LANX repository).
4. **Change nothing** on the import screen and press **Deploy**. The `vercel.json` at the top of the
   repository already tells Vercel to serve the `website` folder with no build step.
   - If Vercel offers to "configure this repository as a project with multiple services" or shows a
     suggested `vercel.json` with `services`, **skip / dismiss it**. That suggestion comes from Vercel
     looking at the LANX app code; LANX is a Windows program, not a web service, and the website
     needs none of that.
   - (Setting **Root Directory** to `website` also works; it is simply not needed.)
5. After a minute Vercel shows the address, something like
   `https://lanx-xxxx.vercel.app`. That's the site; the download link is `<that address>/download`.

To get a nicer address: in the Vercel project → **Settings → Domains**, add `lanx.vercel.app` (if free)
or a name you own, e.g. `lanx.yourcompany.com` (Vercel shows which DNS record to add).

From then on, **every push to the `main` branch on GitHub publishes the site by itself**.

---

## Each new LANX version (about 1 minute)

After `npm run release` has made `release\LANX-Setup-x.y.z.exe`, in the LANAPPLICATION folder:

```
node website/update-website.mjs
git add website vercel.json
git commit -m "Website: LANX x.y.z"
git push origin main
```

The first command copies the newest installer into `website\files` (with its `.sig` and checksum),
removes the old one, and updates the version, size, date and checksum shown on the page (in both
`vercel.json` files: the one in `website` and the one at the top of the repository). The push
makes Vercel publish it. Only what is on the **main** branch reaches Vercel, so if you work on another
branch, the website commit must be put on main too (easiest: ask Claude "put LANX x.y.z on the website").

To use an installer that is somewhere else:

```
node website/update-website.mjs "D:\somewhere\LANX-Setup-2.5.0.exe"
```

---

## Useful links once it's live

| Link | What it gives |
|---|---|
| `https://<site>/` | the page |
| `https://<site>/download` | always the current installer (good for WhatsApp / email) |
| `https://<site>/version.json` | version, size, date and checksum as data |

## Things to know

- **Windows SmartScreen.** Installers downloaded from the internet show the blue "Windows protected your PC"
  box the first time. The page explains the *More info → Run anyway* step. Only a paid code-signing
  certificate removes the box (see `docs\install-without-warnings.md`).
- **Never put the private signing key here.** `signing\lanx-release-key.pem` is ignored by Git and must
  stay out of the repository. The `.sig` files are safe to publish.
- The page has no analytics, cookies or outside scripts.
- You can also publish from this PC without GitHub: `vercel login`, then `vercel --prod` inside the
  `website` folder (the Vercel command-line tool is installed).
