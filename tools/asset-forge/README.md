# Asset Forge project setup

Asset Forge is portable. Copy `scripts/asset-forge.mjs`,
`scripts/vectorize-with-vtracer.py`, and `tools/asset-forge/` into a project,
then run it from that project's root with:

```json
{
  "scripts": {
    "asset:forge": "node ./scripts/asset-forge.mjs"
  }
}
```

Without configuration, Forge detects immediate subfolders in the first existing
standard asset root: `public/assets/svg`, `assets/svg`, `public/assets`,
`assets`, or `src/assets`. Those folders populate the Output folder selector.
It uses the generic **Default game artwork** style.

For exact folder labels, prompt categories, and game styles, add an
`asset-forge.config.json` file at the project root:

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
      "prompt": "the concise visual style instruction passed to Gemma"
    }
  ]
}
```

Folder paths must be relative to the project root. Forge only writes to a
folder provided by this configuration or detected from the project, keeping
output scoped to the selected project.
