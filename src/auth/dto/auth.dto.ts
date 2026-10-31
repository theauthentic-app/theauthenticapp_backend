import {
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RegisterDto {
  @ApiProperty()
  @IsEmail()
  email!: string;

  @ApiProperty()
  @IsString()
  @MinLength(10)
  password!: string;

  @ApiProperty()
  @IsString()
  firstName!: string;

  @ApiProperty()
  @IsString()
  lastName!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({
    description: 'Create a manufacturer organization at registration',
  })
  @IsOptional()
  @IsString()
  organizationName?: string;
}

export class LoginDto {
  @ApiProperty()
  @IsEmail()
  email!: string;

  @ApiProperty()
  @IsString()
  password!: string;
}

export class RefreshDto {
  @ApiProperty()
  @IsString()
  refreshToken!: string;
}

export class ForgotPasswordDto {
  @ApiProperty()
  @IsEmail()
  email!: string;
}

export class ResetPasswordDto {
  @ApiPropertyOptional({
    description: 'Deep-link token from the reset email. Use this OR email+code.',
  })
  @ValidateIf((o: ResetPasswordDto) => !o.code)
  @IsString()
  token?: string;

  @ApiPropertyOptional({
    description: 'Account email (required when resetting with a 6-digit code).',
  })
  @ValidateIf((o: ResetPasswordDto) => Boolean(o.code) && !o.token)
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({
    description: '6-digit code from the reset email.',
    example: '482910',
  })
  @ValidateIf((o: ResetPasswordDto) => !o.token)
  @IsString()
  @Matches(/^\d{6}$/, { message: 'code must be exactly 6 digits' })
  code?: string;

  @ApiProperty()
  @IsString()
  @MinLength(10)
  password!: string;
}

export class VerifyEmailDto {
  @ApiPropertyOptional({
    description:
      'Deep-link token from the verification email URL. Use this OR email+code.',
  })
  @ValidateIf((o: VerifyEmailDto) => !o.code)
  @IsString()
  token?: string;

  @ApiPropertyOptional({
    description: 'Account email (required when verifying with a 6-digit code).',
  })
  @ValidateIf((o: VerifyEmailDto) => Boolean(o.code) && !o.token)
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({
    description: '6-digit code from the verification email.',
    example: '482910',
  })
  @ValidateIf((o: VerifyEmailDto) => !o.token)
  @IsString()
  @Matches(/^\d{6}$/, { message: 'code must be exactly 6 digits' })
  code?: string;
}
