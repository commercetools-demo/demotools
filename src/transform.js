// Generic transformation utilities for transforming data fields into commercetools format
'use strict';

import _ from 'lodash'
import slugify from 'slugify';

// The standard slugify doesn't (quite) meet commercetools requirements, so we roll our own...
function toSlug(s) {
  return slugify(s.replace(/[^a-zA-Z0-9_\\-]/g,' '));
}

// Map a multi-locale field by building a new mapper list with those locale elements.
function mapMultiLocaleField(mapper,input,output,initDebug) {
  const mapperList = [];
  for(let element of mapper.localeMap) {
    mapperList.push({
      src: mapper.src + '.' + element.src,
      dest: mapper.dest,
      attr: mapper.attr,
      locale: element.dest
    });
  }
  mapFields(mapperList,input,output,initDebug);
}

/* Map fields from a source object to a destination object */
function mapFields(mapperList,input,output,initDebug=false) {
  for(let mapper of mapperList) {
    map1Field(mapper,input,output,initDebug);
  }
}

function flatten(obj) {
  console.log('in flatten',obj);
  let result = [];
  for(let k of Object.keys(obj)) {
    console.log('key',k);
    const value = k + ' ' + obj[k];
    console.log('value:',value);
    result.push(value);
  }
  return result.join(', ');
}

function map1Field(mapper,input,output,initDebug) {
  if(mapper.localeMap) {
    mapMultiLocaleField(mapper,input,output,initDebug);
    return;
  }

  let DEBUG = initDebug | mapper.debug;
  let value = null;
  let src=mapper.src ? mapper.src : mapper.name;
  let dest=mapper.dest ? mapper.dest : mapper.name;
  DEBUG && console.log('mapping',src,'to',dest);
  
  if(Array.isArray(src)) {
    value = getConcatValue(input,src,mapper.concat);
  } else {
    value = getValue(input,src);
  }
  if(mapper.regex) {
    console.log('REGEX',mapper.regex);
    const match = value.match(mapper.regex);
    if(match?.length > 1) {
        value = match[1];
    }
  }
  DEBUG && console.log('initial value',value);  
  let type = typeof(value);
  DEBUG && console.log('type',type,' is empty?',_.isEmpty(value));
  /* First, we convert the data from the input type to the output type, if any */
  if(type == 'number' || type === 'boolean' || !_.isEmpty(value)) {
    let values=[];
    switch(mapper.convert) {
      case 'slug':
        value = toSlug(value);
        break;
      case 'category':
        value={
          key: value,
          typeId: 'category'
        };
        break;
      case 'price':
        // Force this thing into an array, unless it's an attribute.          
        if(!mapper.attr)
          mapper.type='array'
        value = parseFloat(value);
        if(isNaN(value)) {
          value = 0;
        }
        // CLP has no cents - maybe others?
        if(mapper.currency=='CLP') {
          value = {
            value: {
              currencyCode: mapper.currency,
              centAmount: parseInt(value+0.5),
            }
          };
        } else {
          value= {
            value: {
              currencyCode: mapper.currency ? mapper.currency : 'USD',
              centAmount: parseInt(value*100+0.5),
            }
          };
        }
        // Add "channel" scope, if any.
        if(mapper.channel) {
          value.channel = {
            key: mapper.channel
          }
        }
        // needed for Sunrise.
        if(mapper.country) {
          value.country = mapper.country
        }
        DEBUG && console.log('price-type',value);
        break;
      case 'number':
        value=parseFloat(value);
        break;
      case 'boolean':
        switch(type) {
          case 'number':
            value = value != 0;
            break;
          case 'boolean':
            break;
          default:
            let valueStr=value.toString().toLowerCase();
            value = (valueStr=='true' 
                  || valueStr == '1' 
                  || valueStr=='y' 
                  || valueStr=='yes');
            break;
        }
        break;  
      case 'image':
        // It's an image, but only save it if it's a complete URL
        // ALSO - MAKE SURE YOU USE type: array!
        if(value.startsWith('http://') || value.startsWith('https://')) {          
          value = {
            url: value,
            dimensions: {
              w: 0,
              h: 0
            }
          }
        } else {
          value = null;
        }
        break;    
      case 'flatten':
         value = flatten(value);
          break;  
      case 'flatten-list':
          if(!Array.isArray(value))
            value = [ value ];
          for(let v of value) {
            DEBUG && console.log('flatten',v);
            values.push(flatten(v));
          }          
          value = values;
          break;
      case 'newline-list':
        value = value.split('\n');
        for(let v of value) {
          v = v.trim();
          if(v)
            values.push(v);
        }
        value = values;
        break;
      case 'text':
        // No matter what the input is, convert to a string
        value = value.toString();
        break;
      default:
        // Do nothing - value is already set
    }

    DEBUG &&  console.log('transformed',value);

    // If there are multiple destinations for this value, assign to all
    // example:
    // 'dest' : ['foo','bar']
    if(Array.isArray(dest)) {
      dest.forEach(d => {output[d]=value});
    } else {
      // Now, determine where the value goes (to an attribute, an array, etc.)
      if(mapper.attr) {
        if(!('attributes' in output)) {
          output.attributes = [];
        }
        // if money, dereference value
        if(mapper.convert == 'price') {
          value = value.value;
        }          
        // If a localized attribute, add to existing if found.
        if('locale' in mapper) {
          let attr = output.attributes.find(a => a.name==dest);
          if(!attr) {
            attr = { name: dest, value: {}};
            attr.value[mapper.locale] = value;
            output.attributes.push(attr);
          } else {
            attr.value[mapper.locale] = value;
          }
        } else {
          // plain (non-localized) attr.
          output.attributes.push({
            name: dest,
            value: value
          });
        }
      // If the destination type is an array, then push value to the array
      } else if (mapper.type == 'array') {
        if(!(dest in output)) {
          output[dest]=[];
        }
        // Don't push null onto an array!
        if(value != null)
          if(Array.isArray(value)) {
            output[dest] = output[dest].concat(value);
          } else {
            output[dest].push(value);
          }
      } else {
        if(value == null && mapper.convert == 'number') {
          // Don't set a value for numbers that have no value, as that's not the same as zero!
        } else {
          // Create a holder for (possibly multiple) localized strings
          if('locale' in mapper) {
            if(!(dest in output)) {
              output[dest]={}
            }
            output[dest][mapper.locale] = value;              
          } else {
            output[dest] = value;
          }
        }
      }
      DEBUG && console.log(src,'==>',dest,value);
    }
  }
}

// Concatenate a list of values into a single string, using concat as
// the concatenation character
function getConcatValue(input,srcList,concat) {
  let values = [];
  for(let src of srcList) {
    let value = getValue(input,src);
    if(value && !_.isEmpty(value))
      values.push(value);
  }
  return values.join(concat);
}

// Fetch a value from the input object, using the mapping specification and the 'src' field name
// If src contains dots, it's a path.
function getValue(input,src) {
  let value;
  if(src.includes('.') || src.includes('[')) {  
    // It's a complex expression = use "eval" to find the value
    value = eval('input.' + src);
  } else {
    value = input[src];
  }
  
  return value;
}

function addVariantToProduct(v,p) {
  if(!p.masterVariant) {
    p.masterVariant = v;
    return;
  }
  if(!p.variants) {
    p.variants = [];
  }
  p.variants.push(v);
}


export {
  mapFields,
  toSlug,
  addVariantToProduct
}
