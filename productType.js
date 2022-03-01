// Utility functions for managing product type

const ct = require('./commercetools');

async function getProductType(key) {
    console.log('Getting product type for',key);
    return await ct.execute({
      uri: ct.requestBuilder.productTypes.byKey(key).build(),
      method: 'GET',
      allow404: true,
    });
  }

async function createProductType(body,verbose) {
    console.log('Creating product type for',body.key);
    return await ct.execute({
      uri: ct.requestBuilder.productTypes.build(),
      method: 'POST',
      body: body,
      verbose: verbose
    })
  }
  
  async function deleteProductType(key,version) {
    console.log('Deleting product type',key,'version',version);
    return await ct.execute({
      uri: ct.requestBuilder.productTypes.byKey(key).build() + '?version='+version,
      method: 'DELETE',
    })
  }

  // Return updated version number if successful
  async function updateProductType(key,body) {
    console.log('Updating product type',key);
    let result = await ct.execute({
        uri: ct.requestBuilder.productTypes.byKey(key).build(),
        method: 'POST',
        body: body
    });
    if(result) {
        return result.body.version;
    }
    return null;
  }

  module.exports = {
      getProductType,
      createProductType,
      deleteProductType,
      updateProductType
  }
