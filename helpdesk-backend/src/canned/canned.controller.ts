import {
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { AuthModule } from '../auth/auth.module.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import type { AuthenticatedUser } from '../auth/jwt-auth.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { DatabaseModule } from '../database/database.module.js';
import { DatabaseService } from '../database/database.service.js';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateCannedDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  title!: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  body!: string;
}

export class UpdateCannedDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  title?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  body?: string;
}

const COLUMNS = `id, title, body, created_at AS "createdAt", updated_at AS "updatedAt"`;
const PG_UNIQUE_VIOLATION = '23505';

/** Reusable reply texts for the staff of one organisation. Customers never see them. */
@Controller('api/v1/canned-responses')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'AGENT')
export class CannedController {
  constructor(private readonly db: DatabaseService) {}

  @Get()
  async list(@CurrentUser() user: AuthenticatedUser) {
    const { rows } = await this.db.tenantQuery(
      user.orgId,
      `SELECT ${COLUMNS} FROM canned_responses WHERE org_id = $1 ORDER BY lower(title)`,
    );
    return rows;
  }

  @Post()
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateCannedDto,
  ) {
    try {
      const { rows } = await this.db.tenantQuery(
        user.orgId,
        `INSERT INTO canned_responses (org_id, title, body, created_by)
         VALUES ($1, $2, $3, $4) RETURNING ${COLUMNS}`,
        [dto.title, dto.body, user.userId],
      );
      return rows[0];
    } catch (err) {
      throw this.translate(err);
    }
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCannedDto,
  ) {
    try {
      const { rows } = await this.db.tenantQuery(
        user.orgId,
        `UPDATE canned_responses
            SET title = COALESCE($3, title), body = COALESCE($4, body), updated_at = now()
          WHERE org_id = $1 AND id = $2 RETURNING ${COLUMNS}`,
        [id, dto.title ?? null, dto.body ?? null],
      );
      if (!rows[0]) throw new NotFoundException('Canned response not found');
      return rows[0];
    } catch (err) {
      throw this.translate(err);
    }
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const { rowCount } = await this.db.tenantQuery(
      user.orgId,
      'DELETE FROM canned_responses WHERE org_id = $1 AND id = $2',
      [id],
    );
    if (!rowCount) throw new NotFoundException('Canned response not found');
  }

  private translate(err: unknown) {
    if ((err as { code?: string }).code === PG_UNIQUE_VIOLATION) {
      return new ConflictException(
        'A canned response with this title already exists',
      );
    }
    return err;
  }
}

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [CannedController],
})
export class CannedModule {}
