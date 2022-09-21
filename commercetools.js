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

// wrapper for an execute function which returns null instead of throwing an error 
// if not found.
async function allow404(p) {
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

const apiRoot = createApiBuilderFromCtpClient(ctpClient).withProjectKey({projectKey: projectKey});

/* 
Issue a query that will potentially return large amounts of data.
args:
endpoint:  apiRoot.products(), apiRoot.categories(), etc...
callback: myCallback // optional callback function to process 500 items at a time

Example:
const products = largeQuery({
  endpoint: apiRoot.products()
})
*/
async function largeQuery(args) {  
  let results = [];

  let max = 999999;
  if('max' in args) {
    max = args.max
  }
  let limit = 500;
  if(max < limit) {
    limit = max;
  }
  
  let done = false;
  let lastId=null;
  while (!done) {
    const queryArgs = {
      withTotal: false,
      limit: limit,
      sort: 'id asc',
    }
    if(lastId) {
      queryArgs.where = `id > "${lastId}"`
    }
    let result = await args.endpoint.get({queryArgs: queryArgs}).execute();
    if (result) {
      if(result.body.count) {
        if(args.callback) {
          args.callback(result.body.results);
        } else {
          results = results.concat(result.body.results);
          console.log('Fetched',results.length,'items');
        }
        lastId = result.body.results[result.body.count-1].id;
      }
      if (result.body.count < limit) {
        done = true;
      }
      if(results.length >= max) {
        done = true;
      }
    }
  }
  return results;
}

export {
  apiRoot,
  largeQuery,
  allow404
}