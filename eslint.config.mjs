// @ts-check
import { includeIgnoreFile } from "@eslint/compat";
import { defaultConfig } from "@flarenetwork/eslint-config-flare";
import prettier from "eslint-config-prettier";
import path from "node:path";
import { fileURLToPath } from "node:url";

const gitignorePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".gitignore");

export default [
  {
    ignores: ["libs/fsp-rewards/**"],
  },
  includeIgnoreFile(gitignorePath),
  ...defaultConfig,
  prettier,
];
