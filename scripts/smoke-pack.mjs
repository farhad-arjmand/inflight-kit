import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const npm = (args, options = {}) =>
  execFileSync(process.execPath, [process.env.npm_execpath, ...args], options);
const root = process.cwd();
const packed = JSON.parse(npm(["pack", "--json"], { encoding: "utf8" }))[0];
const paths = packed.files.map((file) => file.path);
for (const path of paths)
  if (
    !["package.json", "README.md", "LICENSE"].includes(path) &&
    !path.startsWith("dist/") &&
    !path.startsWith("docs/") &&
    !path.startsWith("examples/") &&
    !["llms.txt", "CHANGELOG.md", "CONTRIBUTING.md", "SECURITY.md"].includes(
      path,
    )
  )
    throw new Error(`Unexpected published file: ${path}`);
const temporary = mkdtempSync(join(tmpdir(), "inflight-kit-consumer-"));
try {
  writeFileSync(
    join(temporary, "package.json"),
    JSON.stringify({ name: "consumer-smoke", private: true, type: "module" }),
  );
  npm(
    [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      resolve(packed.filename),
    ],
    { cwd: temporary, stdio: "pipe" },
  );
  execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      "import assert from 'node:assert/strict'; import {createFlight} from 'inflight-kit'; assert.equal(await createFlight(x=>x*2).run(21),42);",
    ],
    { cwd: temporary, stdio: "inherit" },
  );
  execFileSync(
    process.execPath,
    [
      "-e",
      "const {createFlight}=require('inflight-kit'); createFlight(x=>x*2).run(21).then(x=>require('node:assert/strict').equal(x,42));",
    ],
    { cwd: temporary, stdio: "inherit" },
  );
  for (const ext of ["mts", "cts"]) {
    writeFileSync(
      join(temporary, `consumer.${ext}`),
      "import {createFlight} from 'inflight-kit'; const f=createFlight((key: string)=>key.length); const p: Promise<number>=f.run('hello'); void p;\n",
    );
    execFileSync(
      process.execPath,
      [
        join(root, "node_modules/typescript/bin/tsc"),
        "--noEmit",
        "--strict",
        "--module",
        "NodeNext",
        "--moduleResolution",
        "NodeNext",
        "--target",
        "ES2022",
        `consumer.${ext}`,
      ],
      { cwd: temporary, stdio: "inherit" },
    );
  }
  console.log(
    `Packed artifact verified: ${packed.filename}; ${packed.size} bytes; ESM, CommonJS and both declaration entry points passed.`,
  );
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
