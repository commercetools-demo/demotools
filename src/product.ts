import { apiRoot } from './commercetools.js';
import { getAll } from './getAll.js';


const action1Product = async (product, actions, count, errors, debug = false) => {
  try {
    if(actions.length) {
      if(debug) {
        console.log(actions);
      }
      console.log('updating product',product.key,'with',actions.length,'actions');
      let res = await apiRoot.products().withId({ID: product.id}).post({
        body: {
          version: product.version,
          actions
        }
      }).execute();
      if(res?.statusCode == 200 || res?.statusCode == 201) {
        console.log(res.statusCode);
        count++;        
      }
    }
  } catch(err) {
    console.error(err);
    errors++;
  }
  return {count,errors};
  
}
// Perform update actions for all products
// pass: action as a callback that takes a product  and returns an array of update actions
export const actionAllProducts = async (actionCallback, args = {debug: false}) => {
  let count = 0;
  let errors = 0;
  const products = await getAll({
    endpoint: apiRoot.products(),
    ...args
  });
  args.debug && console.log('Found',products.length,'products');
  for(let product of products) {
    let actions = actionCallback(product);
    args.debug && console.log('actions',actions);
    if(actions) {
      const result = await action1Product(product, actions, count, errors, args.debug); 
      count = result.count;
      errors = result.errors;        
    }
  }
  console.log('Updated',count,'products with',errors,'errors');
  return {count, errors}
}


// Perform update actions for all products, all variants
// pass: action as a callback that takes a product and a variant and returns an array of update actions
export const actionAllVariants = async (actionCallback, debug = false) => {
  let count = 0;
  let errors = 0;
  const products = await getAll({
    endpoint: apiRoot.productProjections()
  });
  for(let product of products) {
    const actions = [];

    const action = actionCallback(product, product.masterVariant);
    actions.push(...action);
    for(let v of product.variants) {
      const action = actionCallback(product, v);
      actions.push(...action);
    }
    if(actions.length) {
      const result = await action1Product(product, actions, count, errors, debug); 
      count = result.count;
      errors = result.errors;
    }
    
  }
  console.log('Updated',count,'products with',errors,'errors');
  return {count, errors}
}