// Utility functions for managing types
import { apiRoot, allow404 } from './commercetools.js';
import _ from 'lodash';


// If error 404, just return null
export async function getType(key) {
  console.log('Getting type for',key);
  return await allow404(apiRoot.types().withKey({key: key}).get().execute());
}

// Compare two 'types' inside a field definition (or set)
function compareTypes(fieldName,oldType,newType) {
  let actions = [];
  const typeName=oldType.name;
  if(typeName !='Enum' && typeName !='LocalizedEnum') {
    return [];
  }

  for(let newValue of newType.values) {
    console.log('checking',newValue.key);
    let oldValue = oldType.values.find(v => v.key == newValue.key);
    if(!oldValue) {
      console.log('Adding enum value');
      actions.push({
        action: `add${typeName}Value`,
        fieldName: fieldName,
        value: newValue
      });
    } else {
      // enum value exists, check label
      if(!_.isEqual(newValue.label,oldValue.label)) {
        actions.push({
          action: `change${type.name}Label`,
          fieldName: fieldName,
          value: newValue
        })
      }
    }
    for(let oldValue of oldType.values) {
      let newValue = newType.values.find(v => v.key == oldValue.key);
      if(!newValue) {
        console.log('Remove enum value not supported');
      }
    }
  }
  console.log('updateType actions',actions);
  return actions;
}

function compareFieldDefinitions(oldFD,newFD) {

  let actions = [];
  if(oldFD.type.name != newFD.type.name) {
    console.log('Invalid field type change',oldFD.name,'from',oldFD.type,'to',newFD.type);
    return actions;
  }
  // Update enums, which may be in this field, or in its 'element type' if a set
  const typeName = oldFD.type.name;
  if(typeName=='Set') {
    return compareTypes(oldFD.name,oldFD.type.elementType,newFD.type.elementType);
  } else {
    return compareTypes(oldFD.name,oldFD.type,newFD.type);
  }

}
  
async function updateType(oldType,newType) {
  let actions = [];
  if(!_.isEqual(newType.name,oldType.name)) {
    actions.push({
      action: 'changeName',
      name: newType.name
    });
  }  
  for(let newFD of newType.fieldDefinitions) {
    let oldFD = oldType.fieldDefinitions.find(fd => fd.name == newFD.name);
    if(!oldFD) {
      // Add field defn
      actions.push({
        action: 'addFieldDefinition',
        fieldDefinition: newFD
      });
    }
    else {
      // old fd exists, check internals
      actions = actions.concat(compareFieldDefinitions(oldFD, newFD));
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
    console.log('ACTIONS:',actions);
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
  console.log('res',JSON.stringify(res,null,1));
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

