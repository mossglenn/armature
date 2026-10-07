import { WOQLClient } from 'terminusdb';

const client = new WOQLClient(process.env.TERMINUS_URL!, {
    user: process.env.TERMINUS_USER!,
    key: process.env.TERMINUS_PASS!,
    organization: 'admin',
});

client.db(process.env.TERMINUS_DB!);

export default client;
