import { createFileRoute } from "@tanstack/react-router";

import { LegalPlaceholder } from "@/components/LegalPlaceholder";

export const Route = createFileRoute("/legal/agb")({
  component: () => <LegalPlaceholder title="Nutzungsbedingungen (AGB)" />,
});
