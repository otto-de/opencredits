# Demo shop

A fake frontend with five dependencies (plus their transitive dependencies and one dev dependency) to demo OpenCredits. Nothing here is built or installed; OpenCredits only reads `package-lock.json`.

From the repository root:

```sh
npm install
npm run demo
```

Then open `demo-output/site/index.html`. Private outputs are in `demo-output/data`.

The lockfile intentionally has no `integrity` fields, so OpenCredits verifies each package against the checksum published by the npm registry. The demo needs internet access to `registry.npmjs.org`.
