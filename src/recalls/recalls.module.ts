import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { RecallsController } from './recalls.controller';
import { RecallsService } from './recalls.service';

@Module({
  imports: [AuditModule, NotificationsModule],
  controllers: [RecallsController],
  providers: [RecallsService],
})
export class RecallsModule {}
