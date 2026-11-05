# 13 - Marketplace Trusted Publishing (OIDC)

Date: 2026-11-05
Workflow: `.github/workflows/publish-marketplace.yml`
Environment: `marketplace`
Authentication: GitHub OIDC Trusted Publishing
PAT required: **No**

## 1. Why this workflow exists

The existing `apps/vscode/scripts/publish-marketplace.mjs` is a PAT-based local
wrapper. It calls `vsce publish` and `ovsx publish`; it needs `VSCE_PAT` (and an
Open VSX token for the second registry). It is not used by the Trusted
Publishing workflow.

The new workflow publishes **only** the prebuilt Bytos VSIX to the Visual Studio
Marketplace, using `vsce publish --oidc`. It never falls back to a PAT.

Official references verified on 2026-11-05:

- <https://code.visualstudio.com/api/working-with-extensions/publishing-extension#publish-with-github-actions-and-trusted-publishing>
- <https://github.com/microsoft/vscode-vsce#trusted-publishing>
- <https://developer.microsoft.com/blog/trusted-publishing-visual-studio-marketplace/>

Key requirements from those sources:

- Trusted Publishing currently supports GitHub Actions only.
- The GitHub job needs `id-token: write`; other permissions should stay read-only.
- Publish with `vsce publish --oidc` using an OIDC-capable vsce (`4.0.2+`).
- The Marketplace policy must match repository owner, repository, workflow
  filename, and—when used—the GitHub environment name.
- The temporary Marketplace credential expires after 15 minutes and each OIDC
  token can be exchanged only once.
- `vsce` does not fall back to a PAT if OIDC exchange fails.

This workflow pins `@vscode/vsce@4.1.0` (the current stable OIDC-capable release
when this document was written).

## 2. Marketplace Trusted Publishing policy

Create this once in the Visual Studio Marketplace publisher management page:

1. Sign in at <https://marketplace.visualstudio.com/manage>.
2. Open the **bytos** publisher.
3. Select **Trusted Publishing** -> **Create**.
4. Enter:

| Field | Value |
| --- | --- |
| Policy name | `GitHub release workflow` |
| Repository owner | `Balahurra` |
| Repository | `Bytos` |
| Workflow | `publish-marketplace.yml` |
| Environment | `marketplace` |

The environment field must match exactly. If the policy is created for a private
repository, the first run must happen within 48 hours; the first successful token
exchange permanently activates the policy. `Balahurra/Bytos` is public, but the
same rule applies if it ever becomes private.

## 3. GitHub environment

Create the environment in **Settings -> Environments**:

- Name: `marketplace`
- Required reviewers: at least one maintainer
- Deployment branches: `main` only
- Wait timer: optional
- Secrets: **none required**

The environment is the human approval gate. The Marketplace policy also names
`marketplace`, so a job using a different environment cannot exchange the OIDC
token for a Marketplace credential.

## 4. Trigger

Manual dispatch only. There is no push, pull request, schedule, or tag trigger.

1. Open **Actions -> publish-marketplace -> Run workflow**.
2. Select branch **main**.
3. Enter an existing stable release tag, for example `v1.0.0`.
4. Enter `publish` in **confirm_publish**.
5. Approve the `marketplace` environment deployment when prompted.

The workflow refuses to run if:

- the repository is not `Balahurra/Bytos`;
- it was dispatched from anything other than `refs/heads/main`;
- `confirm_publish` is not exactly `publish`;
- the actor is a bot;
- the tag is not a stable `vX.Y.Z` tag;
- the release is a draft or pre-release;
- the release does not contain exactly one VSIX plus its `.sha256` manifest;
- the tag commit is not on `main`;
- `apps/vscode/package.json` does not identify `bytos.bytos` at the tag version;
- the VSIX embedded identity does not match;
- the checksum does not match;
- the VSIX is missing the runtime, LICENSE, NOTICE, or third-party notices.

