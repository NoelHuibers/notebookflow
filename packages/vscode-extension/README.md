# NotebookFlow for Visual Studio Code

NotebookFlow turns a Jupyter notebook into a visual workflow without moving
execution out of your local environment. Arrange notebook cells as connected
nodes, inspect their data flow, and run the pipeline from the canvas beside
the notebook.

## Get started

1. Install the extension and open an `.ipynb` file.
2. Select the **NotebookFlow: Open Canvas** button in the notebook toolbar, or
   run that command from the Command Palette.
3. On the first run, approve installation of the released NotebookFlow engine.
   The extension creates a private Python environment in VS Code's extension
   storage and reuses it on later runs. The engine includes the scientific
   Python runtime, so its first download can take several minutes.

The Microsoft Jupyter extension is installed automatically as an extension
dependency. The local engine requires Python 3.11, 3.12, or 3.13. Node.js,
`uv`, and a NotebookFlow source checkout are not required.

## What it does

- Builds a pipeline graph from cells across a Jupyter notebook.
- Keeps canvas edits and notebook source synchronized.
- Streams local execution progress and cell outputs back into the notebook.
- Provides Ask, Compose, Explain, and node-synthesis tools with your own LLM
  provider key.
- Optionally opens and saves notebooks in a NotebookFlow Cloud account.

## Local execution and privacy

Pipeline code runs in the local `notebookflow-app` engine launched by the
extension. Notebook contents and execution data are not sent to NotebookFlow
Cloud. Cloud sign-in and cloud notebook commands are optional. If you enable
an LLM feature, its request is sent directly to the provider selected in your
settings using the key stored in VS Code SecretStorage.

## Settings

| Setting | Purpose |
| --- | --- |
| `notebookflow.pythonPath` | Optional Python 3.11–3.13 executable for managed-engine setup. |
| `notebookflow.enginePath` | Development-only override for an engine checkout run with `uv`. |
| `notebookflow.llm.provider` | LLM provider used by AI-assisted commands. |
| `notebookflow.llm.model` | Optional provider model ID. |
| `notebookflow.cloud.baseUrl` | Hosted NotebookFlow origin used only by optional cloud commands. |

Use **NotebookFlow: Set LLM API Key** to store a key; it is never written to
workspace settings.

## Troubleshooting

- **Python was not found:** install Python 3.11–3.13, restart VS Code, or set
  `notebookflow.pythonPath` to its executable.
- **Engine installation or startup failed:** open **Output: Show Output
  Channels** and select **NotebookFlow Engine**. Check network access to PyPI
  for the first installation.
- **The canvas command asks for a notebook:** open an `.ipynb` file with the
  Jupyter extension first.
- **Remote development:** the extension and managed Python engine run on the
  remote extension host, beside the notebook files.

Report bugs and request features in the
[NotebookFlow issue tracker](https://github.com/NoelHuibers/notebookflow/issues).

## License

MIT
