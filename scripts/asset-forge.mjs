#!/usr/bin/env node
/**
 * Local-only artwork pipeline:
 * name -> Gemma prompt -> Flux PNG.
 *
 * It deliberately binds to loopback only and does not use a shell, so prompt
 * text and output paths cannot become shell commands.
 */
import { createServer } from 'node:http';
import { access, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const workspaceDirectory = resolve(process.cwd());
const uiFile = resolve(scriptDirectory, '..', 'tools/asset-forge/index.html');
const projectConfigFile = resolve(workspaceDirectory, 'asset-forge.config.json');
const historyFile = resolve(workspaceDirectory, '.asset-forge-history.json');
const host = '127.0.0.1';
const port = Number(process.env.ASSET_FORGE_PORT ?? 4177);
const ollamaApi = 'http://127.0.0.1:11434';
const defaultModel = 'x/flux2-klein:9b';
const promptModel = 'gemma4:12b';
const assetNamePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const defaultStyle = {
  id: 'default-game',
  label: 'Default game artwork',
  prompt: 'clean, readable 2D fantasy game artwork with strong silhouettes, balanced colours, and a transparent background',
};
const assetRootCandidates = ['public/assets/svg', 'assets/svg', 'public/assets', 'assets', 'src/assets'];
const backgroundRequirement = 'Hard requirement: use a plain, solid, opaque pure white (#FFFFFF) background. Do not use transparency, gradients, scenery, frames, floor shadows, or environmental background elements.';
const compositionRequirement = 'Hard requirement: compose for a square game-asset canvas. Centre the complete subject and make its longest dimension fill approximately 88% of the canvas. Keep a consistent 6% safe margin on every side: no part of the subject may touch, cross, or be cropped by an image edge. The white background must extend to every canvas edge.';

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

async function generateTextWithOllama(model, prompt, onActivity) {
  let response;
  try {
    response = await fetch(`${ollamaApi}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, prompt, stream: true }),
    });
  } catch (error) {
    throw new Error(`Could not reach Ollama at ${ollamaApi}. Start Ollama and try again. (${error.message})`);
  }
  if (!response.ok || !response.body) throw new Error(`Ollama could not start ${model}: ${await response.text()}`);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let generated = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line);
        generated += event.response ?? '';
        onActivity?.();
      } catch { /* Ignore any incomplete/non-JSON transport line. */ }
    }
  }
  if (buffer.trim()) {
    const event = JSON.parse(buffer);
    generated += event.response ?? '';
    onActivity?.();
  }
  return generated;
}

async function createArtworkPrompt({ name, outputDirectory, style = projectConfig.styles[0].id }, onActivity) {
  const assetName = assetFileName(name);
  const category = artworkCategory(outputDirectory);
  const styleDescription = artworkStyle(style);
  const instruction = `You write concise, production-ready image prompts. Create a single Flux image-generation prompt for "${name.trim()}", which is ${category}. Use this visual style: ${styleDescription}. Describe only that named ${category}; preserve a clean, centred silhouette at game UI size, no text, logo, frame, UI, scenery, or cropped parts. ${compositionRequirement} ${backgroundRequirement} Do not mention SVG, vectorisation, Flux, or this instruction. Return only the final prompt in one paragraph.`;
  const prompt = stripTerminalCodes(await generateTextWithOllama(promptModel, instruction, onActivity)).trim();
  if (!prompt) throw new Error('Gemma returned an empty prompt. Make sure gemma4:12b is installed and try again.');
  return { prompt, model: promptModel, assetName, category, style };
}

async function generateImageWithOllama(model, prompt, onActivity) {
  let response;
  try {
    response = await fetch(`${ollamaApi}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, prompt, stream: false }),
    });
  } catch (error) {
    throw new Error(`Could not reach Ollama at ${ollamaApi}. Start Ollama and try again. (${error.message})`);
  }
  const result = await response.json();
  if (!response.ok) throw new Error(`Ollama could not generate an image with ${model}: ${result.error ?? 'Unknown error.'}`);
  if (typeof result.image !== 'string' || !result.image) throw new Error(`Ollama completed ${model} without returning PNG image data.`);
  onActivity?.();
  return Buffer.from(result.image, 'base64');
}

