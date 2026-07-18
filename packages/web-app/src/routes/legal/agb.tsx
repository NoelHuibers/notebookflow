import { createFileRoute } from "@tanstack/react-router";

import { LegalPageLayout } from "@/components/LegalPlaceholder";
import { TermsOfService } from "@/components/legal/TermsOfService";

export const Route = createFileRoute("/legal/agb")({
  component: () => (
    <LegalPageLayout page="agb">
      <TermsOfService />
    </LegalPageLayout>
  ),
});
