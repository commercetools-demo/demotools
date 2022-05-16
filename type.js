// Utility functions for managing types

import { apiRoot } from './commercetools.js';
import _ from 'lodash';

async function allow404(p) {
  let result;
  try {
    result = await Promise.resolve(p);
  } catch(error) {
    if(error.statusCode==404) {
      console.log('not found');
    } else {
      throw(error);
    }
  }
  return result;
}
// If error 404, just return null
export async function getType(key) {
  console.log('Getting type for',key);
  return await allow404(apiRoot.types().withKey({key: key}).get().execute());
}
  
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
    
    return await apiRoot.types().withKey({key: newType.key}).post({
      body: {
        version: oldType.version,
        actions: actions
      }
    }).execute();
    
  }

}

export async function createOrUpdateType(type) {
  const res = await getType(type.key);
  console.log('res',res);
  if(res?.body) {
    updateType(res.body,type);
  } else {
    console.log('Create type for',type.key);
    return await apiRoot.types().post({body: type}).execute();
  }
}
  
export async function deleteType(key,version) {
  console.log('Deleting type',key,'version',version);
  return await apiRoot.types().withKey({key: key}).delete({queryArgs: {version: version}}).execute();
}

