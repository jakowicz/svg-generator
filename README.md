# SVG Generator

SVG Generator is a local artwork pipeline for game projects:

```text
Name + output folder + style
  → Gemma writes the image prompt
  → Flux creates a PNG
  → VTracer converts it to SVG
```

It runs entirely on your Mac or PC. Prompts, generated PNGs, and SVGs do not
leave the machine.

## What the browser tool does

Open the local Forge page, enter an artwork name such as **Minotaur**, choose
the project output folder and a style, then select **Generate PNG and forge
SVG**. The file name is made safely from the name (`minotaur.png` and
`minotaur.svg`).

Jobs are queued: Gemma, Flux, copying, and SVG conversion run one at a time.
The queue shows the current stage, final output locations, failures, and a
hover preview of completed PNGs.

## Requirements

- Node.js 20 or newer
- [Ollama](https://ollama.com/), running locally
- A Flux image model and Gemma prompt model:

  ```bash
  ollama pull gemma4:12b
  ollama pull x/flux2-klein:9b
  ```

- VTracer, installed either as its Python package or command-line tool. The
  Python package is usually the easiest option:

  ```bash
  python3 -m pip install vtracer
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
| VTracer is unavailable | Run `python3 -m pip install vtracer`; the Forge automatically uses the Python binding when the CLI is absent. |
| No output folders appear | Create one of the standard asset roots with a subfolder, or add `asset-forge.config.json`. |
| An artwork name already exists | Choose a different name; Forge protects existing PNG/SVG pairs from accidental replacement. |
| The page does not update after a change | Stop the process with `Ctrl+C`, run `npm run asset:forge` again, then reload the browser page. |

## Repository layout

```text
scripts/asset-forge.mjs            Local queue server and Ollama/VTracer pipeline
scripts/vectorize-with-vtracer.py  Python VTracer fallback
tools/asset-forge/index.html       Local browser interface
tools/asset-forge/README.md        Project configuration reference
```
