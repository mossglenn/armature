import { check, words } from '../hub';

export const dynamic = 'force-dynamic';

export default async function Page() {
  return <p>{await check()} {words()}</p>;
}
