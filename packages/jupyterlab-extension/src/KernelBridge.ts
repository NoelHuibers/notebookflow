/**
 * KernelBridge — runs node code via the active JupyterLab kernel.
 *
 * Lets users execute a single node (or a whole pipeline) using the same
 * kernel session their notebook is already using, so variables/imports
 * stay live across runs.
 */

import type { Kernel } from "@jupyterlab/services";

export class KernelBridge {
  constructor(_kernel: Kernel.IKernelConnection) {
    // TODO: store kernel ref, expose execute(nodeId) that pulls cell
    //   source for the node and dispatches via kernel.requestExecute.
  }

  async executeNode(_nodeId: string): Promise<void> {
    throw new Error("KernelBridge.executeNode: not implemented");
  }
}