async function forgeAsset({ outputDirectory, name, style = projectConfig.styles[0].id, model = defaultModel, overwrite = false }, reportProgress = () => {}, reportActivity = () => {}) {
  const assetName = assetFileName(name);
  const folder = selectedOutputFolder(outputDirectory);
  if (typeof model !== 'string' || !/^[-/a-zA-Z0-9_.:]+$/.test(model)) throw new Error('Model name is invalid.');

  const outputFolder = resolve(workspaceDirectory, folder.path);
  await access(outputFolder, constants.W_OK);
  const pngPath = resolve(outputFolder, `${assetName}.png`);
  if (!overwrite) {
    for (const path of [pngPath]) {
      try { await access(path, constants.F_OK); throw new Error(`${path} already exists. Enable overwrite or choose another artwork name.`); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }

  reportProgress(`Running Gemma 4 12B for the ${style} style prompt…`, 1, 'gemma');
  const promptResult = await createArtworkPrompt({ name, outputDirectory, style }, reportActivity);
  reportProgress(`Running Flux (${model})…`, 2, 'flux');
  const pngData = await generateImageWithOllama(model, `${promptResult.prompt}\n\n${compositionRequirement}\n${backgroundRequirement}`, reportActivity);
  reportProgress('Saving Flux PNG into the selected folder…', 3, 'save');
  await writeFile(pngPath, pngData);
  return { pngPath, model, assetName, style, folderId: folder.id };
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
    step: 0,
    totalSteps: 3,
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
      updateJob(job, { status: 'running', stage: 'Preparing artwork job…', step: 0, phase: 'preparing', startedAt: new Date().toISOString(), stageStartedAt: new Date().toISOString() });
      try {
        const reportProgress = (stage, step, phase) => updateJob(job, { stage, step, phase, stageStartedAt: new Date().toISOString(), lastActivityAt: undefined });
        const reportActivity = () => updateJob(job, { lastActivityAt: new Date().toISOString() });
        const result = await forgeAsset(job.payload, reportProgress, reportActivity);
        await recordArtwork(result, job.name);
        updateJob(job, { status: 'complete', stage: 'PNG saved.', result, finishedAt: new Date().toISOString() });
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

async function loadArtworkHistory() {
  try {
    const history = JSON.parse(await readFile(historyFile, 'utf8'));
    return Array.isArray(history) ? history.filter((entry) => entry && typeof entry === 'object') : [];
  } catch (error) {
    if (error?.code === 'ENOENT') await writeFile(historyFile, '[]\n');
    return [];
  }
}

async function recordArtwork(result, name) {
  const history = await loadArtworkHistory();
  const record = { name, assetName: result.assetName, folderId: result.folderId, pngPath: result.pngPath, createdAt: new Date().toISOString() };
  await writeFile(historyFile, `${JSON.stringify([record, ...history.filter((entry) => entry.pngPath !== record.pngPath)], null, 2)}\n`);
}

function publicArtwork({ folder, assetName, name = assetName, pngPath, createdAt, origin }) {
  return {
    id: `${folder.id}:${assetName}`,
    name,
    assetName,
    pngPath,
    createdAt,
    origin,
    previewUrl: `/api/artwork/${encodeURIComponent(folder.id)}/${encodeURIComponent(assetName)}/preview.png`,
  };
}

async function generatedArtwork() {
  const items = new Map();
  for (const entry of await loadArtworkHistory()) {
    const folder = projectConfig.outputFolders.find((candidate) => candidate.id === entry.folderId);
    if (!folder || !assetNamePattern.test(entry.assetName ?? '')) continue;
    try {
      await access(entry.pngPath, constants.R_OK);
      items.set(`${folder.id}:${entry.assetName}`, publicArtwork({ ...entry, folder, origin: 'recorded' }));
    } catch { /* Omit moved or removed assets. */ }
  }
  return [...items.values()].sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
}

async function deleteRecordedArtwork(folderId, assetName) {
  const folder = projectConfig.outputFolders.find((candidate) => candidate.id === folderId);
  if (!folder || !assetNamePattern.test(assetName)) throw new Error('Recorded artwork was not found.');
  const history = await loadArtworkHistory();
  const record = history.find((entry) => entry.folderId === folderId && entry.assetName === assetName);
  if (!record) throw new Error('Only artwork recorded by Forge can be deleted here.');

  const pngPath = resolve(workspaceDirectory, folder.path, `${assetName}.png`);
  if (record.pngPath !== pngPath) throw new Error('The recorded artwork path is not valid for this project.');
  await access(resolve(workspaceDirectory, folder.path), constants.W_OK);
  await access(pngPath, constants.F_OK);
  await unlink(pngPath);
  await writeFile(historyFile, `${JSON.stringify(history.filter((entry) => entry !== record), null, 2)}\n`);
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
    if (request.method === 'GET' && request.url === '/api/artwork') {
      json(response, 200, { artwork: await generatedArtwork() });
      return;
    }
    const deleteArtworkMatch = request.method === 'DELETE' && request.url?.match(/^\/api\/artwork\/([a-z0-9-]+)\/([a-z0-9-]+)$/);
    if (deleteArtworkMatch) {
      const payload = await requestBody(request);
      if (payload.confirmed !== true) throw new Error('Confirm deletion before removing generated artwork.');
      await deleteRecordedArtwork(deleteArtworkMatch[1], deleteArtworkMatch[2]);
      json(response, 200, { deleted: true });
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
    const artworkPreviewMatch = request.method === 'GET' && request.url?.match(/^\/api\/artwork\/([a-z0-9-]+)\/([a-z0-9-]+)\/preview\.png$/);
    if (artworkPreviewMatch) {
      const folder = projectConfig.outputFolders.find((candidate) => candidate.id === artworkPreviewMatch[1]);
      if (!folder) {
        json(response, 404, { error: 'Artwork folder was not found.' });
        return;
      }
      const pngPath = resolve(workspaceDirectory, folder.path, `${artworkPreviewMatch[2]}.png`);
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
