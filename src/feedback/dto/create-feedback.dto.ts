import { IsString, IsEmail, IsEnum, IsOptional, MinLength, MaxLength } from 'class-validator';
import { FeedbackType } from 'entities/global.entity';

export class CreateFeedbackDto {
  @IsEnum(FeedbackType)
  type: FeedbackType;

  @IsString()
  @MinLength(3, { message: 'Title must be at least 3 characters long' })
  @MaxLength(255, { message: 'Title must not exceed 255 characters' })
  title: string;

  @IsString()
  @MinLength(10, { message: 'Description must be at least 10 characters long' })
  description: string;

  @IsOptional()
  @IsEmail({}, { message: 'Invalid email format' })
  email?: string | null;
}
