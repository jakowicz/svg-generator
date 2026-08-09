#!/usr/bin/env node
import { access, readFile, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { relative, resolve } from 'node:path';
import { makeWhiteBackgroundTransparent } from './png-transparency.mjs';

const workspaceDirectory = resolve(process.cwd());
const historyFile = resolve(workspaceDirectory, '.asset-forge-history.json');

let history;
try {
  history = JSON.parse(await readFile(historyFile, 'utf8'));
} catch (error) {
  throw new Error(`Could not read ${historyFile}: ${error.message}`);
}
if (!Array.isArray(history)) throw new Error('Asset Forge history must contain an array.');

const paths = [...new Set(history.map((entry) => entry?.pngPath).filter((pngPath) => typeof pngPath === 'string'))];
let changed = 0;
let skipped = 0;
for (const pngPath of paths) {
  const resolvedPath = resolve(pngPath);
  if (relative(workspaceDirectory, resolvedPath).startsWith('..')) {
    console.warn(`Skipping external path: ${pngPath}`);
    skipped += 1;
    continue;
  }
  try {
    await access(resolvedPath, constants.R_OK | constants.W_OK);
    const { pngData, removedPixels } = makeWhiteBackgroundTransparent(await readFile(resolvedPath));
    if (removedPixels === 0) {
      skipped += 1;
      continue;
    }
    await writeFile(resolvedPath, pngData);
    changed += 1;
    console.log(`Transparent background: ${relative(workspaceDirectory, resolvedPath)} (${removedPixels} pixels)`);
  } catch (error) {
    skipped += 1;
    console.warn(`Skipping ${pngPath}: ${error.message}`);
  }
}
console.log(`Finished: ${changed} PNGs updated, ${skipped} skipped.`);
