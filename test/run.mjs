/** Runs every suite. `node test/run.mjs` */
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const HERE = dirname(fileURLToPath(import.meta.url));
const suites = ["logic.test.mjs", "panel.test.mjs"];

let failed = 0;
for (const suite of suites) {
  const result = spawnSync(process.execPath, [resolve(HERE, suite)], { stdio: "inherit" });
  if (result.status !== 0) failed += 1;
}

console.log(failed ? `\n${failed} suite(s) failed\n` : "\nEverything passed\n");
process.exit(failed ? 1 : 0);
