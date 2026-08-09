#!/usr/bin/env node
/**
 * Local-only artwork pipeline:
 * prompt -> ollama run x/flux2-klein:9b -> PNG -> VTracer -> SVG.
 *
 * It deliberately binds to loopback only and does not use a shell, so prompt
 * text and output paths cannot become shell commands.
 */
import { createServer } from 'node:http';
import { access, copyFile, readFile, readdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const workspaceDirectory = resolve(process.cwd());
const uiFile = resolve(scriptDirectory, '..', 'tools/asset-forge/index.html');
const projectConfigFile = resolve(workspaceDirectory, 'asset-forge.config.json');
const pythonVectorizerFile = resolve(scriptDirectory, 'vectorize-with-vtracer.py');
const host = '127.0.0.1';
const port = Number(process.env.ASSET_FORGE_PORT ?? 4177);
const defaultModel = 'x/flux2-klein:9b';
const promptModel = 'gemma4:12b';
const assetNamePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const defaultStyle = {
  id: 'default-game',
  label: 'Default game artwork',
  prompt: 'clean, readable 2D fantasy game artwork with strong silhouettes, balanced colours, and a transparent background',
};
const assetRootCandidates = ['public/assets/svg', 'assets/svg', 'public/assets', 'assets', 'src/assets'];

function assetFileName(name) {
  if (typeof name !== 'string' || !name.trim()) throw new Error('Enter a name for the artwork.');
  if (name.trim().length > 120) throw new Error('Artwork names must be 120 characters or fewer.');
  const fileName = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!assetNamePattern.test(fileName)) throw new Error('Use a name containing at least one letter or number.');
  return fileName;
}

function artworkCategory(outputDirectory) {
  const configuredFolder = projectConfig.outputFolders.find((folder) => folder.path === outputDirectory);
  if (configuredFolder?.category) return configuredFolder.category;
  const categories = {
    summons: 'a summon creature',
    characters: 'a playable character',
    npcs: 'a non-player character',
    enemies: 'an enemy or boss',
    terrain: 'terrain artwork',
    props: 'a reusable map prop',
    buildings: 'a building exterior',
    interiors: 'interior artwork',
    landmarks: 'a major landmark',
    items: 'a game item',
    equipment: 'a weapon or equipment item',
    effects: 'a magic or visual effect',
    ui: 'a user-interface asset',
  };
  const key = typeof outputDirectory === 'string' ? outputDirectory.split('/').at(-1) : undefined;
  return categories[key] ?? 'game artwork';
}

function selectedOutputFolder(outputDirectory) {
  const selectedFolder = projectConfig.outputFolders.find((folder) => folder.path === outputDirectory);
  if (!selectedFolder) throw new Error('Choose an output folder provided by this project.');
  return selectedFolder;
}

function artworkStyle(style) {
  const selectedStyle = projectConfig.styles.find((candidate) => candidate.id === style);
  if (!selectedStyle) throw new Error('Choose a supported artwork style.');
  return selectedStyle.prompt;
}

function normaliseFolder(folder) {
  if (!folder || typeof folder !== 'object' || typeof folder.path !== 'string') return undefined;
  const path = folder.path.trim().replace(/^\.\//, '');
  const absolutePath = resolve(workspaceDirectory, path);
  if (!path || !absolutePath.startsWith(`${workspaceDirectory}/`)) return undefined;
  const id = typeof folder.id === 'string' && /^[a-z0-9-]+$/.test(folder.id) ? folder.id : assetFileName(path.split('/').at(-1));
  return {
    id,
    path,
    label: typeof folder.label === 'string' && folder.label.trim() ? folder.label.trim() : path.split('/').at(-1),
    category: typeof folder.category === 'string' && folder.category.trim() ? folder.category.trim() : `artwork for the ${path.split('/').at(-1)} folder`,
  };
}

function normaliseStyle(style) {
  if (!style || typeof style !== 'object' || typeof style.id !== 'string' || typeof style.label !== 'string' || typeof style.prompt !== 'string') return undefined;
  if (!/^[a-z0-9-]+$/.test(style.id) || !style.label.trim() || !style.prompt.trim()) return undefined;
  return { id: style.id, label: style.label.trim(), prompt: style.prompt.trim() };
}

async function discoverOutputFolders() {
  for (const candidate of assetRootCandidates) {
    try {
      const entries = await readdir(resolve(workspaceDirectory, candidate), { withFileTypes: true });
      const directories = entries.filter((entry) => entry.isDirectory()).map((entry) => normaliseFolder({ path: `${candidate}/${entry.name}` })).filter(Boolean);
      if (directories.length) return directories;
    } catch { /* Try the next conventional asset root. */ }
  }
  return [];
}

async function loadProjectConfig() {
  let configured = {};
  try {
    configured = JSON.parse(await readFile(projectConfigFile, 'utf8'));
  } catch (error) {
    if (error?.code !== 'ENOENT') throw new Error(`Could not read asset-forge.config.json: ${error.message}`);
  }
  if (!configured || typeof configured !== 'object' || Array.isArray(configured)) throw new Error('asset-forge.config.json must contain a JSON object.');
  const outputFolders = Array.isArray(configured.outputFolders)
    ? configured.outputFolders.map(normaliseFolder).filter(Boolean)
    : await discoverOutputFolders();
  const styles = Array.isArray(configured.styles)
    ? configured.styles.map(normaliseStyle).filter(Boolean)
    : [defaultStyle];
  if (!outputFolders.length) throw new Error('No artwork output folders were found. Add asset-forge.config.json or create a conventional assets folder.');
  return { outputFolders, styles: styles.length ? styles : [defaultStyle] };
}

const projectConfig = await loadProjectConfig();

function run(command, args, { cwd = workspaceDirectory } = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { cwd, shell: false });
    let output = '';
    let errorOutput = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { errorOutput += chunk; });
    child.on('error', (error) => rejectRun(new Error(`Could not start ${command}: ${error.message}`)));
    child.on('close', (code) => {
      if (code === 0) resolveRun({ output, errorOutput });
      else rejectRun(new Error(`${command} exited with code ${code}.\n${errorOutput || output}`.trim()));
    });
  });
}

