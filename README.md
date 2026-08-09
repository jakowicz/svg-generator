# Asset Forge

Asset Forge is a local PNG artwork pipeline for game projects:

```text
Name + output folder + style
  → Gemma writes the image prompt
  → Flux creates a PNG
```

It runs entirely on your Mac or PC. Prompts and generated PNGs do not leave
the machine.

Forge generates against a white canvas, then removes neutral white backdrop
pixels anywhere in the image plus the light anti-aliasing matte at the outer
edge. The saved PNG is therefore ready for Unity sprite import without white
canvas islands trapped inside the artwork or a light outer fringe.

To update previously generated Forge artwork, run this from the target game
root:

```bash
node ./tools/svg-generator/scripts/make-recorded-pngs-transparent.mjs
```

It changes only PNGs listed in that project’s Asset Forge history.
Each recorded PNG is processed once per transparency-rule version, so rerunning
the command does not repeatedly erode an already cleaned sprite.

## What the browser tool does

Open the local Forge page, enter an artwork name such as **Minotaur**, choose
the project output folder and a style, then select **Generate PNG**. The file
name is made safely from the name (`minotaur.png`).

To create several assets, enter a comma-separated list—for example
`Minotaur, Phoenix, Leviathan`. Forge validates the complete list, then queues
one PNG job per name in that order (up to 20 at once).

Jobs are queued: Gemma, Flux, and saving run one at a time. The queue shows
the current stage, final output location, failures, and a hover preview of
completed PNGs.

The current queue and job statuses are saved in `.asset-forge-queue.json` in
the target project. Refreshing the browser is safe. After restarting Forge,
queued jobs resume in their original order; a job that had already saved its
PNG is recovered as complete rather than generated twice.

Each gallery card has **Regenerate PNG**. It queues a fresh Flux attempt with
the same name, output folder, and style, while retaining the existing PNG until
the replacement has been saved.

Original artwork in the **Summons** folder also has **Create 3 animation
poses**. It queues `charge`, `attack`, and `exit` PNGs using the configured
Flux 9B model and saves them beside the original—for example,
`minotaur-charge.png`, `minotaur-attack.png`, and `minotaur-exit.png`.

Every request includes a square-canvas composition rule: the complete subject
is centred, its longest dimension targets 88% of the canvas, and a 6% margin
is reserved at every edge. This keeps generated assets consistently large
without clipping them.

## Requirements

- Node.js 20 or newer
- Install Forge's local dependencies once after cloning or updating the
  submodule:

  ```bash
  cd tools/svg-generator
  npm install
  cd ../..
  ```
- [Ollama](https://ollama.com/), running locally
- A Flux image model and Gemma prompt model:

  ```bash
  ollama pull gemma4:12b
  ollama pull x/flux2-klein:9b
  ```

## Use it as a Git submodule

From a game project:

```bash
git submodule add git@github.com:jakowicz/svg-generator.git tools/svg-generator
```

Add this script to that game's `package.json`:

```json
{
  "scripts": {
    "asset:forge": "node ./tools/svg-generator/scripts/asset-forge.mjs"
  }
}
```

Then run:

```bash
npm run asset:forge
```

Open the local address printed in the terminal, normally
`http://127.0.0.1:4177`.

The server intentionally binds to loopback only. It is not exposed to your
local network.

## Output folders and styles

The generator discovers immediate subfolders in the first existing standard
asset root:

- `public/assets/svg`
- `assets/svg`
- `public/assets`
- `assets`
- `src/assets`

Those folders become the Output folder options. Without configuration it uses
the generic **Default game artwork** style.

For controlled labels, prompt categories, and project-specific styles, add
`asset-forge.config.json` at the game project root:

```json
{
  "outputFolders": [
    {
      "id": "summons",
      "label": "Summons",
      "path": "public/assets/svg/summons",
      "category": "a summon creature"
    }
  ],
  "styles": [
    {
      "id": "my-game",
      "label": "My game",
      "prompt": "clean hand-painted fantasy artwork, strong silhouettes, rich restrained colours and bold dark outlines"
    }
  ]
}
```

`path` must be relative to the game project root. Forge only writes to a
configured or discovered project folder; it does not accept arbitrary output
paths from the browser.

The selected style’s exact instruction is visible below the Style selector and
is included when Gemma creates the Flux prompt.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `ollama` cannot be started | Install Ollama, start it, then run the two `ollama pull` commands above. |
| Gemma or Flux model is missing | Pull the exact model shown above, or update the tool’s configured defaults. |
| No output folders appear | Create one of the standard asset roots with a subfolder, or add `asset-forge.config.json`. |
| An artwork name already exists | Choose a different name; Forge protects existing PNG files from accidental replacement. |
| The page does not update after a change | Stop the process with `Ctrl+C`, run `npm run asset:forge` again, then reload the browser page. |

## Repository layout

```text
scripts/asset-forge.mjs            Local queue server and Ollama PNG pipeline
tools/asset-forge/index.html       Local browser interface
tools/asset-forge/README.md        Project configuration reference
```
