import { createFileRoute } from "@tanstack/react-router";

import { LegalPlaceholder } from "@/components/LegalPlaceholder";

export const Route = createFileRoute("/legal/impressum")({
  component: () => <LegalPlaceholder page="impressum" />,
});
