# demotools

Tools to aid in the process of building demos, scripts, etc. for commercetools.  
The Primary focus is on transforming product catalog data and importing into the commercetools platform for standing up demos quickly

# Components

# commercetools.js

Encapsulation of the "standard" commercetools functions - requestBuilder, client, etc.  

Place the commercetools connection parameters in a file named **.env** in a folder adjacent to your calling script.

# execute & requestBuilder
Typically used together to execute a call to commercetools.   

Takes the same arguments as the JavaScript SDK client *execute*

https://commercetools.github.io/nodejs/sdk/api/sdkClient.html#executerequest

and *requestBuilder*

https://commercetools.github.io/nodejs/sdk/api/apiRequestBuilder.html


with a few additional parameters:

  * verbose (true or false) - display (lots of) debug information, including body of results, etc.

  * allow404 - don't throw an error if not found, just return null

## Usage
```js

const dt = require('@cboyke/demotools');

let result = await dt.execute({
  uri: dt.requestBuilder.products.byKey(key).build(),
  method: 'POST',
  body: {
    version: version,
    actions: [{
      action: 'unpublish'
    }]
  }
});
```

# largeQuery
Issue a query that will potentially return large amounts of data

Pass: same parameters as a query execute call (see above)

Return: an array of results.

If it makes sense to do so, we can read from a cache -- if doing testing, and running the same query repeatedly, for example.  The cache argument needs to look like this:
{dir: <cacheDir>, filename: <cacheFilename> }

## Usage
```js
const dt = require('@cboyke/demotools');

let products = await dt.largeQuery({
   uri: dt.requestBuilder.products.build(),
  cache: {dir: 'cache', filename: 'products.json'}
});
```

# csvUtil.js


# readCSV
(filename, delimiter=',',verbose=false):

returns - an array of objects keyed by values in the header row.



# transform.js

Data mapping / transformation utils.


TODO: provide usage example