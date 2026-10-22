# Releasing

Releases use `v<version>` tags and the **Publish package** workflow.

## Prepare

1. Update `package.json` and the lockfile in a PR.
2. Use Node.js 24 and pnpm 11.24.0 to run:

   ```sh
   pnpm install --frozen-lockfile
   pnpm check
   pnpm exec playwright install chromium
   pnpm test:browser
   pnpm pack
   ```

3. Install the tarball alongside `@nearai/inference-sdk` in a temporary project.
   Check both JavaScript entries, type declarations, CSS, README and LICENSE.
4. Merge the release preparation into the default branch.

## Publish

Manually run **Actions > Publish package** on the default branch with the exact
manifest version, without a `v` prefix. Pushing a tag does not publish.
The workflow runs CI, creates a tag and draft GitHub Release, publishes npm,
then makes the GitHub Release public. Stable versions use `latest`;
prereleases such as `0.1.0-rc.1` use `next`.

Before the first automated release:

- Confirm access to the `@nearai` npm scope and the package name.
- Create the GitHub `release` environment, restricted to the default branch.
- Configure npm trusted publishing for organization `nearai`, repository
  `inference-widget`, workflow `release.yml`, environment `release`, with direct
  `npm publish` allowed. Use an npm CLI supporting trusted publishing.
- If the package does not exist, bootstrap its first version with an authorized
  account before configuring its trusted publisher. Never commit credentials.
- Protect `v*` tags against updates and deletions while allowing workflow creation.

## Recover

Check whether npm accepted an upload before rerunning failed jobs. Keep the tag
and draft release. If only publishing the GitHub Release failed, rerun that job.
Published package versions cannot be overwritten; changes to package contents
require a new version. Verify public imports from a fresh installation after release.