async function assertAvailable(command, versionArgument = '--version') {
  try {
    await run(command, [versionArgument]);
  } catch (error) {
    throw new Error(`${command} is required. ${command === 'vtracer' ? 'Install it with: cargo install vtracer' : 'Install or start Ollama, then pull the selected Flux model.'} (${error.message})`);
  }
}

/** Prefer the standalone CLI, but support the official Python binding too. */
async function locateVectorizer() {
  try {
    await run('vtracer', ['--version']);
    return 'cli';
  } catch {
    try {
      await run('python3', ['-c', 'import vtracer']);
      return 'python';
    } catch (error) {
      throw new Error(`VTracer is required. Install either the CLI (cargo install vtracer) or Python binding (python3 -m pip install vtracer). (${error.message})`);
    }
  }
}

async function vectorize(inputPath, outputPath, vectorizer) {
  const argumentsForTrace = [
    '--input', inputPath,
    '--output', outputPath,
    '--colormode', 'color',
    '--mode', 'spline',
    '--filter_speckle', '12',
    '--color_precision', '5',
    '--path_precision', '2',
  ];
  if (vectorizer === 'cli') {
    await run('vtracer', ['--preset', 'poster', ...argumentsForTrace]);
  } else {
    await run('python3', [pythonVectorizerFile, ...argumentsForTrace]);
  }
}

function json(response, status, payload) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(payload));
}

async function requestBody(request) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 32_000) throw new Error('Request is too large.');
  }
  try { return JSON.parse(body); } catch { throw new Error('Request body must be valid JSON.'); }
}

function stripTerminalCodes(value) {
  return value.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
}

function generatedPngPath(output) {
  const match = stripTerminalCodes(output).match(/Image saved to:\s*(.+?\.png)\s*$/mi);
  if (!match) throw new Error('Ollama finished but did not report a PNG path. Update Ollama and make sure image generation is available, then try again.');
  return match[1].trim();
}

async function createArtworkPrompt({ name, outputDirectory, style = projectConfig.styles[0].id }) {
  const assetName = assetFileName(name);
  const category = artworkCategory(outputDirectory);
  const styleDescription = artworkStyle(style);
  await assertAvailable('ollama');
  const instruction = `You write concise, production-ready image prompts. Create a single Flux image-generation prompt for "${name.trim()}", which is ${category}. Use this visual style: ${styleDescription}. Describe only that named ${category}; preserve a clean, centred silhouette at game UI size, generous padding, a transparent background, and no text, logo, frame, UI, scenery, or cropped parts. Do not mention SVG, vectorisation, Flux, or this instruction. Return only the final prompt in one paragraph.`;
  const result = await run('ollama', ['run', promptModel, instruction]);
  const prompt = stripTerminalCodes(result.output).trim();
  if (!prompt) throw new Error('Gemma returned an empty prompt. Make sure gemma4:12b is installed and try again.');
  return { prompt, model: promptModel, assetName, category, style };
}

