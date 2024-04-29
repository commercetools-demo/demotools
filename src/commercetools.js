import fetch from 'node-fetch';
import { ClientBuilder } from '@commercetools/sdk-client-v2';
import { createApiBuilderFromCtpClient } from '@commercetools/platform-sdk';

import dotenv from 'dotenv';

dotenv.config({path : process.env.ENV_PATH || '../env/.env'});
//reference API client credentials from environment variables
const {
  CTP_PROJECT_KEY,
  CTP_CLIENT_SECRET,
  CTP_CLIENT_ID,
  CTP_AUTH_URL,
  CTP_API_URL,
  CTP_SCOPES,
} = process.env

const projectKey = CTP_PROJECT_KEY;

if(!CTP_CLIENT_ID) {
  console.error('\nERROR: commercetools API Client not found!');
  console.error('Download API Client in .env format, and place in a sibling directory');
  console.error('to your calling script');
  console.error('named "env" (i.e., at ../env/.env)');
  console.error('Or specify .env file location in environment variable ENV_PATH\n');
  process.exit(1);
}

// create the authMiddlewareOptions object
const authMiddlewareOptions = {
  host: CTP_AUTH_URL,
  projectKey,
  credentials: {
    clientId: CTP_CLIENT_ID,
    clientSecret: CTP_CLIENT_SECRET,
  },
  scopes: CTP_SCOPES.split(' '),
  fetch,
};

// create the httpMiddlewareOptions object
const httpMiddlewareOptions = {
  host: CTP_API_URL,
  fetch,
};

let ctpClient;
console.log('LOG API CALLS',process.env.LOG_API_CALLS);
if(process.env.LOG_API_CALLS=="true") {
  ctpClient = new ClientBuilder()
    .withProjectKey(CTP_PROJECT_KEY)
    .withClientCredentialsFlow(authMiddlewareOptions)
    .withHttpMiddleware(httpMiddlewareOptions)
    .withLoggerMiddleware()
    .build();
} else {
  ctpClient = new ClientBuilder()
    .withProjectKey(CTP_PROJECT_KEY)
    .withClientCredentialsFlow(authMiddlewareOptions)
    .withHttpMiddleware(httpMiddlewareOptions)
    .build();
}

// wrapper for an execute function which returns null instead of throwing an error if not found.
export async function allow404(p) {
  let result;
  try {
    result = await Promise.resolve(p);
  } catch(error) {
    if(error.statusCode==404) {
      console.log('not found');
    } else {
      throw(error);
    }
  }
  return result;
}

export const apiRoot = createApiBuilderFromCtpClient(ctpClient, CTP_API_URL ).withProjectKey({projectKey: projectKey});
