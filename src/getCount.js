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

// type QueryArgs = {
//   where?: string | string[];
//   priceCurrency?: string;
//   priceCountry?: string;
//   priceCustomerGroup?: string;
//   priceChannel?: string;
//   expand?: string | string[];
// }

// type GetAllArgs = {
//   endpoint: any;
//   callback?: (results: []) => void;
//   max?: number;
//   queryArgs?: QueryArgs
// }

async function initialTotal(args, where) {
    const queryArgs = { 
    ...args.queryArgs,
    ...(where ? {where} : {}),
    offset: 0,
    withTotal: true,
    limit: 500,
    sort: 'id asc',
  }
   let result = await args.endpoint.get({queryArgs}).execute();
   return result.body.total;
}

async function getLastId(args, where, lastTotal) {
    const queryArgs = { 
    ...args.queryArgs,
    ...(where ? {where} : {}),
    offset: lastTotal - 500,
    withTotal: true,
    limit: 500,
    sort: 'id asc',
  }
   let result = await args.endpoint.get({queryArgs}).execute();
   return result.body.results[result.body.count-1].id;
}

export async function getCount(args) {  
  let limit = 500;
  let offset = 0;
  let total = 0;
  let finished = false;
  let lastId = null;


  const queryArgs = { 
    ...args.queryArgs,
    offset,
    withTotal: true,
    limit: limit,
    sort: 'id asc',
  }

  let lastTotal = await initialTotal(args);
  
  if (lastTotal < 10000) {
    total += lastTotal;
    finished = true;
  }
  while (!finished) {

    lastId = await getLastId(args, lastId ? `id > "${lastId}"`: null, lastTotal);
    lastTotal = await initialTotal(args, `id > "${lastId}"`);
    if (lastTotal < 10000) {
      finished = true;
    }
    total += lastTotal;
  }

  return total;
}