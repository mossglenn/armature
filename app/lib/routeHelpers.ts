import { NextResponse } from 'next/server';
import client from '@/lib/terminusdb';

export function createGetHandler(type: string) {
    return async function GET() {
        try {
            const result = await client.getDocument({ type, as_list: true });
            return NextResponse.json(result);
        } catch (error) {
            console.error(`TerminusDB error fetching ${type}: `, error);
            return NextResponse.json(
                { error: `Failed to fetch ${type}` },
                { status: 500 }
            );
        }
    };
}
