import type { AuthenticatedUser } from '../auth/verify-token.js';
import { DatabaseService } from '../database/database.service.js';

/**
 * The single rule for "may this user see this ticket": it is in their own organisation and, for a customer, it
 * is their own ticket. The REST API and the WebSocket gateway both ask this function, so they cannot disagree.
 */
export async function canAccessTicket(
  db: DatabaseService,
  user: AuthenticatedUser,
  ticketId: string,
): Promise<boolean> {
  const params: unknown[] = [ticketId];
  let ownerFilter = '';
  if (user.role === 'CUSTOMER') {
    params.push(user.userId);
    ownerFilter = 'AND requester_id = $3';
  }
  const { rowCount } = await db.tenantQuery(
    user.orgId,
    `SELECT 1 FROM tickets WHERE org_id = $1 AND id = $2 ${ownerFilter}`,
    params,
  );
  return !!rowCount;
}
