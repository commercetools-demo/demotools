// Utility functions for managing product type
import { apiRoot, allow404 } from './commercetools.js';

async function getProductType(key) {
    console.log('Getting product type for',key);
    return await allow404(apiRoot.productTypes().withKey({key: key}).get().execute());
}

async function createProductType(body) {
    console.log('Creating product type for',body.key);
    return await apiRoot.productTypes().post({
      body: body,
    }).execute();
  }
  
async function deleteProductType(key,version) {
  console.log('Deleting product type',key,'version',version);
  return await apiRoot.productTypes().withKey({key: key}).delete({queryArgs:{ version: version}}).execute();
}

// Return updated version number if successful
async function updateProductType(key,body) {
  console.log('Updating product type',key);
  let result = await apiRoot.productTypes().withKey({key: key}).post({
    body: {
      ...body,
      version: body.version
    }
  }).execute();
  if(result) {
      return result.body.version;
  }
  return null;
}

export {
  getProductType,
  createProductType,
  deleteProductType,
  updateProductType
}