## 5. Permissions

Top-level:

```yaml
permissions:
  contents: read
```

Preflight job:

```yaml
permissions:
  contents: read
```

Publish job (the only job with OIDC):

```yaml
permissions:
  contents: read
  id-token: write
```

`id-token: write` is not present on the preflight job or at workflow level. No
`contents: write`, `packages: write`, `pull-requests: write`, or PAT is used.

## 6. What the workflow publishes

The workflow does **not** rebuild the extension. It downloads the existing
GitHub release assets:

- `bytos-<version>.vsix`
- `bytos-<version>.vsix.sha256`

It verifies:

- the release is stable and has exactly one VSIX asset;
- the checksum file names the expected VSIX and the SHA-256 matches;
- the VSIX contains `extension/package.json`, `extension/dist/extension.js`,
  `extension/webview-ui/build/index.html`, `extension/LICENSE.txt`,
  `extension/NOTICE`, and `extension/THIRD-PARTY-NOTICES.txt`;
- the embedded manifest is `publisher: bytos`, `name: bytos`, version equal to
  the tag, with `engines.vscode` present;
- the tag is an ancestor of `origin/main`.

It then runs:

```bash
npx --yes @vscode/vsce@4.1.0 publish \
  --oidc \
  --packagePath /path/to/bytos-<version>.vsix \
  --no-dependencies \
  --allow-package-secrets sendgrid
```

`--allow-package-secrets sendgrid` matches the existing
`publish-marketplace.mjs` packaging rule. It allows only the already-audited
`sendgrid` secret type; it does **not** use `--allow-package-all-secrets`.

It publishes only the Bytos VS Code extension. It does not publish the CLI, hub,
desktop app, SDK packages, or Open VSX.

## 7. Verifying a run

1. The workflow writes a summary with the tag, version, and VSIX SHA-256.
2. Check the Marketplace listing:
   <https://marketplace.visualstudio.com/items?itemName=bytos.bytos>
3. Verify the version from a terminal:

   ```bash
   npx --yes @vscode/vsce@4.1.0 show bytos.bytos --json
   ```

4. In the publisher management page, open **Trusted Publishing** and confirm the
   policy shows a successful last use.
5. Confirm the workflow has no PAT secret and that the publish job has
   `id-token: write` but no write permissions beyond it.

The first publish may write `__metadata` into the manifest. After the first
successful run, inspect `apps/vscode/package.json` for a `__metadata` block and
commit it separately if it changed.

## 8. Failure behavior

The workflow fails closed:

- missing or mismatched OIDC policy -> `vsce publish --oidc` exits non-zero;
- wrong environment name -> policy mismatch and token exchange failure;
- missing publisher permission -> authorization failure;
- missing release asset, wrong checksum, wrong publisher/name/version -> preflight
  or verification step fails before `vsce`;
- already-published version -> `vsce` fails; no `--skip-duplicate` is used;
- `vsce publish --oidc` has no PAT fallback, and the workflow defines no
  Marketplace token or PAT secret.

There is no automatic publish on push, PR, or tag creation.

## 9. Relationship to the legacy PAT path

`apps/vscode/scripts/publish-marketplace.mjs` and the existing
`ext-vscode-publish*.yml` workflows remain untouched. They use `VSCE_PAT` and
also target Open VSX. The Trusted Publishing workflow is the recommended path for
Marketplace-only releases once the policy and environment are configured.

Do not use the legacy PAT path for the new workflow. Do not store a Marketplace
token as a GitHub secret for this workflow.

## 10. Implementation verification

- `actionlint`: PASS.
- Prettier YAML parse: PASS.
- `git diff --check`: PASS.
- `@vscode/vsce@4.1.0 --version`: PASS.
- `vsce publish --help` confirms `--oidc` and `--packagePath`.
- `vsce publish` was **not executed** during implementation.
- No GitHub release was created during this implementation.
