# Asset Forge configuration reference

For the complete installation and usage guide, see the repository
[README](../../README.md). This page is the concise reference for configuring
an individual game project.

Asset Forge runs from the target game's root. When installed as a submodule,
add this script to the game's `package.json`:

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
