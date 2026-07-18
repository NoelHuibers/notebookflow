import { createFileRoute } from "@tanstack/react-router";

import { LegalPageLayout } from "@/components/LegalPlaceholder";
import { PrivacyPolicy } from "@/components/legal/PrivacyPolicy";

export const Route = createFileRoute("/legal/datenschutz")({
  component: () => (
    <LegalPageLayout page="datenschutz">
      <PrivacyPolicy />
    </LegalPageLayout>
  ),
});
