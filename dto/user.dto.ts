import {
  IsString,
  IsEmail,
  IsOptional,
  IsNotEmpty,
  IsEnum,
  ArrayNotEmpty,
  ValidateNested,
} from 'class-validator';
import { PartialType } from '@nestjs/mapped-types';
import { Type } from 'class-transformer';
import { UserRole } from 'entities/global.entity';

 
export class CreateUserDto {
  // name?: string;
  // @IsEmail({}, { message: 'Invalid email format' })
  // @IsNotEmpty({ message: 'Email is required' })
  @IsString({ message: 'Name must be a string' })
  email: string;

  @IsString({ message: 'Password must be a string' })
  @IsNotEmpty({ message: 'Password is required' })
  password: string;

  @IsOptional()
  @IsEnum(UserRole, {
    message: `Role must be one of: ${Object.values(UserRole).join(', ')}`,
  })
  role?: UserRole = UserRole.CLIENT;

  @IsNotEmpty()
  projectId: number; //
}



export class CreateUserBulkRequestDto {
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => CreateUserBulkDto)
  users: CreateUserBulkDto[];
}

export class CreateUserBulkDto {
  @IsNotEmpty()
  email: string;

  @IsNotEmpty({ message: 'Password is required' })
  @IsString()
  password: string;

  @IsNotEmpty({ message: 'Role is required' })
  @IsString()
  role: string;

  @IsNotEmpty({ message: 'Project name is required' })
  @IsString()
  projectName: string;
}

export class UpdateUserDto extends PartialType(CreateUserDto) {}