// Release signing for the one-click installer.
//   node ops/sign-manifest.js keygen            -> creates the Ed25519 signing key (once) and prints the public key
//   node ops/sign-manifest.js pubkey            -> prints the public key (base64 DER) baked into the desktop app
//   node ops/sign-manifest.js sign <manifest>   -> writes <manifest>.sig (base64 Ed25519 signature of the exact bytes)
// The private key never leaves the publisher's PC: %USERPROFILE%\.yukti\release-signing-key.pem (override: YUKTI_SIGNING_KEY).
// The desktop app refuses a manifest whose signature does not verify, so a tampered website cannot push a modified server.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const KEY = process.env.YUKTI_SIGNING_KEY || path.join(os.homedir(), '.yukti', 'release-signing-key.pem');

function privateKey() {
  if (!fs.existsSync(KEY)) throw new Error(`Signing key not found: ${KEY}  (run: node ops/sign-manifest.js keygen)`);
  return crypto.createPrivateKey(fs.readFileSync(KEY));
}
const publicB64 = (priv) => crypto.createPublicKey(priv).export({ type: 'spki', format: 'der' }).toString('base64');

const [cmd, file] = process.argv.slice(2);
if (cmd === 'keygen') {
  if (!fs.existsSync(KEY)) {
    const { privateKey: k } = crypto.generateKeyPairSync('ed25519');
    fs.mkdirSync(path.dirname(KEY), { recursive: true });
    fs.writeFileSync(KEY, k.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
    console.error(`created ${KEY} - back it up offline; losing it means existing installs cannot verify new releases`);
  }
  console.log(publicB64(privateKey()));
} else if (cmd === 'pubkey') {
  console.log(publicB64(privateKey()));
} else if (cmd === 'sign' && file) {
  const sig = crypto.sign(null, fs.readFileSync(file), privateKey()).toString('base64');
  fs.writeFileSync(file + '.sig', sig + '\n');
  console.log(`signed ${file}`);
} else {
  console.error('usage: node ops/sign-manifest.js keygen | pubkey | sign <manifest.json>');
  process.exit(2);
}
