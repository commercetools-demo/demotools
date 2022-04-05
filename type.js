// Utility functions for managing types

const ct = require('./commercetools');
const _ = require('lodash');

async function getType(key) {
  console.log('Getting type for',key);
  return await ct.execute({
    uri: ct.requestBuilder.types.byKey(key).build(),
    method: 'GET',
    allow404: true
  });
}

// 
async function updateType(oldType,newType) {
  const actions = [];
  if(!_.isEqual(newType.name,oldType.name)) {
    actions.push({
      action: 'changeName',
      name: newType.name
    });
  }  
  for(let newFD of newType.fieldDefinitions) {
    if(!oldType.fieldDefinitions.find(fd => fd.name == newFD.name)) {
      // Add field defn
      actions.push({
        action: 'addFieldDefinition',
        fieldDefinition: newFD
      });
    }
  }
  for(let oldFD of oldType.fieldDefinitions) {
    if(!newType.fieldDefinitions.find(fd => fd.name == oldFD.name)) {
      // Remove field defn
      actions.push({
        action: 'removeFieldDefinition',
        fieldName: oldFD.name
      });
    }
  }
  if(actions.length==0) {
    console.log('no changes');
  } else {
    console.log(actions);
    console.log('Update type for',newType.key);
    
    return await ct.execute({
      uri: ct.requestBuilder.types.byKey(newType.key).build(),
      method: 'POST',
      body: {
        version: oldType.version,
        actions: actions
      }
    });
    
  }

}

async function createOrUpdateType(body) {
  const existing = await getType(body.key);
  if(existing) {
    updateType(existing.body,body);
  } else {
    console.log('Create type for',body.key);
    return await ct.execute({
      uri: ct.requestBuilder.types.build(),
      method: 'POST',
      body: body
    });
  }
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
    createOrUpdateType,
    deleteType
}
