// The LANX release key (Ed25519). `npm run release` signs every installer
// with it, and LANX 1.2+ only installs an update shared over the network if
// it carries this signature ("Share LANX update"). The public half is built
// into the app (src-tauri/release-key.pub); the private half stays on this
// PC in signing/ (never committed). Keep a backup copy of
// signing/lanx-release-key.pem on a USB drive or in a password manager: with
// a new key, colleagues have to install the next version by hand once.
//
//   node scripts/release-key.mjs                    make sure the key exists (npm run release does this)
//   node scripts/release-key.mjs --new              replace a lost key with a new one
//   node scripts/release-key.mjs sign <setup.exe> <version>   write <setup.exe>.sig
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const keyPath = process.env.LANX_RELEASE_KEY || join(root, "signing", "lanx-release-key.pem");
const pubPath = join(root, "src-tauri", "release-key.pub");

/** Exactly the bytes LANX verifies (src-tauri/src/networking/update.rs). */
export function releaseMessage(version, sha256, size) {
  return Buffer.from(`LANX-RELEASE-V1\n${version}\n${sha256}\n${size}`, "utf8");
}

function publicHex(key) {
  const jwk = createPublicKey(key).export({ format: "jwk" });
  return Buffer.from(jwk.x, "base64url").toString("hex");
}

function readPub() {
  return existsSync(pubPath) ? readFileSync(pubPath, "utf8").trim() : "";
}

function writePub(hex) {
  writeFileSync(pubPath, `${hex}\n`);
}

/** Makes sure the private key exists and the app embeds its public key. */
export function ensureKey({ replace = false } = {}) {
  if (existsSync(keyPath) && !replace) {
    const key = createPrivateKey(readFileSync(keyPath, "utf8"));
    const hex = publicHex(key);
    if (readPub() !== hex) {
      writePub(hex);
      console.log(`Release key: wrote its public half to ${pubPath}`);
    }
    return key;
  }
  if (readPub() && !replace) {
    console.error(
      `\nThe LANX release key is missing: ${keyPath}\n` +
        `Copy your backup of lanx-release-key.pem back there and run the release again.\n` +
        `If the key is lost for good, run "node scripts/release-key.mjs --new" — colleagues on\n` +
        `LANX 1.2 or newer then need to install the next version by hand once.\n`
    );
    process.exit(1);
  }
  if (existsSync(keyPath)) {
    // --new never destroys a key: the old one is kept next to it.
    const kept = `${keyPath}.replaced-${new Date().toISOString().slice(0, 10)}`;
    renameSync(keyPath, kept);
    console.log(`The previous key was kept as ${kept}`);
  }
  const { privateKey } = generateKeyPairSync("ed25519");
  mkdirSync(dirname(keyPath), { recursive: true });
  writeFileSync(keyPath, privateKey.export({ format: "pem", type: "pkcs8" }), { mode: 0o600 });
  writePub(publicHex(privateKey));
  console.log(
    `\nCreated the LANX release key: ${keyPath}\n` +
      `>>> Back this file up (USB drive or password manager). Never share it or put it on GitHub. <<<\n`
  );
  return privateKey;
}

/** Writes `<installer>.sig` next to the installer. */
export function signInstaller(installer, version) {
  const key = ensureKey();
  const data = readFileSync(installer);
  const sha256 = createHash("sha256").update(data).digest("hex");
  const signature = sign(null, releaseMessage(version, sha256, data.length), key).toString("hex");
  const sig = { format: "lanx-release-1", version, sha256, size: data.length, signature };
  writeFileSync(`${installer}.sig`, `${JSON.stringify(sig, null, 2)}\n`);
  return sig;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, file, version] = process.argv.slice(2);
  if (cmd === "sign") {
    if (!file || !version) {
      console.error("Usage: node scripts/release-key.mjs sign <installer.exe> <version>");
      process.exit(1);
    }
    signInstaller(file, version);
    console.log(`Signed: ${file}.sig`);
  } else {
    ensureKey({ replace: cmd === "--new" });
    console.log(`Release key OK (${keyPath})`);
  }
}
