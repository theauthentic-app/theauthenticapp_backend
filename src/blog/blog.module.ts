import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { BlogController } from './blog.controller';
import { BlogService } from './blog.service';

@Module({
  imports: [AuditModule],
  controllers: [BlogController],
  providers: [BlogService],
})
export class BlogModule {}
