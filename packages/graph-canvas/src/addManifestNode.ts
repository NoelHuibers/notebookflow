import { renderManifestTemplate } from "./manifestTemplate";
import type { NodeManifestDef, NodeSynthesisRequest, NodeSynthesisResponse } from "./node-config";
import { defaultConfigForManifest, writeNotebookflowMetadata } from "./node-config";
import type { SyncEngine } from "./sync/SyncEngine";

export interface AddManifestNodeOptions {
  manifest: NodeManifestDef;
  notebookPath: string;
  insertAtCellIndex: number;
  config?: Record<string, string>;
  /** Called when background LLM synthesis fails after the placeholder cell was inserted. */
  onSynthesisError?: (error: unknown) => void;
}

export type SynthesizeNodeFn = (request: NodeSynthesisRequest) => Promise<NodeSynthesisResponse>;

/**
 * Insert a palette node immediately using the manifest template, then — for
 * LLM-backed manifests — synthesize the real body in the background.
 */
export async function addManifestNode(
  engine: SyncEngine,
  synthesize: SynthesizeNodeFn,
  options: AddManifestNodeOptions,
): Promise<string> {
  const config = options.config ?? defaultConfigForManifest(options.manifest);
  const outputNames = options.manifest.outputs.map((port) => port.name);
  const bodySource = renderManifestTemplate(options.manifest, {
    nodeName: options.manifest.name,
    inputVars: [],
    outputVars: outputNames,
    config,
  });
  const metadata = writeNotebookflowMetadata(undefined, {
    manifestId: options.manifest.id,
    manifestVersion: options.manifest.version,
    config,
  });

  await engine.createNode(
    options.notebookPath,
    {
      name: options.manifest.name,
      tag: options.manifest.tag,
      outputs: outputNames,
      bodySource,
      metadata,
      insertAtCellIndex: options.insertAtCellIndex,
    },
    Date.now(),
  );

  const nodeId = `${options.notebookPath}::${String(options.insertAtCellIndex)}`;

  if (options.manifest.generationMode === "llm") {
    void synthesize({
      manifestId: options.manifest.id,
      nodeName: options.manifest.name,
      inputs: [],
      outputs: outputNames,
      config,
      currentSource: bodySource,
    })
      .then(async (result) => {
        await waitForGraphNode(engine, nodeId);
        await engine.updateNodeContents(
          nodeId,
          {
            bodySource: result.source,
            metadata: writeNotebookflowMetadata(metadata, {
              lastGeneratedAt: new Date().toISOString(),
              lastGenerationBackend: result.backend,
            }),
          },
          Date.now(),
        );
      })
      .catch((err: unknown) => {
        options.onSynthesisError?.(err);
      });
  }

  return nodeId;
}

async function waitForGraphNode(engine: SyncEngine, nodeId: string): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (engine.getGraph().nodes[nodeId] !== undefined) {
      return;
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 16);
    });
  }
  throw new Error(`addManifestNode: node ${JSON.stringify(nodeId)} not found after insert`);
}
