import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { PresenceModule } from '../presence/presence.module.js';
import { SupportGateway } from './support.gateway.js';

// Deliberately imports nothing from the tickets or comments modules: they import this one to publish,
// and the access rule the gateway needs is a plain function (tickets/ticket-access.ts), not a service.
@Module({
  imports: [AuthModule, DatabaseModule, PresenceModule],
  providers: [SupportGateway],
  exports: [SupportGateway],
})
export class RealtimeModule {}