async function forgeAsset({ outputDirectory, name, style = projectConfig.styles[0].id, model = defaultModel, overwrite = false }, reportProgress = () => {}) {
  const assetName = assetFileName(name);
  const folder = selectedOutputFolder(outputDirectory);
  if (typeof model !== 'string' || !/^[-/a-zA-Z0-9_.:]+$/.test(model)) throw new Error('Model name is invalid.');

  const outputFolder = resolve(workspaceDirectory, folder.path);
  await access(outputFolder, constants.W_OK);
  const pngPath = resolve(outputFolder, `${assetName}.png`);
  const svgPath = resolve(outputFolder, `${assetName}.svg`);
  if (!overwrite) {
    for (const path of [pngPath, svgPath]) {
      try { await access(path, constants.F_OK); throw new Error(`${path} already exists. Enable overwrite or choose another artwork name.`); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }

  reportProgress(`Running Gemma 4 12B for the ${style} style prompt…`);
  const promptResult = await createArtworkPrompt({ name, outputDirectory, style });
  reportProgress('Checking SVG conversion tools…');
  const vectorizer = await locateVectorizer();
  reportProgress(`Running Flux (${model})…`);
  const flux = await run('ollama', ['run', model, promptResult.prompt]);
  const temporaryPng = generatedPngPath(`${flux.output}\n${flux.errorOutput}`);
  await access(temporaryPng, constants.R_OK);
  reportProgress('Copying Flux PNG into the selected folder…');
  await copyFile(temporaryPng, pngPath);
  reportProgress(`Converting PNG to SVG with ${vectorizer === 'cli' ? 'VTracer' : 'the Python VTracer binding'}…`);
  await vectorize(pngPath, svgPath, vectorizer);
  return { pngPath, svgPath, model, vectorizer, assetName, style };
}

const jobs = new Map();
const queuedJobIds = [];
let runningJob = false;
let nextJobId = 1;

function publicJob(job) {
  const { payload, ...details } = job;
  return details;
}

function queueJob(kind, payload) {
  const now = new Date().toISOString();
  const job = {
    id: String(nextJobId++),
    kind,
    name: payload.name.trim(),
    status: 'queued',
    stage: 'Waiting for the previous job…',
    createdAt: now,
    updatedAt: now,
    payload,
  };
  jobs.set(job.id, job);
  queuedJobIds.push(job.id);
  void processQueue();
  return publicJob(job);
}

function updateJob(job, changes) {
  Object.assign(job, changes, { updatedAt: new Date().toISOString() });
}

async function processQueue() {
  if (runningJob) return;
  runningJob = true;
  try {
    while (queuedJobIds.length > 0) {
      const job = jobs.get(queuedJobIds.shift());
      if (!job) continue;
      updateJob(job, { status: 'running', stage: 'Preparing artwork job…', startedAt: new Date().toISOString() });
      try {
        const result = await forgeAsset(job.payload, (stage) => updateJob(job, { stage }));
        updateJob(job, { status: 'complete', stage: 'PNG and SVG saved.', result, finishedAt: new Date().toISOString() });
      } catch (error) {
        updateJob(job, { status: 'failed', stage: 'Job failed.', error: error instanceof Error ? error.message : 'Asset generation failed.', finishedAt: new Date().toISOString() });
      }
    }
  } finally {
    runningJob = false;
  }
}

function allPublicJobs() {
  return [...jobs.values()].sort((left, right) => Number(right.id) - Number(left.id)).map(publicJob);
}

const server = createServer(async (request, response) => {
  try {
    if (request.method === 'GET' && request.url === '/') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      response.end(await readFile(uiFile));
      return;
    }
    if (request.method === 'GET' && request.url === '/api/jobs') {
      json(response, 200, { jobs: allPublicJobs() });
      return;
    }
    if (request.method === 'GET' && request.url === '/api/config') {
      json(response, 200, projectConfig);
      return;
    }
    if (request.method === 'POST' && request.url === '/api/forge') {
      const payload = await requestBody(request);
      assetFileName(payload.name);
      selectedOutputFolder(payload.outputDirectory);
      artworkStyle(payload.style ?? projectConfig.styles[0].id);
      json(response, 202, { job: queueJob('forge', payload) });
      return;
    }
    const previewMatch = request.method === 'GET' && request.url?.match(/^\/api\/jobs\/([0-9]+)\/preview\.png$/);
    if (previewMatch) {
      const job = jobs.get(previewMatch[1]);
      const pngPath = job?.status === 'complete' && job.kind === 'forge' ? job.result?.pngPath : undefined;
      if (!pngPath) {
        json(response, 404, { error: 'PNG preview is not available yet.' });
        return;
      }
      response.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' });
      response.end(await readFile(pngPath));
      return;
    }
    json(response, 404, { error: 'Not found.' });
  } catch (error) {
    json(response, 400, { error: error instanceof Error ? error.message : 'Asset generation failed.' });
  }
});

server.listen(port, host, () => {
  console.log(`Asset Forge is ready at http://${host}:${port}`);
  console.log('This server is local-only. Press Ctrl+C to stop it.');
});
