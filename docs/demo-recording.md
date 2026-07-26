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
3. Add the **Filter Rows** building block. Set its condition to
   `visitors >= 1500`, then wire the CSV reader to its visible `df` input. This
   focuses the forecast on campaign days with enough traffic to make a reliable
   prediction while retaining every acquisition channel and the full required
   schema.
4. Create one node with AI: “Create a transform node named `Add traffic tier`.
   It receives a pandas DataFrame named `df`, copies it, adds an integer column
   `high_traffic` that is 1 when `visitors >= 2500` and 0 otherwise, and outputs
   the resulting DataFrame as `raw_df`. Preserve every existing column and do
   not filter rows.” Wire `Filter Rows.df` to this node and its `raw_df` output
   onward. The preprocessing notebook includes this optional feature when it is
   present, so the AI-created step affects the model rather than being cosmetic.
5. Add a final code cell to the first notebook to preview the prepared data:
   ```python
   # @node: Preview prepared data [output] in=raw_df<-Add traffic tier.raw_df
   display(raw_df.head(10))
   ```
   Draw `Add traffic tier.raw_df` to the preview node. This gives the audience
   a concrete look at the filtered, enriched DataFrame before reuse begins.
6. Hover the first notebook in **Files**, select its pencil icon, and rename it
   to `campaign_preparation.ipynb`. NotebookFlow updates cross-notebook
   references when a notebook is renamed.
7. Press **M** to show the minimap. After importing or moving notebooks, use
   the canvas **fit view** control to frame the whole pipeline.
8. Import `preprocessing.ipynb`. Its `Validate customer data` node intentionally
   displays the `raw_df` inlet but has no resolved upstream wire yet. Draw the
   data-preparation output to that inlet. This replaces the placeholder input
   reference and persists the real connection in the notebook.
9. Import the two model notebooks and `postprocessing.ipynb`. Wire
   `Train test split` to both model notebooks, then wire both score/prediction
   outputs into postprocessing. Use the port labels already shown on the
   canvas; do not pre-wire these notebooks before the recording.
10. Run the full pipeline. The final `Analyst report` node prints a recommended
   model, a comparison table, and an actual-versus-predicted chart.
11. Open the AI command palette and select **Explain**. Ask: “Explain this
   pipeline for a new analyst: its data flow, transformations, models, and
   final output.”
12. Open **Triggers**, create a **Manual** trigger named `demo-revenue-run`,
   then use **Fire now**. This is the most reliable live trigger demonstration;
   mention that the same dialog also supports Cron, file-watch, and webhook
   triggers.

## Pre-recording checks

- Use the deployed app while signed in and confirm that its engine is healthy.
- Upload the fixture once and complete this exact flow in a fresh workspace.
- Delete any test triggers before recording; leave only `demo-revenue-run`.
- Do not use a file-watch trigger for the live run: it depends on a server-side
  path and is less predictable than the manual trigger in a recording.
