# demotools

Tools to aid in the process of building demos, scripts, etc. for commercetools.  
The primary focus is on transforming product catalog data and importing into the commercetools platform for standing up demos quickly.

## Components

### commercetools.js

Encapsulation of the commercetools platform API client:

- **apiRoot** - Main API client for commercetools Platform API
- **allow404(p)** - Wrapper for an execute function which returns null instead of throwing an error if a 404 is encountered
  - `p`: Promise to execute, typically an API call that might return 404 Not Found
  - Returns: Result of the promise or null if a 404 error occurred

### importApi.js

Client for the commercetools Import API:

- **importApiRoot** - API client for commercetools Import API

### connectApi.js

Client for the commercetools Connect API:

- **connectRoot** - API client for commercetools Connect API

### getAll.js

Functions to retrieve large datasets from commercetools:

- **getAll(args)** - Issues a query that will potentially return large amounts of data, handling pagination automatically
  - Parameters:
    - `args.endpoint`: (Required) The commercetools API endpoint to query (e.g., apiRoot.products(), apiRoot.categories())
    - `args.queryArgs`: (Optional) Object containing query parameters such as:
      - `where`: String or array of where conditions
      - `expand`: String or array of expansion paths
      - `priceCurrency`, `priceCountry`, `priceCustomerGroup`, `priceChannel`: Price selection parameters
    - `args.callback`: (Optional) Function to process results in batches of up to 500 items
    - `args.max`: (Optional) Maximum number of results to return, defaults to all
    - `args.debug`: (Optional) Boolean to enable debug logging
  - Returns: Array of all results (or none if using callback)
  
  Example:
  ```js
  // Get all products
  const products = await getAll({
    endpoint: apiRoot.products()
  });
  
  // Get products with filtering and process in batches
  await getAll({
    endpoint: apiRoot.productProjections(),
    queryArgs: { where: 'categories(id="123")', expand: 'categories[*]' },
    callback: (batch) => processBatch(batch),
    max: 1000
  });
  ```

### getCount.js

Functions for counting large datasets:

- **getCount(args)** - Retrieves an accurate count of items, even when the count exceeds the platform's standard limit of 10,000
  - Parameters:
    - `args.endpoint`: (Required) The commercetools API endpoint to query (e.g., apiRoot.products())
    - `args.queryArgs`: (Optional) Object containing query parameters such as `where` conditions
  - Returns: Total count of matching items
  
  Example:
  ```js
  // Count all products
  const totalProducts = await getCount({
    endpoint: apiRoot.products()
  });
  
  // Count products matching a condition
  const totalProductsInCategory = await getCount({
    endpoint: apiRoot.products(),
    queryArgs: { where: 'masterData(current(categories(id="123")))' }
  });
  ```

### product.js

Product-specific utilities:

- **actionAllProducts(actionCallback, args)** - Perform update actions for all products
  - Parameters:
    - `actionCallback`: (Required) Function that takes a product and returns an array of update actions
    - `args`: (Optional) Object with options:
      - `debug`: Boolean to enable debug logging
      - Can include any parameters accepted by getAll() such as queryArgs
  - Returns: Object with count of updated products and errors: `{count, errors}`
  
  Example:
  ```js
  // Add a custom attribute to all products
  const result = await actionAllProducts(
    (product) => [{
      action: 'setAttribute',
      variantId: product.masterData.current.masterVariant.id,
      name: 'customFlag',
      value: true
    }],
    { debug: true }
  );
  console.log(`Updated ${result.count} products with ${result.errors} errors`);
  ```

### type.js

Type management utilities:

- **getType(key)** - Retrieve a type by key, returns null if not found
  - `key`: (Required) The type key to look up
  - Returns: The type object or null if not found

### transform.js

Data mapping and transformation utilities:

- **mapFields(mapperList, input, output, initDebug)** - Maps fields from a source object to a destination object using mapper configurations
  - Parameters:
    - `mapperList`: (Required) Array of mapper objects defining the transformation rules
    - `input`: (Required) Source object containing the data to transform
    - `output`: (Required) Destination object to populate with transformed data
    - `initDebug`: (Optional) Boolean to enable debug logging
  - Returns: No return value; modifies the output object directly
  
- **toSlug(s)** - Creates a commercetools-compatible URL slug from a string
  - `s`: (Required) String to convert to a slug
  - Returns: Slugified string

