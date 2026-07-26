# Demo recording setup

## Assets

- Upload `examples/demo_customer_revenue.csv` in the deployed app.
- Import `examples/preprocessing.ipynb`, `examples/model_baseline.ipynb`,
  `examples/model_advanced.ipynb`, and `examples/postprocessing.ipynb` when
  prompted by the recording flow.

The fixture has 192 rows and the external-input schema required by preprocessing:
`date`, `channel`, `region`, `visitors`, `ad_spend`, `discount`,
`competitor_index`, and `revenue`. Its final `ad_spend` value is deliberately
empty, so the existing missing-value handling is visible but the pipeline
still completes.

## Recording flow

1. Begin with one empty notebook.
2. Upload `demo_customer_revenue.csv`, choose **Add data node**, and leave the
   generated `Load demo_customer_revenue` node on the canvas.
3. Add the **Filter Rows** building block. Wire the CSV reader to its `df`
   input, then set its condition to `visitors >= 1500`. This focuses the
   forecast on campaign days with enough traffic to make a reliable prediction,
   while retaining every acquisition channel and the full required schema.
4. Import `preprocessing.ipynb`. Its `Validate customer data` node intentionally
   displays the `raw_df` inlet but has no resolved upstream wire yet. Draw the
   data-preparation output to that inlet. This replaces the placeholder input
   reference and persists the real connection in the notebook.
5. Import the two model notebooks and `postprocessing.ipynb`. Wire
   `Train test split` to both model notebooks, then wire both score/prediction
   outputs into postprocessing. Use the port labels already shown on the
   canvas; do not pre-wire these notebooks before the recording.
6. Run the full pipeline. The final `Analyst report` node prints a recommended
   model, a comparison table, and an actual-versus-predicted chart.
7. Open the AI command palette and select **Explain**. Ask: “Explain this
   pipeline for a new analyst: its data flow, transformations, models, and
   final output.”
8. Open **Triggers**, create a **Manual** trigger named `demo-revenue-run`,
   then use **Fire now**. This is the most reliable live trigger demonstration;
   mention that the same dialog also supports Cron, file-watch, and webhook
   triggers.

## Pre-recording checks

- Use the deployed app while signed in and confirm that its engine is healthy.
- Upload the fixture once and complete this exact flow in a fresh workspace.
- Delete any test triggers before recording; leave only `demo-revenue-run`.
- Do not use a file-watch trigger for the live run: it depends on a server-side
  path and is less predictable than the manual trigger in a recording.
