import fetch from 'node-fetch';
import {
  ClientBuilder
} from '@commercetools/sdk-client-v2';

import {
  createApiBuilderFromCtpClient,
} from '@commercetools/platform-sdk';

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

const projectKey = CTP_PROJECT_KEY

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

const ctpClient = new ClientBuilder()
  .withProjectKey(projectKey)
  .withClientCredentialsFlow(authMiddlewareOptions)
  .withHttpMiddleware(httpMiddlewareOptions)
  .build();

export const apiRoot = createApiBuilderFromCtpClient(ctpClient).withProjectKey({projectKey: projectKey});