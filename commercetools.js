// Commercetools common access routines

const { createRequestBuilder } = require('@commercetools/api-request-builder');
const { createClient } = require('@commercetools/sdk-client')
const { createAuthMiddlewareForClientCredentialsFlow } = require('@commercetools/sdk-middleware-auth')
const { createHttpMiddleware } = require('@commercetools/sdk-middleware-http')
const { ApiRoot,executeRequest, createExecutorFromMiddlewares } = require('@commercetools/importapi-sdk');
const fetch = require('node-fetch')
const { readFromCache, writeToCache } = require('./cache');

const IMPORT_HOST='https://import.us-central1.gcp.commercetools.com';

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


const client = createClient({
    middlewares: [authMiddleware, httpMiddleware],
});

const requestBuilder = createRequestBuilder({projectKey});

/* For import API */
const importMiddleware = createHttpMiddleware({
  host: IMPORT_HOST,
  fetch,
});

const importClient = createClient({
  middlewares: [authMiddleware, importMiddleware],
});

const executor = createExecutorFromMiddlewares(importClient.execute);

const importApiRoot = new ApiRoot({
  executeRequest: executor,
  baseUri: IMPORT_HOST,
}).withProjectKeyValue({ projectKey })


/* Execute a call to commercetools.   
Takes the same arguments as the JavaScript SDK client 'execute' method:
https://commercetools.github.io/nodejs/sdk/api/sdkClient.html#executerequest

with a few additional parameters:
verbose: true - display additional debug information
allow404 - don't throw an error if not found, just return null
*/
async function execute(params) {
  if(params.verbose)
    verbose = params.verbose;

  if(verbose)
    console.log(params.method,params.uri);
  
  let result = null;
  
  result = await client.execute(params)
  .catch(err => {
    if(err.statusCode==404 && params.allow404) {
      console.log('not found');
    } else { 
      logError(err.message);
    }
    return null;
  });
  
  if(!result) {
    return null;
  }

  if(verbose) {
    console.log(JSON.stringify(result,null,2));
  }
  if(result.statusCode == 200 || result.statusCode == 201) {
    if(verbose)
      console.log('OK');
  }
  return result;
}

function logError(err) {
  console.log('ERROR',JSON.stringify(err,null,2));
}

async function exec(params) {
  console.log('deprecated -- use execute instead');
  return execute(params);
}

/* 
Issue a query that will potentially return large amounts of data
Pass: same parameters as a Query call.  Optionally pass a callback to 
be called on chunks of 500 items, rather than return the whole list at the end.

If it makes sense to do so, we can read from a cache 
(if doing testing, and running the same query repeatedly, for example)
The cache argument needs to look like this:
{dir: <cacheDir>, filename: <cacheFilename> }

Example:
   const dt = require('@cboyke/demotools');

  let products = await dt.largeQuery({
    uri: dt.requestBuilder.products.build(),
    cache: {dir: 'cache', filename: 'products.json'}, //optional
    callback: myCallback // optional callback function to process 500 items at a time
  });
*/
async function largeQuery(args) {
  if(args.verbose)
    verbose = args.verbose;
  
  let results = [];

  if('cache' in args) {
    let resCache = readFromCache(args.cache);
    if(resCache)
      return resCache;
  }

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
  let param;
  while (!done) {
    if(lastId ==null) 
      param=`withTotal=false&limit=${limit}&sort=id+asc`;
    else
      param=`withTotal=false&limit=${limit}&sort=id+asc&where=id>"${lastId}"`

    let uri = args.uri;
    if(uri.includes('?'))
      uri += '&'
    else
      uri += '?'
    uri += param;
    let result = await execute({
      uri: uri,
      method: "GET",
      verbose: verbose
    });
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

  if('cache' in args) {
    writeToCache(args.cache,results);
  }

  if(!args.callback)
    return results;
}

module.exports = {
  requestBuilder,
  execute,
  largeQuery,
  importApiRoot
}