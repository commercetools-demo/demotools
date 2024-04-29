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
  CTP_CONNECT_URL,
  CTP_SCOPES,
} = process.env

const projectKey = CTP_PROJECT_KEY;

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

let connectUrl = CTP_CONNECT_URL;
if(!connectUrl) {
  connectUrl = CTP_API_URL.replace('api.','connect.');
}

// create the httpMiddlewareOptions object
const connectMiddlewareOptions = {
  host: connectUrl,
  fetch,
};

const connectClient = new ClientBuilder()
  .withProjectKey(CTP_PROJECT_KEY)
  .withClientCredentialsFlow(authMiddlewareOptions)
  .withHttpMiddleware(connectMiddlewareOptions)
  .withLoggerMiddleware()
  .build();

export const connectRoot = createApiBuilderFromCtpClient(connectClient).withProjectKey({projectKey: projectKey});
