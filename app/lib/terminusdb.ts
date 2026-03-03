import { WOQLClient } from '@terminusdb/terminusdb-client';

const client = new WOQLClient(process.env.TERMINUS_URL!, {
    user: process.env.TERMINUS_USER!,
    key: process.env.TERMINUS_PASS!,
    organization: 'admin',
});

client.db(process.env.TERMINUS_DB!);

export default client;
