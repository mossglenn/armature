import { NextResponse } from 'next/server';
import { createGetHandler, handleTerminusError } from '@/lib/routeHelpers';
import client from '@/lib/terminusdb';
import type { Module } from '@/lib/types';
import {
  validateString,
  validateOptionalString,
  validateReference,
  validatePositiveInt,
  ValidationError,
  MAX_LENGTH,
} from '@/lib/validate';

export const GET = createGetHandler('Module');

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const label       = validateString(body.label, 'label');
    const description = validateOptionalString(body.description, 'description', MAX_LENGTH.description);
    const courseId    = validateReference(body.courseId, 'courseId');
    const sequence    = validatePositiveInt(body.sequence, 'sequence');

    const doc: Omit<Module, '@id'> = {
      '@type': 'Module',
      label,
      ...(description ? { description } : {}),
      ...(sequence !== undefined ? { sequence } : {}),
      course: courseId,
    };

    const result = await client.addDocument(doc);
    const id = Array.isArray(result) ? result[0] : result;

    return NextResponse.json({ id, ...doc }, { status: 201 });
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return handleTerminusError(error, 'create Module');
  }
}
