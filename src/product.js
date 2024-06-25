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
    console.error(JSON.stringify(err.body.errors));
    errors++;
  }
  return {count,errors};
  
}

export const actionAllProducts = async (actionCallback, debug = false) => {
  let count = 0;
  let errors = 0;
  const products = await getAll({
    endpoint: apiRoot.productProjections()
  });
  debug && console.log('Found',products.length,'products');
  for(let product of products) {
    const action = actionCallback(product);
    if(action) {
      const result = await action1Product(product, [action], count, errors, debug); 
      count = result.count;
      errors = result.errors;        
    }
  }
  console.log('Updated',count,'products with',errors,'errors');
}

// Perform an update action for all products, all variants
// pass: action as a callback that takes a product and a variant and returns an update action
export const actionAllVariants = async (actionCallback, debug = false) => {
  let count = 0;
  let errors = 0;
  const products = await getAll({
    endpoint: apiRoot.productProjections()
  });
  for(let product of products) {
    const actions = []

    const action = actionCallback(product, product.masterVariant);
    if(action) {
      actions.push(action);
    }
    for(let v of product.variants) {
      const action = actionCallback(product, v);
      if(action) {
        actions.push(action);
      }
    }    
    const result = await action1Product(product, action, count, errors, debug); 
    count = result.count;
    errors = result.errors;
  }
  return {count, errors}
}