# Visual Studio Code release

NotebookFlow is published to the Visual Studio Marketplace with the permanent
extension ID `notebookflow.notebookflow-vscode`. The extension version and the
managed `notebookflow-app` engine version are both `0.1.0` for the first
release.

## Compatibility

- Visual Studio Code 1.94 or newer
- Python 3.11–3.13 on the machine running the extension host
- Microsoft Jupyter extension (`ms-toolsai.jupyter`), installed as an extension
  dependency

Users install from the Extensions view by searching for **NotebookFlow**. A
local VSIX can be installed from the Command Palette with **Extensions: Install
from VSIX...**.

The extension host and React webview are bundled into the VSIX. On first use,
NotebookFlow asks permission to install `notebookflow-app==0.1.0` from PyPI into
private VS Code extension storage. Users do not need Node.js, `uv`, or a source
checkout.

## One-time publisher setup

1. Sign in to the
   [Marketplace publisher portal](https://marketplace.visualstudio.com/manage/publishers/)
   and create or confirm the immutable publisher ID `notebookflow`.
2. Create a user-assigned managed identity in Azure and configure a federated
   credential for this repository's protected `vscode-marketplace` GitHub
   environment. Its subject is
   `repo:NoelHuibers/notebookflow:environment:vscode-marketplace`.
3. Retrieve the identity's Azure DevOps profile resource ID while logged in as
   that identity:

   ```bash
   az rest \
     --url https://app.vssps.visualstudio.com/_apis/profile/profiles/me \
     --resource 499b84ac-1321-427f-aa17-267ca6975798
   ```

4. Add that resource ID as a member of the `notebookflow` Marketplace publisher
   with the **Contributor** role.
5. Create the protected GitHub environment `vscode-marketplace`, require a
   reviewer, and add these environment variables: `AZURE_CLIENT_ID`,
   `AZURE_TENANT_ID`, and `AZURE_SUBSCRIPTION_ID`.

The workflow uses GitHub OIDC plus Microsoft Entra ID and stores no long-lived
Marketplace token. This follows Microsoft's current recommendation; global
Azure DevOps PATs retire on December 1, 2026. See the
[official publishing guide](https://code.visualstudio.com/api/working-with-extensions/publishing-extension).

If identity setup is not ready for the first release, download the validated
workflow artifact and upload it manually in the publisher portal. Keep the
publisher and extension IDs exactly as declared in `package.json`.

## Build and test

Run the **Release VS Code** workflow manually with publishing disabled. It
type-checks and tests the adapter, builds both bundles, validates the VSIX
contents, and installs it into an isolated VS Code profile.

Equivalent local checks are:

```bash
pnpm install --frozen-lockfile
pnpm --filter notebookflow-vscode typecheck
pnpm --filter notebookflow-vscode test
pnpm --filter notebookflow-vscode package
python scripts/verify_vscode_distribution.py \
  packages/vscode-extension/notebookflow-vscode-0.1.0.vsix
```

Then install the VSIX into a clean VS Code profile, open an `.ipynb` notebook,
run **NotebookFlow: Open Canvas**, approve the engine installation, and execute
one cell from the canvas. Confirm that failures for missing Python or blocked
PyPI access point to the **NotebookFlow Engine** output channel.

## Publish

After a dry run passes and the publisher identity is ready:

```bash
git tag vscode-v0.1.0
git push origin vscode-v0.1.0
```

The tag must exactly match `packages/vscode-extension/package.json`. The tag
workflow publishes only after the artifact and clean-install smoke jobs pass.

Verify the public listing at
`https://marketplace.visualstudio.com/items?itemName=notebookflow.notebookflow-vscode`
and install it from a separate VS Code profile before announcing the release.
The repository README and the web app's Help menu already use this permanent
URL, so no post-release source edit is required.

## Rollback

Marketplace versions are immutable. If a release is broken:

1. Unpublish it from the Marketplace management page; do not remove it, because
   removal permanently reserves the extension name and discards its history.
2. Fix forward, increment the patch version in the extension manifest and
   managed-engine constant as needed, rerun the dry-run workflow, and publish a
   new tag.
3. Re-publish the previous known-good version only if the Marketplace permits
   it; otherwise direct users to its VSIX artifact until the fixed version is
   live.
