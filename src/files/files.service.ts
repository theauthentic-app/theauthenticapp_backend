import { Injectable } from '@nestjs/common';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { mkdir, readFile, unlink, writeFile } from 'fs/promises';
import { join } from 'path';
import { publicId } from '../common/utils/crypto.util';
import { PrismaService } from '../database/prisma.service';
import { FilePurpose } from '@prisma/client';
import { AppError } from '../common/errors/app-error';
import { env } from '../common/utils/env.util';

const ALLOWED = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
]);
const MAX_BYTES = 8 * 1024 * 1024;

@Injectable()
export class FilesService {
  private r2?: S3Client;

  constructor(private readonly prisma: PrismaService) {
    this.r2 = this.createR2Client();
  }

  provider(): string {
    const explicit = (env('STORAGE_PROVIDER') ?? '').toLowerCase();
    if (explicit) return explicit;
    if (
      env('R2_ACCOUNT_ID') &&
      env('R2_ACCESS_KEY_ID') &&
      env('R2_SECRET_ACCESS_KEY') &&
      (env('R2_BUCKET') ?? env('STORAGE_BUCKET'))
    ) {
      return 'r2';
    }
    return 'local';
  }

  async store(input: {
    buffer: Buffer;
    mimeType: string;
    originalName: string;
    purpose: FilePurpose;
    organizationId?: string;
  }) {
    if (!ALLOWED.has(input.mimeType.toLowerCase())) {
      throw new AppError('INVALID_FILE', 'That file type is not allowed.', 400);
    }
    if (input.buffer.length > MAX_BYTES) {
      throw new AppError('FILE_TOO_LARGE', 'File exceeds the 8MB limit.', 400);
    }
    const ext = extensionFor(input.mimeType, input.originalName);
    const key = `${input.purpose.toLowerCase()}/${publicId('file')}${ext}`;
    const provider = this.provider();

    if (provider === 'r2' || provider === 's3') {
      await this.putR2(key, input.buffer, input.mimeType);
    } else {
      const root = env('STORAGE_LOCAL_DIR') ?? './storage';
      const full = join(root, key);
      await mkdir(join(full, '..'), { recursive: true });
      await writeFile(full, input.buffer);
    }

    const file = await this.prisma.storedFile.create({
      data: {
        organizationId: input.organizationId,
        purpose: input.purpose,
        key,
        mimeType: input.mimeType,
        sizeBytes: input.buffer.length,
        originalName: input.originalName,
      },
    });
    return this.toPublic(file);
  }

  async remove(key: string) {
    const provider = this.provider();
    if (provider === 'r2' || provider === 's3') {
      const client = this.requireR2();
      const bucket = env('R2_BUCKET') ?? env('STORAGE_BUCKET');
      if (!bucket) {
        throw new AppError(
          'STORAGE_UNAVAILABLE',
          'R2_BUCKET is not configured.',
          503,
        );
      }
      await client.send(
        new DeleteObjectCommand({
          Bucket: bucket,
          Key: key,
        }),
      );
    } else {
      const root = env('STORAGE_LOCAL_DIR') ?? './storage';
      await unlink(join(root, key)).catch(() => undefined);
    }
    await this.prisma.storedFile.deleteMany({ where: { key } });
  }

  publicUrl(key: string): string | null {
    const base = (
      env('R2_PUBLIC_BASE_URL') ??
      env('STORAGE_PUBLIC_BASE_URL') ??
      ''
    ).replace(/\/$/, '');
    if (!base) return null;
    return `${base}/${key}`;
  }

  toPublic(file: { id: string; key: string; mimeType: string; sizeBytes: number; originalName: string; purpose: FilePurpose }) {
    const cdn = this.publicUrl(file.key);
    const api = (env('API_BASE_URL') ?? 'http://localhost:3001').replace(
      /\/$/,
      '',
    );
    return {
      id: file.id,
      key: file.key,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      originalName: file.originalName,
      purpose: file.purpose,
      url:
        cdn ??
        (file.purpose === FilePurpose.PRODUCT_IMAGE
          ? `${api}/api/v1/public/files/${file.id}`
          : null),
      cdn: Boolean(cdn),
    };
  }

  async publicImage(id: string) {
    const file = await this.prisma.storedFile.findUnique({ where: { id } });
    if (!file || file.purpose !== FilePurpose.PRODUCT_IMAGE) {
      throw new AppError('FILE_NOT_FOUND', 'Image not found.', 404);
    }
    return {
      file,
      buffer: await this.readBuffer(file.key),
    };
  }

  private async readBuffer(key: string): Promise<Buffer> {
    const provider = this.provider();
    if (provider === 'r2' || provider === 's3') {
      const client = this.requireR2();
      const bucket = env('R2_BUCKET') ?? env('STORAGE_BUCKET');
      if (!bucket) {
        throw new AppError(
          'STORAGE_UNAVAILABLE',
          'R2_BUCKET is not configured.',
          503,
        );
      }
      const object = await client.send(
        new GetObjectCommand({ Bucket: bucket, Key: key }),
      );
      const bytes = await object.Body?.transformToByteArray();
      if (!bytes) {
        throw new AppError('FILE_NOT_FOUND', 'Image not found.', 404);
      }
      return Buffer.from(bytes);
    }
    const root = env('STORAGE_LOCAL_DIR') ?? './storage';
    return readFile(join(root, key));
  }

  private async putR2(key: string, body: Buffer, mimeType: string) {
    const client = this.requireR2();
    const bucket = env('R2_BUCKET') ?? env('STORAGE_BUCKET');
    if (!bucket) {
      throw new AppError(
        'STORAGE_UNAVAILABLE',
        'R2_BUCKET is not configured.',
        503,
      );
    }
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: mimeType,
      }),
    );
  }

  private requireR2() {
    if (!this.r2) {
      throw new AppError(
        'STORAGE_UNAVAILABLE',
        'Cloudflare R2 is not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET.',
        503,
      );
    }
    return this.r2;
  }

  private createR2Client(): S3Client | undefined {
    const accountId = env('R2_ACCOUNT_ID');
    const accessKeyId = env('R2_ACCESS_KEY_ID');
    const secretAccessKey = env('R2_SECRET_ACCESS_KEY');
    const endpoint =
      env('R2_ENDPOINT') ??
      (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : undefined);
    if (!endpoint || !accessKeyId || !secretAccessKey) return undefined;
    return new S3Client({
      region: env('R2_REGION') ?? 'auto',
      endpoint,
      credentials: { accessKeyId, secretAccessKey },
    });
  }
}

function extensionFor(mimeType: string, originalName: string): string {
  const fromName = originalName.includes('.')
    ? originalName.slice(originalName.lastIndexOf('.')).toLowerCase()
    : '';
  if (fromName && fromName.length <= 8) return fromName;
  const map: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'application/pdf': '.pdf',
  };
  return map[mimeType.toLowerCase()] ?? '';
}
