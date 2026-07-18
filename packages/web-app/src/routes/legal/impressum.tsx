import { createFileRoute } from "@tanstack/react-router";

import { LegalPageLayout } from "@/components/LegalPlaceholder";
import { ImprintContent } from "@/components/legal/ImprintContent";

export const Route = createFileRoute("/legal/impressum")({
  component: () => (
    <LegalPageLayout page="impressum">
      <ImprintContent />
    </LegalPageLayout>
  ),
});
