import { createFileRoute } from "@tanstack/react-router";

import { LegalPageLayout } from "@/components/LegalPlaceholder";
import { PrivacyStorageDisclosure } from "@/components/PrivacyStorageDisclosure";

export const Route = createFileRoute("/legal/datenschutz")({
  component: () => (
    <LegalPageLayout page="datenschutz">
      <PrivacyStorageDisclosure />
    </LegalPageLayout>
  ),
});
