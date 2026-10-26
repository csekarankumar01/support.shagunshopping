export const ROLES = ['ADMIN', 'AGENT', 'CUSTOMER'] as const;
export type Role = (typeof ROLES)[number];
