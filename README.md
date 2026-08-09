# SVG Generator

Local, browser-based artwork generation for game projects:

`name + asset folder + style → Gemma prompt → Flux PNG → VTracer SVG`

Start it from the target game project's root:

```bash
npm run asset:forge
```

See [the project setup guide](tools/asset-forge/README.md) for portable setup,
automatic output-folder discovery, and the optional `asset-forge.config.json`
format used to define project-specific folders and artwork styles.
