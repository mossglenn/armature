import { check } from '../hub';

export const dynamic = 'force-dynamic';

export default async function Page() {
  return <p>{await check()}</p>;
}
