// The WDK protocol packages pin exact older versions of the wallet packages,
// so npm nests duplicate copies. Duplicates break the lending flow: the
// account object (top-level class) fails the Aave package's instanceof check
// against its nested copy, and supply() refuses with "requires a non
// read-only account". One copy of a wallet class is a correctness
// requirement, not an optimization — so installs prune the nested copies and
// Node's resolution walks up to the single top-level install.
import { rmSync, existsSync } from "node:fs";

for (const pkg of [
  "node_modules/@tetherto/wdk-protocol-lending-aave-evm/node_modules",
  "node_modules/@tetherto/wdk-protocol-bridge-usdt0-evm/node_modules",
]) {
  if (existsSync(pkg)) {
    rmSync(pkg, { recursive: true, force: true });
    console.log(`dedupe-wdk: removed ${pkg}`);
  }
}