- **addVariantToProduct(product, variant)** - Adds a variant to a product
  - Parameters:
    - `product`: (Required) Product object to add the variant to
    - `variant`: (Required) Variant object to add to the product
  - Returns: No return value; modifies the product object directly

A Mapper has (up to) five fields:

* **src**: The name of the field in the source object
* **dest**: The name of the field in the destination object
* **convert**: (optional) - a conversion operation to perform. One of:
    slug, category, price, number, boolean, image, list, newline-list, array-list, text, flatten, flatten-list
* **type**: (optional) - the data type of the destination field. One of:
  attr, array
* **locale**: (optional) - for localized fields, specifies the locale (e.g., 'en-US')

Examples:
```js
{
  src: 'ProductID',
  dest: 'key',
}
```
The field *ProductID* in the source object will be mapped to the field *key* in the destination object -- no transformations performed (straight copy)

#### Price
Convert a Price:
```js
{
  src: 'SalePrice',
  dest: 'prices',
  convert: 'price'
}
```

#### Localized Fields:

```js
{
  src: 'ProductName',
  dest: 'name',
  locale: 'en-US'
}
```
In this case, ProductName in the source will map to a localized field *name* in the destination, in a structure used by commercetools localized fields.

#### Attributes
```js
{
  src: 'Department',
  dest: 'department',
  type: 'attr'
}
```
The source field Department will be copied to an attribute called *department* in an *attributes* array of the destination object

#### Category (reference by key)
Use both a 'convert' (to convert to a reference to a category), and a 'type' (array)
```js
{
  src: 'CategoryID',
  dest: 'categories',
  convert: 'category',
  type: 'array'
}
```

#### Images
Convert to an (external) image format
```js
{
  src: 'MainImageURL',
  dest: 'images',
  convert: 'image',
  type: 'array'
}
```

### files.js

File I/O utilities:

- **readCsv(filename, delimiter, quote, verbose)** - Read CSV file and return as an array of objects
  - Parameters:
    - `filename`: (Required) Path to the CSV file
    - `delimiter`: (Optional) Column delimiter character (default: ',')
    - `quote`: (Optional) Quote character (default: '"')
    - `verbose`: (Optional) Boolean flag to enable verbose logging (default: false)
  - Returns: Array of objects with properties named by headers from the first row

- **writeCsv(filename, data, options)** - Write array of objects to a CSV file
  - Parameters:
    - `filename`: (Required) Path to write the CSV file
    - `data`: (Required) Array of objects to write
    - `options`: (Optional) Object with options:
      - `headers`: Array of column headers (if not to be auto-generated from first object)
      - `delimiter`: Column delimiter character (default: ',')
  - Returns: No return value

- **readJSON(filename)** - Read JSON file and return parsed object
  - `filename`: (Required) Path to the JSON file
  - Returns: Parsed JavaScript object

- **writeJSON(filename, data)** - Write object to a JSON file
  - Parameters:
    - `filename`: (Required) Path to write the JSON file
    - `data`: (Required) Object to serialize and write
  - Returns: No return value

- **inspect(obj)** - Utility for inspecting object structures
  - `obj`: (Required) Object to inspect
  - Returns: String representation of the object structure

### cache.js

Caching utilities:

- **readFromCache(key)** - Read data from cache
  - `key`: (Required) Cache entry identifier
  - Returns: Cached data or null if not found

- **writeToCache(key, data)** - Write data to cache
  - Parameters:
    - `key`: (Required) Cache entry identifier
    - `data`: (Required) Data to store in the cache
  - Returns: No return value

## Environment Configuration

Place the commercetools connection parameters in a file named **.env** in a folder adjacent to your calling script or in the current directory.

Required environment variables:
```
CTP_PROJECT_KEY=your-project-key
CTP_CLIENT_SECRET=your-client-secret
CTP_CLIENT_ID=your-client-id
CTP_AUTH_URL=https://auth.region.commercetools.com
CTP_API_URL=https://api.region.commercetools.com
CTP_SCOPES=your-scopes
```

Optional:
```
LOG_API_CALLS=true
```

## Linking locally

If developing locally, do 'yarn link' in this directory, then 'yarn link @cboyke/demotools' in the dependent folder.

