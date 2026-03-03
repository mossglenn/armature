import { NextResponse } from 'next/server';
import { createGetHandler, handleTerminusError } from '@/lib/routeHelpers';
import client from '@/lib/terminusdb';
import type { Course } from '@/lib/types';
import { validateString, validateOptionalString, ValidationError, MAX_LENGTH } from '@/lib/validate';

export const GET = createGetHandler('Course');

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const label       = validateString(body.label, 'label');
    const description = validateOptionalString(body.description, 'description', MAX_LENGTH.description);

    const doc: Omit<Course, '@id'> = {
      '@type': 'Course',
      label,
      ...(description ? { description } : {}),
    };

    const result = await client.addDocument(doc);
    const id = Array.isArray(result) ? result[0] : result;

    return NextResponse.json({ id, ...doc }, { status: 201 });
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return handleTerminusError(error, 'create Course');
  }
}
