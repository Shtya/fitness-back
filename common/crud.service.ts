import { Response } from 'express';
import * as ExcelJS from 'exceljs';
import { Repository, Brackets, SelectQueryBuilder } from 'typeorm';
import { BadRequestException } from '@nestjs/common';

export interface CustomPaginatedResponse<T> {
  total_records: number;
  current_page: number;
  per_page: number;
  records: T[];
}

export class CRUD {
  static async findAll<T>(repository: Repository<T>, entityName: string, search?: string, page: any = 1, limit: any = 10, sortBy?: string, sortOrder: 'ASC' | 'DESC' = 'DESC', relations?: string[], searchFields?: string[], filters?: Record<string, any>): Promise<CustomPaginatedResponse<T>> {
    const pageNumber = Number(page) || 1;
    const limitNumber = Number(limit) || 10;

    if (isNaN(pageNumber) || isNaN(limitNumber) || pageNumber < 1 || limitNumber < 1) {
      throw new BadRequestException('Pagination parameters must be valid numbers greater than 0.');
    }

    if (!['ASC', 'DESC'].includes(sortOrder)) {
      throw new BadRequestException("Sort order must be either 'ASC' or 'DESC'.");
    }

    const skip = (pageNumber - 1) * limitNumber;
    const query = repository.createQueryBuilder(entityName).skip(skip).take(limitNumber);

    function flatten(obj: any, prefix = ''): Record<string, any> {
      let result: Record<string, any> = {};
      Object.entries(obj).forEach(([key, value]) => {
        const prefixedKey = prefix ? `${prefix}.${key}` : key;
        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
          Object.assign(result, flatten(value, prefixedKey));
        } else {
          result[prefixedKey] = value;
        }
      });
      return result;
    }

    if (filters && Object.keys(filters).length > 0) {
      const flatFilters = flatten(filters);
      Object.entries(flatFilters).forEach(([flatKey, value]) => {
        if (value !== null && value !== undefined && value !== '') {
          const paramKey = flatKey.replace(/\./g, '_');
          query.andWhere(`${entityName}.${flatKey} = :${paramKey}`, {
            [paramKey]: value,
          });
        }
      });
    }

    if (search && searchFields?.length >= 1) {
      query.andWhere(
        new Brackets(qb => {
          searchFields.forEach(field => {
            const col = repository.metadata.columns.find(c => c.propertyName === field);
            const typeStr = String(col?.type || '').toLowerCase();

            // Enums: only exact match (don’t throw if not matched; let other fields try)
            if (col?.enum && Array.isArray(col.enum)) {
              if (col.enum.includes(search)) {
                qb.orWhere(`${entityName}.${field} = :enumVal`, { enumVal: search });
              }
              return;
            }

            // Numbers: try exact compare if the search is numeric
            const isNumericType = ['int', 'int2', 'int4', 'int8', 'integer', 'bigint', 'smallint', 'numeric', 'decimal', 'float', 'float4', 'float8', 'double precision', Number].includes(col?.type as any);

            if (isNumericType) {
              const n = Number(search);
              if (!Number.isNaN(n)) {
                qb.orWhere(`${entityName}.${field} = :n`, { n });
              }
              return;
            }

            // JSON/JSONB → cast to text + ILIKE
            if (typeStr === 'jsonb' || typeStr === 'json') {
              qb.orWhere(`${entityName}.${field}::text ILIKE :s`, { s: `%${search}%` });
              return;
            }

            // Default: cast to text and ILIKE (covers varchar/text/char/uuid/date…)
            qb.orWhere(`${entityName}.${field}::text ILIKE :s`, { s: `%${search}%` });
          });
        }),
      );
    }

    // if (relations?.length > 0) {
    //   const invalidRelations = relations.filter(relation => !repository.metadata.relations.some(rel => rel.propertyName === relation));
    //   if (invalidRelations.length > 0) {
    //     throw new BadRequestException(`Invalid relations: ${invalidRelations.join(', ')}`);
    //   }
    //   relations.forEach(relation => {
    //     query.leftJoinAndSelect(`${entityName}.${relation}`, relation);
    //   });
    // }
    if (relations?.length) {
      CRUD.joinNestedRelations(query, repository, entityName, relations);
    }

    const defaultSortBy = 'created_at';
    const sortField = sortBy || defaultSortBy;
    const sortDirection = sortOrder || 'DESC';

