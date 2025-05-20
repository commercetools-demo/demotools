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

export const importApiRoot = createApiBuilderFromCtpClient(client, IMPORT_API_URL).withProjectKeyValue({ projectKey });

/* Create container if doesn't exist.
 * Make sure to use await when calling this function, as container creation sometimes takes a while
 */
export async function ensureImportContainer(key, resourceType) {
  let containerExists = false;
  try {
    console.log('Checking for container', key);
    const res = await importApiRoot
      .importContainers()
      .withImportContainerKeyValue({importContainerKey: key})
      .get()
      .execute()
    console.log(res.statusCode);
    containerExists = true;
    console.log('Container', key, 'exists');
    return;
  } catch(err) {
    if(err.statusCode === 404) {
      containerExists = false;
    }
  }
  // Wait and retry logic - check container exists after creation
  const waitTimeMs = 2000; // 2 seconds between retries
  const maxWaitTimeMs = 15000; // 15 seconds maximum wait time
  let totalWaitTimeMs = 0;
  
  if(!containerExists) {
    console.log('Creating container', key, 'for resource type', resourceType)
    const res = await importApiRoot.importContainers().post({
      body: {
        key,
        resourceType
      }
    }).execute();
    console.log('Created container', key, 'for resource type', resourceType, 'with status', res.statusCode);
    console.log('Verifying import container creation...');
    
    while (!containerExists && totalWaitTimeMs < maxWaitTimeMs) {
      await new Promise(resolve => setTimeout(resolve, waitTimeMs));
      totalWaitTimeMs += waitTimeMs;
      
      try {
        await importApiRoot
          .importContainers()
          .withImportContainerKeyValue({importContainerKey: key})
          .get()
          .execute();
        containerExists = true;
        console.log(`Import container ${key} verified after ${totalWaitTimeMs/1000} seconds`);
      } catch (verifyErr) {
        console.log(`Container not ready yet, waited ${totalWaitTimeMs/1000} seconds so far, retrying...`);
      }
    }
    
    if (!containerExists) {
      console.warn(`Warning: Could not verify container ${key} creation after ${maxWaitTimeMs/1000} seconds`);
    }
  }
}