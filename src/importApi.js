import fetch from 'node-fetch';
import dotenv from 'dotenv';
import {
  ClientBuilder,
  createAuthForClientCredentialsFlow,
  createHttpClient
} from '@commercetools/sdk-client-v2';

import {
  createApiBuilderFromCtpClient,
} from '@commercetools/importapi-sdk';

dotenv.config({path : process.env.ENV_PATH || '../env/.env'});

const {
  CTP_PROJECT_KEY,
  CTP_CLIENT_SECRET,
  CTP_CLIENT_ID,
  CTP_AUTH_URL,
  CTP_API_URL,
  CTP_SCOPES,
} = process.env

const IMPORT_API_URL = CTP_API_URL.replace('api.','import.');

const projectKey = CTP_PROJECT_KEY;

const authMiddlewareOptions = {
  host: CTP_AUTH_URL,
  projectKey,
  credentials: {
    clientId: CTP_CLIENT_ID,
    clientSecret: CTP_CLIENT_SECRET,
  },
  oauthUri: '/oauth/token', // - optional: custom oauthUri
  scopes: CTP_SCOPES.split(' '),
  fetch,
}

const httpMiddlewareOptions = {
  host: IMPORT_API_URL,
  fetch,
}

const client = new ClientBuilder()
  .withProjectKey(projectKey)
  .withMiddleware(createAuthForClientCredentialsFlow(authMiddlewareOptions))
  .withMiddleware(createHttpClient(httpMiddlewareOptions))
  .withUserAgentMiddleware()
  .build()

export const importApiRoot = createApiBuilderFromCtpClient(client).withProjectKeyValue({ projectKey });

// Create container if doesn't exist.
export async function ensureImportContainer(key,resourceType) {
  try {
    console.log('Checking for container',key);
    const res = await importApiRoot
      .importContainers()
      .withImportContainerKeyValue({importContainerKey: key})
      .get()
      .execute()
    console.log(res.statusCode);
  } catch(err) {
    console.log('Creating import container',key,'for resource type',resourceType)
    const res = await importApiRoot.importContainers().post({
      body: {
        key,
        resourceType
      }
    }).execute();
    console.log(res);
    if(res.statusCode == 201) {
      console.log('Import container creation taking a while...');
    }
  }
}