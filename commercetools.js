// Commercetools common access routines

const { createRequestBuilder } = require('@commercetools/api-request-builder');
const { createClient } = require('@commercetools/sdk-client')
const { createAuthMiddlewareForClientCredentialsFlow } = require('@commercetools/sdk-middleware-auth')
const { createHttpMiddleware } = require('@commercetools/sdk-middleware-http')
const fetch = require('node-fetch')
const { readFromCache, writeToCache } = require('./cache');


// Pull connection params from .env in '/env' folder next to the caller's dir.
require('dotenv').config({path : process.env.ENV_PATH || '../env/.env'});
let verbose = process.env.VERBOSE==='true';

const projectKey = process.env.CTP_PROJECT_KEY;

const authMiddleware = createAuthMiddlewareForClientCredentialsFlow({
    host: process.env.CTP_AUTH_URL,
    projectKey,
    credentials: {
      clientId: process.env.CTP_CLIENT_ID,
      clientSecret: process.env.CTP_CLIENT_SECRET,
    },
    scopes: [process.env.CTP_SCOPES],
    fetch,
  })

const httpMiddleware = createHttpMiddleware({
    host: process.env.CTP_API_URL,
    fetch,
})

const importMiddleware = createHttpMiddleware({
  host: 'https://import.us-central1.gcp.commercetools.com',
  fetch,
})

const client = createClient({
    middlewares: [authMiddleware, httpMiddleware],
})

const importClient = createClient({
  middlewares: [authMiddleware, importMiddleware],
})

const requestBuilder = createRequestBuilder({projectKey});

async function exec(params) {
  if(params.verbose)
    verbose = params.verbose;

  let result;
  if(verbose)
    console.log(params.method,params.uri);
  try {
    result = await client.execute(params);
    if(verbose) {
      console.log(JSON.stringify(result,null,2));
    }
    if(result.statusCode == 200 || result.statusCode == 201) {
      if(verbose)
        console.log('OK');
    }
  } catch(err) {
    // a 404 is not an error if our caller allows it
    if(err.statusCode==404 && params.allow404) {
      console.log('not found');
    } else { 
      console.log('ERROR',JSON.stringify(err,null,2));
    }
  }
  return result;
}

// Get a lot of data.  This approach pulls a max of 10,000 items.
async function largeQuery(args) {
  let results;

  if('cache' in args) {
    results = readFromCache(args.cache);
    if(results)
      return results;
  }
  results = [];

  let max = 9999;
  if('max' in args) {
    max = args.max
  }
  let offset = 0;
  let limit = 500;
  if(max < limit) {
    limit = max;
  }
  
  let done = false;
  while (!done) {
    let uri = args.uri;
    if(uri.includes('?'))
      uri += '&'
    else
      uri += '?'
    uri += `offset=${offset}&limit=${limit}`;
    console.log(uri);
    let result = await exec({
      uri: uri,
      method: "GET",
    });
    if (result) {
      results = results.concat(result.body.results);
      if (result.body.count < limit) {
        done = true;
      }
      if(results.length >= max) {
        done = true;
      }
      offset += limit;
    }
  }
  console.log('Found',results.length,'items');

  if('cache' in args) {
    writeToCache(args.cache,results);
  }

  return results;
}

module.exports = {
  client,
  importClient,
  requestBuilder,
  exec,
  largeQuery
}