    const columnExists = repository.metadata.columns.some(col => col.propertyName === sortField);
    if (!columnExists) {
      throw new BadRequestException(`Invalid sortBy field: '${sortField}'`);
    }

    query.orderBy(`${entityName}.${sortField}`, sortDirection);

    const [data, total] = await query.getManyAndCount();

    return {
      total_records: total,
      current_page: pageNumber,
      per_page: limitNumber,
      records: data,
    };
  }

  static joinNestedRelations<T>(query: SelectQueryBuilder<T>, repository: Repository<T>, rootAlias: string, relations: string[]) {
    const addedAliases = new Set<string>();

    function validatePathAndReturnJoins(path: string) {
      const segments = path.split('.');
      let currentMeta = repository.metadata;
      let parentAlias = rootAlias;
      const steps: { joinPath: string; alias: string }[] = [];
      let aliasPath = rootAlias;

      for (const seg of segments) {
        const relMeta = currentMeta.relations.find(r => r.propertyName === seg);
        if (!relMeta) {
          throw new BadRequestException(`Invalid relation segment '${seg}' in '${path}'`);
        }
        const joinPath = `${parentAlias}.${seg}`;
        const alias = (aliasPath + '_' + seg).replace(/\./g, '_');
        steps.push({ joinPath, alias });

        parentAlias = alias;
        aliasPath = alias;
        currentMeta = relMeta.inverseEntityMetadata;
      }
      return steps;
    }

    for (const path of relations) {
      const steps = validatePathAndReturnJoins(path);
      for (const { joinPath, alias } of steps) {
        if (!addedAliases.has(alias)) {
          query.leftJoinAndSelect(joinPath, alias);
          addedAliases.add(alias);
        }
      }
    }
  }

  static async delete<T>(repository: Repository<T>, entityName: string, id: number | string): Promise<{ message: string }> {
    const entity = await repository.findOne({ where: { id } as any });

    if (!entity) {
      throw new BadRequestException(`${entityName} with ID ${id} not found.`);
    }

    await repository.delete(id);

    return {
      message: `${entityName} deleted successfully.`,
    };
  }

  static async softDelete<T>(repository: Repository<T>, entityName: string, id: number | string): Promise<{ message: string }> {
    const entity = await repository.findOne({ where: { id } as any });

    if (!entity) {
      throw new BadRequestException(`${entityName} with ID ${id} not found.`);
    }

    await repository.softDelete(id);

    return {
      message: `${entityName} soft-deleted successfully.`,
    };
  }

  static async findOne<T>(repository: Repository<T>, entityName: string, id: number | string, relations?: string[]): Promise<T> {
    if (relations?.length > 0) {
      const invalidRelations = relations.filter(relation => !repository.metadata.relations.some(rel => rel.propertyName === relation));
      if (invalidRelations.length > 0) {
        throw new BadRequestException(`Invalid relations: ${invalidRelations.join(', ')}`);
      }
    }

    const entity = await repository.findOne({
      where: { id } as any,
      relations: relations || [],
    });

    if (!entity) {
      throw new BadRequestException(`${entityName} with ID ${id} not found.`);
    }

    return entity;
  }

  static async exportEntityToExcel<T>(
    repository: Repository<T>,
    fileName: string,
    res: any,
    options: {
      exportLimit?: number | string;
      columns?: { header: string; key: string; width?: number }[];
    } = {},
  ) {
    const exportLimit = Number(options.exportLimit) || 10;

    const data = await repository.find({
      take: exportLimit,
    });

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Report');

    const columns =
      options.columns ??
      (data.length > 0
        ? Object.keys(data[0])
            .filter(key => key !== 'updated_at' && key !== 'deleted_at')
            .map(key => ({ header: key, key, width: 20 }))
        : []);

    worksheet.columns = columns;

    data.forEach(item => {
      const rowData: any = { ...item };
      delete rowData.updated_at;
      delete rowData.deleted_at;

      const row = worksheet.addRow(rowData);

      row.eachCell(cell => {
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
      });
    });

    worksheet.getRow(1).eachCell(cell => {
      cell.font = { bold: true };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFCCCCCC' },
      };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
    });

    worksheet.columns.forEach(column => {
      let maxLength = 10;
      column.eachCell({ includeEmpty: true }, cell => {
        const cellValue = cell.value ? cell.value.toString() : '';
        if (cellValue.length > maxLength) maxLength = cellValue.length;
      });
      column.width = maxLength + 2;
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=${fileName}.xlsx`);

    await workbook.xlsx.write(res);
    res.end();
  }
}
