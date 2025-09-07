// src/utils/entity.utils.ts
import { NotFoundException } from '@nestjs/common';

export async function checkEntityExists ( repository: { findOne: (options: any) => Promise<any> }, id: number, message: string )  
{
  const entity = await repository.findOne({ where: { id } });
  if (!entity) {
    throw new NotFoundException(message);
  }
  return entity;
}