/* 
Issue a query that will potentially return large amounts of data.
args:
endpoint:  apiRoot.products(), apiRoot.categories(), etc...
callback: myCallback // optional callback function to process 500 items at a time

Example:
const products = getAll({
  endpoint: apiRoot.productProjections()
  expand: (same as TS SDK expand)
  callback: function to call on each block of 500 items
})
*/

type QueryArgs = {
  where?: string | string[];
  priceCurrency?: string;
  priceCountry?: string;
  priceCustomerGroup?: string;
  priceChannel?: string;
  expand?: string | string[];
}

type GetAllArgs = {
  endpoint: any;
  callback?: (results: []) => void;
  max?: number;
  queryArgs?: QueryArgs
}

export async function getAll(args: GetAllArgs) {  
  let results: any[] = [];

  let max = 999999;
  if(args.max) {
    max = args.max
  }
  let limit = 500;
  if(max < limit) {
    limit = max;
  }
  
  let done = false;
  let lastId=null;
  while (!done) {
    const queryArgs: any = { 
      ...args.queryArgs, 
      withTotal: false,
      limit: limit,
      sort: 'id asc',
    }
    if(lastId) {
      if(args.queryArgs?.where) {
        queryArgs.where = `${args.queryArgs.where} and id > "${lastId}"`
      } else {
        queryArgs.where = `id > "${lastId}"`;
      }
    }    
    let result = await args.endpoint.get({queryArgs}).execute();
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