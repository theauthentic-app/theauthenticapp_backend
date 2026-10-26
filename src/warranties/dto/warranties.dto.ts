import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class RegisterWarrantyDto {
  @ApiProperty()
  @IsString()
  identityId!: string;
}
