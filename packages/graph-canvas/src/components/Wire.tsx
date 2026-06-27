/**
 * Wire — custom React Flow edge for an outlet-to-inlet connection.
 *
 * Distinguishes intra-notebook wires (thin solid) from cross-notebook wires
 * (thick dashed) so users can read pipeline structure at a glance. The
 * Canvas tags each edge's `data.crossNotebook` based on whether the source
 * and target nodes belong to the same NodeGroup.
 */

import type { ReactElement } from "react";
import type { EdgeProps } from "reactflow";
import { BaseEdge, getBezierPath } from "reactflow";

export interface WireData {
  crossNotebook: boolean;
}

export function Wire(props: EdgeProps<WireData>): ReactElement {
  const [edgePath] = getBezierPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    sourcePosition: props.sourcePosition,
    targetX: props.targetX,
    targetY: props.targetY,
    targetPosition: props.targetPosition,
  });

  const crossNotebook = props.data?.crossNotebook ?? false;
  const style = {
    stroke: crossNotebook ? "#7c3aed" : "#1f2937",
    strokeWidth: crossNotebook ? 2.5 : 1.5,
    strokeDasharray: crossNotebook ? "6 4" : undefined,
    ...props.style,
  };

  const markerEndProps =
    props.markerEnd === undefined ? {} : ({ markerEnd: props.markerEnd } as const);
  return <BaseEdge id={props.id} path={edgePath} style={style} {...markerEndProps} />;
}
