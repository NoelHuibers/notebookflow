/**
 * Portable account-export shape shared by the server endpoint and browser ZIP
 * builder. Authentication credentials are deliberately represented only by
 * metadata: session/OAuth tokens and the encrypted BYOK value are secrets, not
 * useful portability data.
 */

export interface AccountExportUser {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AccountExportConnection {
  id: string;
  accountId: string;
  providerId: string;
  scope: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AccountExportSession {
  id: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  ipAddress: string | null;
  userAgent: string | null;
}

export interface AccountExportNotebook {
  id: string;
  name: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface AccountExportProviderKey {
  provider: string;
  model: string;
  createdAt: string;
  updatedAt: string;
  secretIncluded: false;
}

export interface AccountDataExport {
  version: 1;
  exportedAt: string;
  account: AccountExportUser;
  connections: AccountExportConnection[];
  sessions: AccountExportSession[];
  notebooks: AccountExportNotebook[];
  providerKey: AccountExportProviderKey | null;
  excludedSecrets: string[];
}
