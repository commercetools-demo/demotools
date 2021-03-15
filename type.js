// Utility functions for managing types

const ct = require('./commercetools');

async function getType(key) {
    console.log('Getting type for',key);
    return await ct.execute({
      uri: ct.requestBuilder.types.byKey(key).build(),
      method: 'GET',
      allow404: true
    });
  }

async function createType(body) {
    console.log('Create type for',body.key);
    return await ct.execute({
      uri: ct.requestBuilder.types.build(),
      method: 'POST',
      body: body
    });
  }
  
  async function deleteType(key,version) {
    console.log('Deleting type',key,'version',version);
    return await ct.execute({
      uri: ct.requestBuilder.types.byKey(key).build() + '?version='+version,
      method: 'DELETE',
    });
  }

  module.exports = {
      getType,
      createType,
      deleteType
  }
