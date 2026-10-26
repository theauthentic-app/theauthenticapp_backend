import { Module } from '@nestjs/common';
import { FilesController, PublicFilesController } from './files.controller';
import { FilesService } from './files.service';

@Module({
  controllers: [FilesController, PublicFilesController],
  providers: [FilesService],
  exports: [FilesService],
})
export class FilesModule {}
