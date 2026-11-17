/** One person's identity on `main`: the issuer and the external identifier together (ADR-0032 decision 2; ADR-0067 decision 1). */
export const identityKey = (user: Record<string, unknown>): string => `${typeof user.issuer === 'string' ? user.issuer : ''}\n${String(user.externalId ?? '')}`;
