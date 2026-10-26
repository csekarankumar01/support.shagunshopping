import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { SlaService } from './sla.service.js';

@Module({
  imports: [DatabaseModule],
  providers: [SlaService],
  exports: [SlaService],
})
export class SlaModule {}
